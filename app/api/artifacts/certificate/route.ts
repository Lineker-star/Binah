/**
 * POST /api/artifacts/certificate — generate (idempotently) and return a
 * signed download URL for a completed course's certificate. A certificate
 * is naturally a singleton per course: if one already exists for this
 * learner+course, this signs and returns the existing storage object
 * instead of creating a duplicate generated_artifacts row/Storage object.
 *
 * Callable two ways: fire-and-forget right when a course completes (see
 * components/edit/PlaybackChromeRoot.tsx), and on-demand from the
 * "Download Certificate" action — the idempotency means both land on the
 * same object either way, including the race where a learner clicks
 * download before the fire-and-forget generation has finished.
 */
import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { buildCertificatePdf } from '@/lib/artifacts/certificate-pdf';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

const log = createLogger('CertificateAPI');

const SIGNED_URL_TTL_SECONDS = 300;

interface RequestBody {
  courseId: string;
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

    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('id, title, status')
      .eq('id', body.courseId)
      .eq('learner_id', user.id)
      .maybeSingle();
    if (courseError) throw courseError;
    if (!course) {
      return apiError('INVALID_REQUEST', 404, 'Course not found');
    }
    if (course.status !== 'completed') {
      return apiError('INVALID_REQUEST', 400, 'Course is not completed yet');
    }

    const admin = createServiceRoleClient();

    const { data: existing, error: existingError } = await admin
      .from('generated_artifacts')
      .select('id, storage_path')
      .eq('learner_id', user.id)
      .eq('course_id', body.courseId)
      .eq('artifact_type', 'certificate')
      .maybeSingle();
    if (existingError) throw existingError;

    let storagePath: string;
    if (existing?.storage_path) {
      storagePath = existing.storage_path as string;
    } else {
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .maybeSingle();
      const learnerName = (profile?.display_name as string | null) || user.email || 'Learner';

      const pdfBytes = await buildCertificatePdf({
        learnerName,
        courseTitle: course.title as string,
        completionDate: new Date(),
      });

      storagePath = `${user.id}/${crypto.randomUUID()}.pdf`;
      const { error: uploadError } = await admin.storage
        .from('learner-exports')
        .upload(storagePath, pdfBytes, { contentType: 'application/pdf' });
      if (uploadError) throw uploadError;

      const { error: insertError } = await admin.from('generated_artifacts').insert({
        learner_id: user.id,
        course_id: body.courseId,
        session_id: null,
        artifact_type: 'certificate',
        storage_path: storagePath,
        file_size_bytes: pdfBytes.byteLength,
      });
      if (insertError) throw insertError;
    }

    const { data: signed, error: signError } = await admin.storage
      .from('learner-exports')
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (signError) throw signError;
    if (!signed?.signedUrl) {
      return apiError('INTERNAL_ERROR', 500, 'Failed to sign certificate URL');
    }

    return apiSuccess({ url: signed.signedUrl });
  } catch (error) {
    log.error('Failed to generate/sign certificate:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to generate certificate',
    );
  }
}
