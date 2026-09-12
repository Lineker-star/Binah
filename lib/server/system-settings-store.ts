import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import type { SystemDefaultSection } from './provider-config';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export interface SystemSettingsWriteInput {
  section: SystemDefaultSection;
  /** null = the BB.2 global default row; a user id = that user's own row. */
  ownerId: string | null;
  providerId: string;
  modelId?: string | null;
  apiKey?: string | null;
  baseUrl?: string | null;
  extraConfig?: Record<string, unknown> | null;
  updatedBy: string;
}

/**
 * Upsert one system_settings row by (section, ownerId).
 *
 * Not a single atomic upsert: uniqueness on this table is enforced by two
 * PARTIAL indexes (system_settings_global_per_section on `(section) WHERE
 * owner_id IS NULL`, system_settings_owner_per_section on `(section,
 * owner_id) WHERE owner_id IS NOT NULL`) rather than one plain constraint,
 * since a single `unique(section, owner_id)` wouldn't actually enforce "at
 * most one global row per section" — SQL treats every NULL as distinct. A
 * bare `ON CONFLICT (section[, owner_id])` can't be inferred against a
 * partial index unless the statement repeats its WHERE clause, which
 * supabase-js's `.upsert()` has no way to express — confirmed directly
 * against the live DB (`42P10: there is no unique or exclusion constraint
 * matching the ON CONFLICT specification`) before writing this. Select-then-
 * write instead, matching the same accepted non-transactional simplification
 * `changeUserRole` (lib/supabase/admin.ts) already uses for this class of
 * low-frequency admin/settings action.
 */
export async function upsertSystemSettingsRow(
  supabase: ServerSupabaseClient,
  input: SystemSettingsWriteInput,
): Promise<{ error: string | null }> {
  const { section, ownerId, providerId, modelId, apiKey, baseUrl, extraConfig, updatedBy } = input;

  const existingQuery = supabase.from('system_settings').select('id').eq('section', section);
  const { data: existing, error: selectError } = await (
    ownerId ? existingQuery.eq('owner_id', ownerId) : existingQuery.is('owner_id', null)
  ).maybeSingle();
  if (selectError) return { error: selectError.message };

  const payload = {
    section,
    owner_id: ownerId,
    provider_id: providerId,
    model_id: modelId || null,
    api_key: apiKey || null,
    base_url: baseUrl || null,
    extra_config: extraConfig || null,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await supabase.from('system_settings').update(payload).eq('id', existing.id);
    return { error: error?.message ?? null };
  }
  const { error } = await supabase.from('system_settings').insert(payload);
  return { error: error?.message ?? null };
}
