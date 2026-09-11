import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { generateRecommendationForAssessment } from '@/lib/server/recommendations';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

const log = createLogger('AssessmentsAPI');

const ASSESSMENT_TYPES = ['quiz', 'pbl', 'continuous_assessment', 'exam'] as const;
type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

interface AssessmentRequest {
  assessmentType: AssessmentType;
  sessionId?: string | null;
  sceneId?: string | null;
  /** Continuous Assessment: not tied to a session, so passed directly. */
  chapterId?: string | null;
  /** Exam, module tier: not tied to a session, so passed directly. */
  moduleId?: string | null;
  /** Exam, book tier (no module layer): passed directly, no module to derive it from. */
  courseId?: string | null;
  score?: number | null;
  maxScore?: number | null;
  feedback?: string | null;
  strengths?: string[];
  areasToImprove?: string[];
  evaluatedBy: string;
}

/**
 * POST /api/assessments
 *
 * Records one assessment (quiz grading or PBL evaluation) and refreshes the
 * learner's `learning_metrics` row in the same request. Both writes go
 * through the service-role client server-side only:
 *
 * - The insert could go through the learner's own anon-key session — RLS
 *   (`assessments_insert_own`) already allows it — but doing both writes
 *   through one client keeps this one request atomic-ish instead of a
 *   client-driven insert-then-recompute that can drift if the second call
 *   never fires (network drop, tab closed).
 * - `recompute_learning_metrics` has no internal `auth.uid()` check — it
 *   trusts whatever `learner_id` it's given — so it must never be reachable
 *   from the browser with an arbitrary id. This route is the only caller,
 *   and it always passes the id from the caller's OWN authenticated
 *   session, never from the request body.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      // Anonymous / local-only courses have nothing to record against.
      // Fire-and-forget callers treat this the same as any other failure.
      return apiError('INVALID_REQUEST', 401, 'Not signed in');
    }

    const body = (await req.json()) as AssessmentRequest;
    if (!ASSESSMENT_TYPES.includes(body.assessmentType)) {
      return apiError(
        'INVALID_REQUEST',
        400,
        "assessmentType must be 'quiz', 'pbl', 'continuous_assessment', or 'exam'",
      );
    }
    if (!body.evaluatedBy || typeof body.evaluatedBy !== 'string') {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'evaluatedBy is required');
    }

    // A quiz/pbl session tagged to a course doesn't carry course_id on the
    // request body — look it up so the recommendation generated below (and
    // any future course-scoped assessment query) can actually relate back
    // to the course, the same way course-final's own insert already does.
    // A session generated from a textbook chapter (source_ingestion_id +
    // source_chapter_index — see lib/courses/lessons.ts) resolves the same
    // way to book_chapters.id, via the chapter_number that ingestion's
    // structuring plan (lib/textbook/book-plan.ts) assigned it at ingest
    // time: chapter_number is 1-based, source_chapter_index is the same
    // chapter's 0-based position in that array, so number = index + 1.
    //
    // Continuous Assessment and Exam have no session at all (session_id is
    // null by design — they span a whole chapter/module, not one lesson),
    // so they pass chapterId/moduleId directly instead; course_id is then
    // resolved the other way: chapter -> ingestion -> course, or module ->
    // ingestion -> course. Exam's book tier (no module layer — see
    // needsModuleLayer in lib/textbook/structure-plan.ts) has no module row
    // to derive course_id from, so it passes courseId straight through.
    let courseId: string | null = body.courseId ?? null;
    let chapterId: string | null = body.chapterId ?? null;
    const moduleId: string | null = body.moduleId ?? null;
    if (body.sessionId) {
      const { data: session } = await supabase
        .from('learning_sessions')
        .select('course_id, source_ingestion_id, source_chapter_index')
        .eq('id', body.sessionId)
        .maybeSingle();
      courseId = (session?.course_id as string | null) ?? null;

      if (!chapterId) {
        const sourceIngestionId = (session?.source_ingestion_id as string | null) ?? null;
        const sourceChapterIndex = (session?.source_chapter_index as number | null) ?? null;
        if (sourceIngestionId != null && sourceChapterIndex != null) {
          const { data: chapter } = await supabase
            .from('book_chapters')
            .select('id')
            .eq('ingestion_id', sourceIngestionId)
            .eq('chapter_number', sourceChapterIndex + 1)
            .maybeSingle();
          chapterId = (chapter?.id as string | null) ?? null;
        }
      }
    } else if (chapterId) {
      const { data: chapter } = await supabase
        .from('book_chapters')
        .select('ingestion_id')
        .eq('id', chapterId)
        .maybeSingle();
      const ingestionId = (chapter?.ingestion_id as string | null) ?? null;
      if (ingestionId) {
        const { data: ingestion } = await supabase
          .from('textbook_ingestions')
          .select('course_id')
          .eq('id', ingestionId)
          .maybeSingle();
        courseId = (ingestion?.course_id as string | null) ?? null;
      }
    } else if (moduleId) {
      const { data: moduleRow } = await supabase
        .from('book_modules')
        .select('ingestion_id')
        .eq('id', moduleId)
        .maybeSingle();
      const ingestionId = (moduleRow?.ingestion_id as string | null) ?? null;
      if (ingestionId) {
        const { data: ingestion } = await supabase
          .from('textbook_ingestions')
          .select('course_id')
          .eq('id', ingestionId)
          .maybeSingle();
        courseId = (ingestion?.course_id as string | null) ?? null;
      }
    }

    const admin = createServiceRoleClient();

    // A retake (learner didn't pass, tried again) inserts a new row rather
    // than overwriting the failed attempt — full history feeds the
    // learning-metrics/growth graphs (Tier W). attempt_number is scoped to
    // whichever FK actually identifies "the same assessment" for this type:
    // session_id+scene_id for a lesson-embedded quiz/PBL, chapter_id for
    // Continuous Assessment, module_id (or course_id when the source book
    // has no module layer) for Exam. Computed server-side, never trusted
    // from the request body, same reasoning as course_id/chapter_id above.
    let attemptScope = admin
      .from('assessments')
      .select('attempt_number')
      .eq('learner_id', user.id)
      .eq('assessment_type', body.assessmentType);
    if (body.assessmentType === 'continuous_assessment') {
      attemptScope = chapterId
        ? attemptScope.eq('chapter_id', chapterId)
        : attemptScope.is('chapter_id', null);
    } else if (body.assessmentType === 'exam') {
      if (moduleId) {
        attemptScope = attemptScope.eq('module_id', moduleId);
      } else if (courseId) {
        attemptScope = attemptScope.eq('course_id', courseId);
      } else {
        attemptScope = attemptScope.is('module_id', null).is('course_id', null);
      }
    } else {
      attemptScope = body.sessionId
        ? attemptScope.eq('session_id', body.sessionId)
        : attemptScope.is('session_id', null);
      attemptScope = body.sceneId
        ? attemptScope.eq('scene_id', body.sceneId)
        : attemptScope.is('scene_id', null);
    }
    const { data: priorAttempts, error: attemptsError } = await attemptScope
      .order('attempt_number', { ascending: false })
      .limit(1);
    if (attemptsError) throw attemptsError;
    const attemptNumber = ((priorAttempts?.[0]?.attempt_number as number | undefined) ?? 0) + 1;

    const { data: inserted, error: insertError } = await admin
      .from('assessments')
      .insert({
        learner_id: user.id,
        course_id: courseId,
        chapter_id: chapterId,
        module_id: moduleId,
        session_id: body.sessionId ?? null,
        scene_id: body.sceneId ?? null,
        assessment_type: body.assessmentType,
        attempt_number: attemptNumber,
        score: body.score ?? null,
        max_score: body.maxScore ?? null,
        feedback: body.feedback ?? null,
        strengths: body.strengths ?? null,
        areas_to_improve: body.areasToImprove ?? null,
        evaluated_by: body.evaluatedBy,
      })
      .select('id')
      .single();
    if (insertError) throw insertError;

    const { error: recomputeError } = await admin.rpc('recompute_learning_metrics', {
      p_learner_id: user.id,
    });
    if (recomputeError) {
      // The assessment itself is durably recorded; a stale metrics row is
      // recoverable (the next assessment recomputes it), so this doesn't
      // fail the request — but it must be visible in logs.
      log.error('Assessment recorded but metrics recompute failed:', recomputeError);
    }

    // PBL evaluation is out of scope for now — only real, individually-
    // scored quiz-shaped assessments feed the recommendation flow, per the
    // same scope decision as the course-final synthesis (PBL may be added
    // later). Continuous Assessment and Exam are both quiz-shaped (real
    // questions, real grading) so they're included alongside 'quiz'.
    if (
      body.assessmentType === 'quiz' ||
      body.assessmentType === 'continuous_assessment' ||
      body.assessmentType === 'exam'
    ) {
      await generateRecommendationForAssessment(req, inserted.id as string, user.id);
    }

    return apiSuccess({ recorded: true });
  } catch (error) {
    log.error('Failed to record assessment:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to record assessment',
    );
  }
}
