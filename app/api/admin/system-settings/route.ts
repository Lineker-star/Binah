/**
 * Admin-only: read, save, or clear the LLM/image/video/TTS/ASR/PDF defaults
 * used by every learner account system-wide (BB.1) — learners have no
 * settings of their own to override this with.
 *
 * Always the owner_id IS NULL row per section — a parent's own row (BB.3,
 * see app/api/settings/provider-defaults/route.ts) is a separate, disjoint
 * tier this route never reads, writes, or clears.
 *
 * GET returns the current default's providerId/modelId per section (never
 * the api_key) so the Settings dialog can show "Learner default: X" labels.
 * POST upserts one section's default and merges it into the live
 * provider-config cache immediately (lib/server/provider-config.ts's
 * mergeSystemProviderDefault — every existing resolver, and every generation
 * route, picks it up with no changes of their own). DELETE clears a section
 * back to "no admin default" (YAML/env or per-provider client keys resume
 * governing it).
 */
import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin } from '@/lib/server/require-admin';
import { mergeSystemProviderDefault, type SystemDefaultSection } from '@/lib/server/provider-config';
import { upsertSystemSettingsRow } from '@/lib/server/system-settings-store';
import { createLogger } from '@/lib/logger';

const log = createLogger('AdminSystemSettings');

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
  const blocked = await requireAdmin();
  if (blocked) return blocked;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('system_settings')
    .select('section, provider_id, model_id, updated_at')
    .is('owner_id', null);
  if (error) return apiError('INTERNAL_ERROR', 500, error.message);

  return apiSuccess({ defaults: data ?? [] });
}

export async function POST(req: NextRequest) {
  const blocked = await requireAdmin();
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

    const { error: upsertError } = await upsertSystemSettingsRow(supabase, {
      section,
      ownerId: null,
      providerId,
      modelId,
      apiKey,
      baseUrl,
      extraConfig,
      updatedBy: user.id,
    });
    if (upsertError) return apiError('INTERNAL_ERROR', 500, upsertError);

    // Best-effort — the setting is already saved even if this write fails.
    const { error: auditError } = await supabase.from('admin_audit_log').insert({
      admin_id: user.id,
      action: 'system_settings_change',
      target_user_id: null,
      details: { section, providerId, modelId: modelId ?? null },
    });
    if (auditError) log.warn('Failed to record audit log entry:', auditError);

    mergeSystemProviderDefault(section, {
      providerId,
      apiKey,
      baseUrl,
      models: modelId ? [modelId] : undefined,
      accessKeyId: extraConfig?.accessKeyId,
      accessKeySecret: extraConfig?.accessKeySecret,
    });

    return apiSuccess({ section, providerId });
  } catch (err) {
    log.error('Failed to save system setting:', err);
    return apiError('INTERNAL_ERROR', 500, err instanceof Error ? err.message : 'Unknown error');
  }
}

export async function DELETE(req: NextRequest) {
  const blocked = await requireAdmin();
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const { section } = body as { section?: string };
    if (!isValidSection(section)) {
      return apiError('INVALID_REQUEST', 400, 'Invalid or missing section');
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from('system_settings')
      .delete()
      .eq('section', section)
      .is('owner_id', null);
    if (error) return apiError('INTERNAL_ERROR', 500, error.message);

    mergeSystemProviderDefault(section, null);

    return apiSuccess({ section });
  } catch (err) {
    log.error('Failed to clear system setting:', err);
    return apiError('INTERNAL_ERROR', 500, err instanceof Error ? err.message : 'Unknown error');
  }
}
