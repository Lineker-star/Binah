/**
 * POST /api/artifacts/certificate-excellence — generate (idempotently) and
 * return a signed download URL for a "Certificate of Excellence": a
 * SEPARATE, ADDITIONAL certificate reserved for courses of more than 10
 * lessons, richer than the plain Certificate of Completion (see
 * app/api/artifacts/certificate/route.ts, which every completed course or
 * session still gets unconditionally, exactly as before this route
 * existed). A learner who finishes a small ad-hoc course gets only the
 * plain one; a learner who finishes a large structured course gets both,
 * independently.
 *
 * courseId-only — an ad-hoc single-prompt session (no courses row) is
 * always exactly one lesson by construction (see course-final's own
 * generalization in app/api/assessments/course-final/route.ts), so it can
 * never reach the threshold.
 *
 * Kept structurally distinct from the plain certificate so the two are
 * never confused in history/downloads: this writes generated_artifacts
 * with artifact_type='certificate_excellence' (vs plain 'certificate')
 * AND a linked `certificates` row (course_title, grade, overall_score,
 * skills_acquired, serial_code, issued_at) via certificates.artifact_id —
 * the plain certificate never gets a `certificates` row at all, so that
 * row's mere existence is itself an unambiguous tier marker.
 */
import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { buildCertificatePdf } from '@/lib/artifacts/certificate-pdf';
import { deriveGrade } from '@/lib/artifacts/certificate-grade';
import { generateSerialCode } from '@/lib/artifacts/serial-code';
import { generateSkillsAcquired } from '@/lib/server/certificate-skills';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import type { TextbookChaptersData } from '@/lib/textbook/types';

const log = createLogger('CertificateExcellenceAPI');

const SIGNED_URL_TTL_SECONDS = 300;
const LARGE_COURSE_LESSON_THRESHOLD = 10;

interface RequestBody {
  courseId?: string;
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
    const courseId = typeof body.courseId === 'string' ? body.courseId : null;
    if (!courseId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'courseId is required');
    }

    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('id, title, description, status, planned_lesson_count')
      .eq('id', courseId)
      .eq('learner_id', user.id)
      .maybeSingle();
    if (courseError) throw courseError;
    if (!course) {
      return apiError('INVALID_REQUEST', 404, 'Course not found');
    }
    if (course.status !== 'completed') {
      return apiError('INVALID_REQUEST', 400, 'Course is not completed yet');
    }

    // courses.planned_lesson_count for a textbook-sourced course is the
    // number of CHAPTERS selected to include, not the true lesson total —
    // each chapter can split into several lessons (lib/textbook/structure-
    // plan.ts). Prefer the book's own structured total when this course is
    // linked to one; fall back to planned_lesson_count for an ad-hoc
    // prompt-built Structured Course, where it IS the true total.
    const { data: ingestion } = await supabase
      .from('textbook_ingestions')
      .select('id, chapters')
      .eq('course_id', courseId)
      .maybeSingle();

    let lessonCount = 0;
    let topics: string[] = [];
    let bookSummary: string | null = null;

    if (ingestion) {
      const { data: chapterRows, error: chapterRowsError } = await supabase
        .from('book_chapters')
        .select('title, planned_lesson_count')
        .eq('ingestion_id', ingestion.id as string)
        .eq('is_front_or_back_matter', false)
        .order('chapter_number', { ascending: true });
      if (chapterRowsError) throw chapterRowsError;
      lessonCount = (chapterRows ?? []).reduce(
        (sum, c) => sum + ((c.planned_lesson_count as number | null) ?? 0),
        0,
      );
      topics = (chapterRows ?? []).map((c) => c.title as string);
      const chaptersData = ingestion.chapters as TextbookChaptersData | null;
      bookSummary = chaptersData?.wholeBookSummary || null;
    } else {
      const { data: sessions, error: sessionsError } = await supabase
        .from('learning_sessions')
        .select('title, lesson_number')
        .eq('course_id', courseId)
        .order('lesson_number', { ascending: true });
      if (sessionsError) throw sessionsError;
      lessonCount = sessions?.length ?? 0;
      topics = (sessions ?? []).map((s) => s.title as string);
    }
    if (lessonCount === 0) {
      lessonCount = (course.planned_lesson_count as number | null) ?? 0;
    }

    if (lessonCount <= LARGE_COURSE_LESSON_THRESHOLD) {
      return apiSuccess({ eligible: false });
    }

    const admin = createServiceRoleClient();

    // A Certificate of Excellence is a singleton per course, distinct from
    // (and independent of) the plain certificate's own singleton check. No
    // unique DB constraint backs this — a concurrent double-call can still
    // race past both selects before either insert lands.
    const { data: existingCert, error: existingCertError } = await admin
      .from('certificates')
      .select('artifact_id')
      .eq('learner_id', user.id)
      .eq('course_id', courseId)
      .maybeSingle();
    if (existingCertError) throw existingCertError;

    if (existingCert?.artifact_id) {
      const { data: artifact, error: artifactError } = await admin
        .from('generated_artifacts')
        .select('storage_path')
        .eq('id', existingCert.artifact_id as string)
        .maybeSingle();
      if (artifactError) throw artifactError;
      if (artifact?.storage_path) {
        const { data: signed, error: signError } = await admin.storage
          .from('learner-exports')
          .createSignedUrl(artifact.storage_path as string, SIGNED_URL_TTL_SECONDS);
        if (signError) throw signError;
        if (signed?.signedUrl) {
          return apiSuccess({ eligible: true, url: signed.signedUrl });
        }
      }
    }

    // Score source: course_final — the only assessment type guaranteed to
    // exist for any completed course, book-sourced or ad-hoc-prompt-built
    // alike (assessment_type='exam' never fires for a non-book Structured
    // Course at all). It's generated by a separate fire-and-forget call
    // right before this one (see PlaybackChromeRoot.tsx) — if it hasn't
    // landed yet, this is "pending," not an error: the caller's later
    // on-demand retry (the Download Certificate of Excellence button)
    // succeeds once it has.
    const { data: finalAssessment, error: finalAssessmentError } = await supabase
      .from('assessments')
      .select('score, max_score')
      .eq('course_id', courseId)
      .eq('assessment_type', 'course_final')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (finalAssessmentError) throw finalAssessmentError;
    if (!finalAssessment) {
      return apiSuccess({ eligible: true, pending: true });
    }

    const score = finalAssessment.score as number | null;
    const maxScore = finalAssessment.max_score as number | null;
    const scorePct =
      score != null && maxScore != null && maxScore > 0 ? (score / maxScore) * 100 : 0;
    const grade = deriveGrade(scorePct);

    const skillsAcquired = await generateSkillsAcquired(
      req,
      course.title as string,
      topics,
      bookSummary ?? (course.description as string | null),
    );

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle();
    const learnerName = (profile?.display_name as string | null) || user.email || 'Learner';

    const serialCode = generateSerialCode();

    const pdfBytes = await buildCertificatePdf({
      learnerName,
      courseTitle: course.title as string,
      completionDate: new Date(),
      heading: 'Certificate of Excellence',
      grade,
      overallScorePct: scorePct,
      skillsAcquired,
      serialCode,
    });

    const storagePath = `${user.id}/${crypto.randomUUID()}.pdf`;
    const { error: uploadError } = await admin.storage
      .from('learner-exports')
      .upload(storagePath, pdfBytes, { contentType: 'application/pdf' });
    if (uploadError) throw uploadError;

    const { data: insertedArtifact, error: artifactInsertError } = await admin
      .from('generated_artifacts')
      .insert({
        learner_id: user.id,
        course_id: courseId,
        session_id: null,
        artifact_type: 'certificate_excellence',
        storage_path: storagePath,
        file_size_bytes: pdfBytes.byteLength,
      })
      .select('id')
      .single();
    if (artifactInsertError) throw artifactInsertError;

    const { error: certInsertError } = await admin.from('certificates').insert({
      learner_id: user.id,
      course_id: courseId,
      session_id: null,
      artifact_id: insertedArtifact.id as string,
      course_title: course.title as string,
      grade,
      overall_score: scorePct,
      skills_acquired: skillsAcquired,
      serial_code: serialCode,
    });
    if (certInsertError) throw certInsertError;

    const { data: signed, error: signError } = await admin.storage
      .from('learner-exports')
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (signError) throw signError;
    if (!signed?.signedUrl) {
      return apiError('INTERNAL_ERROR', 500, 'Failed to sign certificate URL');
    }

    return apiSuccess({ eligible: true, url: signed.signedUrl });
  } catch (error) {
    log.error('Failed to generate/sign certificate of excellence:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to generate certificate of excellence',
    );
  }
}
