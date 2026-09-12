import 'server-only';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { mergeSystemProviderDefault, type SystemDefaultSection } from './provider-config';
import { createLogger } from '@/lib/logger';

const log = createLogger('SystemProviderDefaults');

interface SystemSettingsRow {
  section: SystemDefaultSection;
  provider_id: string;
  model_id: string | null;
  api_key: string | null;
  base_url: string | null;
  extra_config: { accessKeyId?: string; accessKeySecret?: string } | null;
}

const ALL_SECTIONS: SystemDefaultSection[] = [
  'providers',
  'image',
  'video',
  'tts',
  'asr',
  'pdf',
  'webSearch',
];

/**
 * Reads every `system_settings` row (admin-only RLS — a service-role client
 * is required here, not the request-scoped anon-key client) and merges each
 * into the live provider-config cache, so a learner's generation request
 * picks up an admin's saved default the same way it already picks up a
 * YAML/env-configured provider. Clears sections with no row so a deleted
 * default doesn't linger past this refresh.
 *
 * Called once at boot (instrumentation.ts) and on a periodic timer for
 * multi-instance eventual consistency; the admin-save route also calls
 * mergeSystemProviderDefault directly for immediate same-instance effect.
 */
export async function hydrateSystemProviderDefaults(): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    // owner_id IS NULL only — a personal (BB.3) row must never leak into the
    // global (BB.2) cache this feeds. The service-role client bypasses RLS
    // entirely, so this filter is the only thing enforcing that boundary here.
    const { data, error } = await supabase
      .from('system_settings')
      .select('section, provider_id, model_id, api_key, base_url, extra_config')
      .is('owner_id', null);
    if (error) throw error;

    const rows = (data ?? []) as SystemSettingsRow[];
    const bySection = new Map(rows.map((r) => [r.section, r]));

    for (const section of ALL_SECTIONS) {
      const row = bySection.get(section);
      mergeSystemProviderDefault(
        section,
        row
          ? {
              providerId: row.provider_id,
              apiKey: row.api_key || undefined,
              baseUrl: row.base_url || undefined,
              models: row.model_id ? [row.model_id] : undefined,
              accessKeyId: row.extra_config?.accessKeyId,
              accessKeySecret: row.extra_config?.accessKeySecret,
            }
          : null,
      );
    }
  } catch (err) {
    // Non-fatal: a failed refresh leaves the previous cache state in place
    // (or, on a cold boot failure, simply no system-settings entries) rather
    // than taking generation down for every learner.
    log.warn('Failed to hydrate system provider defaults (leaving prior cache in place):', err);
  }
}
