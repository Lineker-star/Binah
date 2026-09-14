/**
 * Per-feature-group LLM routing — lets an admin point different areas of the
 * app at entirely different providers/models/keys/base URLs, each with its
 * own ordered fallback chain (see lib/ai/llm.ts's sequential-failover
 * support in callLLM/streamLLM).
 *
 * Deliberately a SEPARATE cache from lib/server/provider-config.ts's
 * ServerConfig: that cache's sections (providers/tts/asr/pdf/image/video/
 * webSearch) are fixed properties of a typed interface, keyed by provider id,
 * and merged under YAML/env file-wins precedence. A feature group is keyed by
 * an admin-defined *stage grouping* that has no YAML/env equivalent at all,
 * and carries its own independent api key/base url per candidate (primary +
 * fallbacks) rather than reusing a shared provider-level credential — folding
 * it into ServerConfig would mean indexing that interface with keys it was
 * never typed to have.
 *
 * Same load-bearing lifecycle as system-provider-defaults.ts: hydrated once
 * at boot and on a periodic refresh (see instrumentation.ts), with the
 * admin-save route also calling mergeLLMFeatureGroup directly for immediate
 * same-instance effect.
 */
import 'server-only';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { createLogger } from '@/lib/logger';
import type { LlmStage } from './model-routes';

const log = createLogger('LLMFeatureGroups');

export const LLM_FEATURE_GROUPS = [
  'llm_chat',
  'llm_content_generation',
  'llm_assessment_grading',
  'llm_support',
] as const;

export type LLMFeatureGroup = (typeof LLM_FEATURE_GROUPS)[number];

/**
 * Maps every routable stage (lib/server/model-routes.ts's LLM_STAGES) to the
 * admin-facing group it belongs to. A judgment call, not a derived fact —
 * grouped by what an admin would actually reason about (the conversational
 * surface, content production, grading, small utility calls) rather than by
 * internal implementation boundaries.
 */
const STAGE_TO_GROUP: Record<LlmStage, LLMFeatureGroup> = {
  'scene-outlines-stream': 'llm_content_generation',
  'scene-content': 'llm_content_generation',
  'scene-content:slide': 'llm_content_generation',
  'scene-content:quiz': 'llm_content_generation',
  'scene-content:interactive': 'llm_content_generation',
  'scene-content:pbl': 'llm_content_generation',
  'scene-actions': 'llm_content_generation',
  'agent-profiles': 'llm_content_generation',
  'course-final-assessment': 'llm_assessment_grading',
  'continuous-assessment': 'llm_assessment_grading',
  exam: 'llm_assessment_grading',
  'certificate-skills': 'llm_assessment_grading',
  'assessment-recommendation': 'llm_assessment_grading',
  'lecture-notes': 'llm_content_generation',
  'textbook-chapter-fallback': 'llm_content_generation',
  'textbook-chapter-summary': 'llm_content_generation',
  'textbook-book-summary': 'llm_content_generation',
  'audio-overview-script': 'llm_content_generation',
  'quiz-grade': 'llm_assessment_grading',
  'pbl-chat': 'llm_chat',
  'pbl-v2-runtime': 'llm_chat',
  'pbl-v2-runtime:instructor': 'llm_chat',
  'pbl-v2-runtime:open-task': 'llm_chat',
  'pbl-v2-runtime:evaluate': 'llm_assessment_grading',
  'pbl-v2-runtime:simulator': 'llm_chat',
  'chat-adapter': 'llm_chat',
  'generate-classroom': 'llm_content_generation',
  'web-search-query-rewrite': 'llm_support',
  'maic-agent': 'llm_chat',
  'maic-agent-driver': 'llm_chat',
  'conversation-title': 'llm_support',
};

export function getFeatureGroupForStage(stage?: LlmStage): LLMFeatureGroup | undefined {
  if (!stage) return undefined;
  return STAGE_TO_GROUP[stage];
}

export interface LLMCandidate {
  providerId: string;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface LLMFeatureGroupConfig {
  primary: LLMCandidate;
  fallbacks: LLMCandidate[];
}

const _cache = new Map<LLMFeatureGroup, LLMFeatureGroupConfig>();

export function getFeatureGroupConfig(group: LLMFeatureGroup): LLMFeatureGroupConfig | undefined {
  return _cache.get(group);
}

/** Same-instance immediate effect right after an admin's save; entry `null` clears. */
export function mergeLLMFeatureGroup(
  group: LLMFeatureGroup,
  entry: LLMFeatureGroupConfig | null,
): void {
  if (!entry) {
    _cache.delete(group);
    return;
  }
  _cache.set(group, entry);
}

interface FeatureGroupRow {
  section: string;
  provider_id: string;
  model_id: string | null;
  api_key: string | null;
  base_url: string | null;
  extra_config: { fallbacks?: LLMCandidate[] } | null;
}

/**
 * Reads every global (owner_id IS NULL) system_settings row for the 4
 * feature-group sections and merges each into the in-memory cache. Called
 * once at boot (instrumentation.ts) and on the same periodic timer as
 * hydrateSystemProviderDefaults, for multi-instance eventual consistency.
 */
export async function hydrateLLMFeatureGroups(): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from('system_settings')
      .select('section, provider_id, model_id, api_key, base_url, extra_config')
      .is('owner_id', null)
      .in('section', LLM_FEATURE_GROUPS as readonly string[]);
    if (error) throw error;

    const rows = (data ?? []) as FeatureGroupRow[];
    const bySection = new Map(rows.map((r) => [r.section, r]));

    for (const group of LLM_FEATURE_GROUPS) {
      const row = bySection.get(group);
      if (!row || !row.model_id) {
        mergeLLMFeatureGroup(group, null);
        continue;
      }
      mergeLLMFeatureGroup(group, {
        primary: {
          providerId: row.provider_id,
          modelId: row.model_id,
          apiKey: row.api_key || undefined,
          baseUrl: row.base_url || undefined,
        },
        fallbacks: row.extra_config?.fallbacks ?? [],
      });
    }
  } catch (err) {
    log.warn('Failed to hydrate LLM feature-group routing (leaving prior cache in place):', err);
  }
}
