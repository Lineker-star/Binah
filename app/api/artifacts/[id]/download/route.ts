/**
 * GET /api/artifacts/[id]/download — a short-lived signed URL for one of
 * the signed-in learner's own generated artifacts, for the Downloads list's
 * re-download action.
 */
import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

const log = createLogger('ArtifactDownloadAPI');

const SIGNED_URL_TTL_SECONDS = 300;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return apiError('INVALID_REQUEST', 401, 'Not signed in');
    }

    const { data: artifact, error } = await supabase
      .from('generated_artifacts')
      .select('id, learner_id, storage_path')
      .eq('id', id)
      .eq('learner_id', user.id)
      .maybeSingle();
    if (error) throw error;
    if (!artifact || !artifact.storage_path) {
      return apiError('INVALID_REQUEST', 404, 'Artifact not found');
    }

    const admin = createServiceRoleClient();
    const { data: signed, error: signError } = await admin.storage
      .from('learner-exports')
      .createSignedUrl(artifact.storage_path as string, SIGNED_URL_TTL_SECONDS);
    if (signError) throw signError;
    if (!signed?.signedUrl) {
      return apiError('INTERNAL_ERROR', 500, 'Failed to sign download URL');
    }

    return apiSuccess({ url: signed.signedUrl });
  } catch (error) {
    log.error('Failed to sign artifact download URL:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to sign download URL',
    );
  }
}
