/**
 * POST /api/artifacts/record — persist an already-generated export (built
 * entirely client-side, as every export format is) to durable storage and
 * record it in `generated_artifacts`, so it survives past the one-time
 * browser download and can be re-downloaded later from the learner's
 * Downloads list.
 *
 * A signed-out visitor can still export today (unchanged) — there's simply
 * no learner to attach a permanent record to, so this is a silent no-op
 * for them rather than an error.
 */
import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

const log = createLogger('ArtifactsRecordAPI');

const ARTIFACT_TYPES = ['pptx', 'resource_pack', 'classroom_zip', 'mp4', 'lecture_notes_pdf'] as const;
type ArtifactType = (typeof ARTIFACT_TYPES)[number];

function isArtifactType(value: unknown): value is ArtifactType {
  return typeof value === 'string' && (ARTIFACT_TYPES as readonly string[]).includes(value);
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return apiSuccess({ recorded: false, reason: 'not_signed_in' });
    }

    const form = await req.formData();
    const file = form.get('file');
    const artifactType = form.get('artifactType');
    const sessionId = form.get('sessionId');
    const courseId = form.get('courseId');

    if (!(file instanceof File)) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'file is required');
    }
    if (!isArtifactType(artifactType)) {
      return apiError(
        'INVALID_REQUEST',
        400,
        `artifactType must be one of ${ARTIFACT_TYPES.join(', ')}`,
      );
    }

    const admin = createServiceRoleClient();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
    const objectPath = `${user.id}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await admin.storage
      .from('learner-exports')
      .upload(objectPath, bytes, {
        contentType: file.type || 'application/octet-stream',
      });
    if (uploadError) throw uploadError;

    const { error: insertError } = await admin.from('generated_artifacts').insert({
      learner_id: user.id,
      session_id: typeof sessionId === 'string' ? sessionId : null,
      course_id: typeof courseId === 'string' ? courseId : null,
      artifact_type: artifactType,
      storage_path: objectPath,
      file_size_bytes: bytes.byteLength,
    });
    if (insertError) throw insertError;

    return apiSuccess({ recorded: true, storagePath: objectPath });
  } catch (error) {
    log.error('Failed to record generated artifact:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to record artifact',
    );
  }
}
