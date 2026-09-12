/**
 * Self-service (parent or admin, never learner — BB.1): read, save, or
 * clear the caller's OWN LLM/image/video/TTS/ASR/PDF provider choice
 * (BB.3). Distinct from app/api/admin/system-settings/route.ts, which is
 * admin-only and manages the single GLOBAL default (BB.2) every learner
 * falls back to — this route only ever touches the row where
 * owner_id = the caller's own id, enforced both here and by
 * system_settings_owner_all (RLS refuses a learner or a different owner's
 * row regardless of what this route does).
 *
 * Deliberately does NOT touch lib/server/provider-config.ts's cache or any
 * generation route: a personal choice is per-caller, not process-wide, so
 * it's resolved the same way client-supplied credentials always have been —
 * the client sends its own key on its own request. This route exists only
 * so that choice survives across devices: GET rehydrates the caller's own
 * saved row(s) into their local settings store (see fetchOwnProviderDefaults
 * in lib/store/settings.ts) instead of leaving it in one browser's storage.
 */
import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { blockLearnerAccess } from '@/lib/server/require-not-learner';
import type { SystemDefaultSection } from '@/lib/server/provider-config';
import { upsertSystemSettingsRow } from '@/lib/server/system-settings-store';
import { createLogger } from '@/lib/logger';

const log = createLogger('OwnProviderDefaults');

const VALID_SECTIONS: SystemDefaultSection[] = [
  'providers',
  'image',
  'video',
  'tts',
  'asr',
  'pdf',
  'webSearch',
];

function isValidSection(value: unknown): value is SystemDefaultSection {
  return typeof value === 'string' && (VALID_SECTIONS as string[]).includes(value);
}

export async function GET() {
  const blocked = await blockLearnerAccess();
  if (blocked) return blocked;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHENTICATED', 401, 'Sign-in required');

  // RLS (system_settings_owner_all) already restricts this to the caller's
  // own rows, but an admin caller also matches system_settings_admin_all
  // (every row) — the explicit filter keeps this response scoped to "my own
  // choice" specifically, regardless of the caller's other privileges.
  const { data, error } = await supabase
    .from('system_settings')
    .select('section, provider_id, model_id, api_key, base_url, extra_config')
    .eq('owner_id', user.id);
  if (error) return apiError('INTERNAL_ERROR', 500, error.message);

  return apiSuccess({ defaults: data ?? [] });
}

export async function POST(req: NextRequest) {
  const blocked = await blockLearnerAccess();
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const { section, providerId, modelId, apiKey, baseUrl, extraConfig } = body as {
      section?: string;
      providerId?: string;
      modelId?: string;
      apiKey?: string;
      baseUrl?: string;
      extraConfig?: { accessKeyId?: string; accessKeySecret?: string };
    };

    if (!isValidSection(section)) {
      return apiError('INVALID_REQUEST', 400, 'Invalid or missing section');
    }
    if (!providerId) {
      return apiError('MISSING_PROVIDER', 400, 'Missing providerId');
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return apiError('UNAUTHENTICATED', 401, 'Sign-in required');

    const { error } = await upsertSystemSettingsRow(supabase, {
      section,
      ownerId: user.id,
      providerId,
      modelId,
      apiKey,
      baseUrl,
      extraConfig,
      updatedBy: user.id,
    });
    if (error) return apiError('INTERNAL_ERROR', 500, error);

    return apiSuccess({ section, providerId });
  } catch (err) {
    log.error('Failed to save own provider default:', err);
    return apiError('INTERNAL_ERROR', 500, err instanceof Error ? err.message : 'Unknown error');
  }
}

export async function DELETE(req: NextRequest) {
  const blocked = await blockLearnerAccess();
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const { section } = body as { section?: string };
    if (!isValidSection(section)) {
      return apiError('INVALID_REQUEST', 400, 'Invalid or missing section');
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return apiError('UNAUTHENTICATED', 401, 'Sign-in required');

    const { error } = await supabase
      .from('system_settings')
      .delete()
      .eq('section', section)
      .eq('owner_id', user.id);
    if (error) return apiError('INTERNAL_ERROR', 500, error.message);

    return apiSuccess({ section });
  } catch (err) {
    log.error('Failed to clear own provider default:', err);
    return apiError('INTERNAL_ERROR', 500, err instanceof Error ? err.message : 'Unknown error');
  }
}
