/**
 * Admin-only: read, save, or clear per-feature-group LLM routing — each
 * group (chat / content generation / assessment & grading / support) gets
 * its own provider+model+api key+base URL, plus an ordered list of fallback
 * candidates tried in sequence if the primary one fails (see
 * lib/ai/llm.ts's failover support in callLLM/streamLLM).
 *
 * Global-only (owner_id IS NULL) — there is no personal/BB.3 tier for this;
 * per-feature routing is an admin/system-wide concept, not a per-caller one.
 *
 * POST upserts one group's config and merges it into the live in-memory
 * cache immediately (lib/server/llm-feature-groups.ts's
 * mergeLLMFeatureGroup — resolve-model.ts picks it up with no further
 * changes). DELETE clears a group back to "no override" (the existing
 * MODEL_ROUTES/x-model/DEFAULT_MODEL resolution order resumes governing it).
 */
import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin } from '@/lib/server/require-admin';
import {
  LLM_FEATURE_GROUPS,
  mergeLLMFeatureGroup,
  type LLMCandidate,
  type LLMFeatureGroup,
} from '@/lib/server/llm-feature-groups';
import { upsertSystemSettingsRow } from '@/lib/server/system-settings-store';
import { createLogger } from '@/lib/logger';

const log = createLogger('AdminLLMFeatureGroups');

function isValidGroup(value: unknown): value is LLMFeatureGroup {
  return typeof value === 'string' && (LLM_FEATURE_GROUPS as readonly string[]).includes(value);
}

function isValidCandidate(value: unknown): value is LLMCandidate {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return typeof c.providerId === 'string' && !!c.providerId && typeof c.modelId === 'string' && !!c.modelId;
}

export async function GET() {
  const blocked = await requireAdmin();
  if (blocked) return blocked;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('system_settings')
    .select('section, provider_id, model_id, base_url, extra_config, updated_at')
    .is('owner_id', null)
    .in('section', LLM_FEATURE_GROUPS as readonly string[]);
  if (error) return apiError('INTERNAL_ERROR', 500, error.message);

  return apiSuccess({ groups: data ?? [] });
}

export async function POST(req: NextRequest) {
  const blocked = await requireAdmin();
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const { group, providerId, modelId, apiKey, baseUrl, fallbacks } = body as {
      group?: string;
      providerId?: string;
      modelId?: string;
      apiKey?: string;
      baseUrl?: string;
      fallbacks?: unknown;
    };

    if (!isValidGroup(group)) {
      return apiError('INVALID_REQUEST', 400, 'Invalid or missing group');
    }
    if (!providerId) {
      return apiError('MISSING_PROVIDER', 400, 'Missing providerId');
    }
    if (!modelId) {
      return apiError('MISSING_MODEL', 400, 'Missing modelId');
    }
    const fallbackList: LLMCandidate[] = Array.isArray(fallbacks)
      ? fallbacks.filter(isValidCandidate)
      : [];

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return apiError('UNAUTHENTICATED', 401, 'Sign-in required');

    const { error: upsertError } = await upsertSystemSettingsRow(supabase, {
      section: group,
      ownerId: null,
      providerId,
      modelId,
      apiKey,
      baseUrl,
      extraConfig: { fallbacks: fallbackList },
      updatedBy: user.id,
    });
    if (upsertError) return apiError('INTERNAL_ERROR', 500, upsertError);

    // Best-effort — the setting is already saved even if this write fails.
    const { error: auditError } = await supabase.from('admin_audit_log').insert({
      admin_id: user.id,
      action: 'llm_feature_group_change',
      target_user_id: null,
      details: { group, providerId, modelId, fallbackCount: fallbackList.length },
    });
    if (auditError) log.warn('Failed to record audit log entry:', auditError);

    mergeLLMFeatureGroup(group, {
      primary: { providerId, modelId, apiKey, baseUrl },
      fallbacks: fallbackList,
    });

    return apiSuccess({ group });
  } catch (err) {
    log.error('Failed to save LLM feature-group routing:', err);
    return apiError('INTERNAL_ERROR', 500, err instanceof Error ? err.message : 'Unknown error');
  }
}

export async function DELETE(req: NextRequest) {
  const blocked = await requireAdmin();
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const { group } = body as { group?: string };
    if (!isValidGroup(group)) {
      return apiError('INVALID_REQUEST', 400, 'Invalid or missing group');
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from('system_settings')
      .delete()
      .eq('section', group)
      .is('owner_id', null);
    if (error) return apiError('INTERNAL_ERROR', 500, error.message);

    mergeLLMFeatureGroup(group, null);

    return apiSuccess({ group });
  } catch (err) {
    log.error('Failed to clear LLM feature-group routing:', err);
    return apiError('INTERNAL_ERROR', 500, err instanceof Error ? err.message : 'Unknown error');
  }
}
