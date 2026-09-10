/**
 * Course-Final Assessment API
 *
 * POST /api/assessments/course-final — synthesizes a single course-level
 * assessment from a learner's already-recorded per-lesson quiz scores,
 * once the course's final planned lesson completes.
 *
 * Option B (computed summary, not a re-test): the aggregate score is a
 * deterministic sum of the per-lesson quiz score/max_score pairs already on
 * `assessments`; only the feedback narrative is LLM-synthesized from the
 * pooled per-lesson feedback. Quiz-only for now — PBL assessments recorded
 * mid-course are excluded (may be added later as a separate change).
 */
import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { parseJsonResponse } from '@openmaic/generation';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

const log = createLogger('CourseFinalAssessmentAPI');

interface RequestBody {
  courseId: string;
}

interface SynthesizedFeedback {
  feedback: string;
  strengths: string[];
  areasToImprove: string[];
}

function buildSynthesisPrompt(
  courseTitle: string,
  lessons: Array<{
    lessonNumber: number;
    score: number | null;
    maxScore: number | null;
    feedback: string | null;
    strengths: string[] | null;
    areasToImprove: string[] | null;
  }>,
): { system: string; user: string } {
  const system = `You are an instructional assessor writing a course-completion report. You are given per-lesson quiz results and feedback already recorded across a course. Synthesize ONE overall report on the learner's demonstrated performance across the WHOLE course — do not just restate or repeat the last lesson's feedback. Return ONLY valid JSON, no markdown or explanation.`;

  const lessonSummaries = lessons
    .sort((a, b) => a.lessonNumber - b.lessonNumber)
    .map((l) => {
      const scoreLine =
        l.score != null && l.maxScore != null ? `${l.score}/${l.maxScore}` : 'not scored';
      const parts = [`Lesson ${l.lessonNumber}: ${scoreLine}`];
      if (l.feedback) parts.push(`  Feedback: ${l.feedback}`);
      if (l.strengths?.length) parts.push(`  Strengths: ${l.strengths.join(', ')}`);
      if (l.areasToImprove?.length) parts.push(`  Areas to improve: ${l.areasToImprove.join(', ')}`);
      return parts.join('\n');
    })
    .join('\n\n');

  const user = `Course: "${courseTitle}"

Per-lesson results:
${lessonSummaries}

Write a course-completion report synthesizing performance across all ${lessons.length} lessons. Identify patterns across lessons (recurring strengths, recurring gaps) rather than just listing each lesson's result again.

Return a JSON object with this exact structure:
{
  "feedback": "string (2-4 sentences synthesizing overall performance across the course)",
  "strengths": ["string", "..."],
  "areasToImprove": ["string", "..."]
}`;

  return { system, user };
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return apiError('INVALID_REQUEST', 401, 'Not signed in');
    }

    const body = (await req.json()) as RequestBody;
    if (!body.courseId || typeof body.courseId !== 'string') {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'courseId is required');
    }

    // Explicit ownership check — RLS already scopes this, but a clear 404
    // beats a confusing empty-aggregate result for a courseId that isn't
    // this learner's (or doesn't exist).
    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('id, title')
      .eq('id', body.courseId)
      .eq('learner_id', user.id)
      .maybeSingle();
    if (courseError) throw courseError;
    if (!course) {
      return apiError('INVALID_REQUEST', 404, 'Course not found');
    }

    const { data: sessions, error: sessionsError } = await supabase
      .from('learning_sessions')
      .select('id, lesson_number')
      .eq('course_id', body.courseId);
    if (sessionsError) throw sessionsError;

    const sessionIds = (sessions ?? []).map((s) => s.id as string);
    if (sessionIds.length === 0) {
      return apiSuccess({ created: false, reason: 'no_sessions' });
    }
    const lessonNumberBySession = new Map(
      (sessions ?? []).map((s) => [s.id as string, s.lesson_number as number | null]),
    );

    const { data: quizAssessments, error: assessmentsError } = await supabase
      .from('assessments')
      .select('session_id, score, max_score, feedback, strengths, areas_to_improve')
      .in('session_id', sessionIds)
      .eq('assessment_type', 'quiz');
    if (assessmentsError) throw assessmentsError;

    if (!quizAssessments || quizAssessments.length === 0) {
      // Nothing to synthesize yet — not an error, just genuinely no
      // per-lesson quiz data recorded for this course.
      return apiSuccess({ created: false, reason: 'no_quiz_assessments' });
    }

    let totalScore = 0;
    let totalMax = 0;
    const lessons = quizAssessments.map((a) => {
      if (typeof a.score === 'number' && typeof a.max_score === 'number') {
        totalScore += a.score;
        totalMax += a.max_score;
      }
      return {
        lessonNumber: lessonNumberBySession.get(a.session_id as string) ?? 0,
        score: a.score as number | null,
        maxScore: a.max_score as number | null,
        feedback: a.feedback as string | null,
        strengths: a.strengths as string[] | null,
        areasToImprove: a.areas_to_improve as string[] | null,
      };
    });

    const { model: languageModel, thinkingConfig } = await resolveModelFromRequest(
      req,
      body,
      'course-final-assessment',
    );

    const prompt = buildSynthesisPrompt(course.title, lessons);
    const response = await callLLM(
      { model: languageModel, system: prompt.system, prompt: prompt.user },
      'course-final-assessment',
      undefined,
      thinkingConfig,
    );

    const parsed = parseJsonResponse<SynthesizedFeedback>(response.text, { logger: log });
    if (!parsed || typeof parsed.feedback !== 'string') {
      log.error('Failed to parse course-final synthesis response:', response.text.slice(0, 500));
      return apiError('PARSE_FAILED', 500, 'Failed to synthesize course-final feedback');
    }

    const admin = createServiceRoleClient();
    const { error: insertError } = await admin.from('assessments').insert({
      learner_id: user.id,
      course_id: body.courseId,
      session_id: null,
      scene_id: null,
      assessment_type: 'course_final',
      score: totalScore,
      max_score: totalMax,
      feedback: parsed.feedback,
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : null,
      areas_to_improve: Array.isArray(parsed.areasToImprove) ? parsed.areasToImprove : null,
      evaluated_by: 'ai_evaluator',
    });
    if (insertError) throw insertError;

    const { error: recomputeError } = await admin.rpc('recompute_learning_metrics', {
      p_learner_id: user.id,
    });
    if (recomputeError) {
      log.error('Course-final assessment recorded but metrics recompute failed:', recomputeError);
    }

    return apiSuccess({ created: true, score: totalScore, maxScore: totalMax });
  } catch (error) {
    log.error('Failed to generate course-final assessment:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to generate course-final assessment',
    );
  }
}
