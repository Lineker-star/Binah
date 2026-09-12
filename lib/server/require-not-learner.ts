import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { apiError, type ApiErrorBody } from './api-response';
import type { NextResponse } from 'next/server';

/**
 * Guard for settings-only routes that configure LLM/image/video/TTS/ASR/PDF
 * providers (verify-model, provider/probe-models, verify-image-provider,
 * verify-video-provider, verify-pdf-provider). Hiding their Settings tabs is
 * a UI convenience, not enforcement — a learner could still hit these routes
 * directly, so each one calls this first.
 *
 * Returns a NextResponse to return immediately when the request must be
 * blocked, or null when it may proceed. Does NOT gate generation routes
 * (`/api/generate/*`, `/api/parse-pdf`, `/api/transcription`,
 * `/api/comfyui-workflows`) — those stay reachable for real course
 * generation regardless of role; only the standalone configure/verify
 * actions are learner-blocked here.
 */
export async function blockLearnerAccess(): Promise<NextResponse<ApiErrorBody> | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return apiError('UNAUTHENTICATED', 401, 'Sign-in required');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (profile?.role === 'learner') {
    return apiError(
      'ROLE_NOT_ALLOWED',
      403,
      'This setting is not available for learner accounts',
    );
  }

  return null;
}
