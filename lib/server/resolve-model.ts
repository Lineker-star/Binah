/**
 * Shared model resolution utilities for API routes.
 *
 * Extracts the repeated parseModelString → resolveApiKey → resolveBaseUrl →
 * resolveProxy → getModel boilerplate into a single call.
 */

import type { NextRequest } from 'next/server';
import { getModel, getProvider, parseModelString, type ModelWithInfo } from '@/lib/ai/providers';
import type { LanguageModel } from 'ai';
import type { ProviderId, ProviderType, ThinkingConfig } from '@/lib/types/provider';
import {
  isServerConfiguredProvider,
  resolveApiKey,
  resolveBaseUrl,
  resolveProxy,
} from '@/lib/server/provider-config';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';
import { fetchWithRedirectValidation } from '@/lib/server/fetch-with-redirect-validation';
import { getStageRoute, type LlmStage } from '@/lib/server/model-routes';
import {
  getFeatureGroupConfig,
  getFeatureGroupForStage,
  type LLMCandidate,
} from '@/lib/server/llm-feature-groups';

export interface ResolvedModel extends ModelWithInfo {
  /** Original model string (e.g. "openai/gpt-4o-mini") */
  modelString: string;
  /** Resolved provider ID (e.g. "openai", "ollama") */
  providerId: string;
  /** Resolved model ID (e.g. "gpt-4o-mini") */
  modelId: string;
  /** Effective API key after server-side fallback resolution */
  apiKey: string;
  /** Effective base URL after server/client resolution */
  baseUrl?: string;
  /** Optional per-request thinking configuration from the client. */
  thinkingConfig?: ThinkingConfig;
  /**
   * Ordered fallback models to try, in order, if `model` throws — an admin's
   * saved per-feature-group failover chain (see lib/server/llm-feature-
   * groups.ts). Present only when this stage's feature group has one
   * configured; undefined otherwise (unrouted/no-fallback stages behave
   * exactly as before this existed). Pass straight through to callLLM/
   * streamLLM's `fallbackModels` option.
   */
  fallbackModels?: LanguageModel[];
}

/** Build a ready-to-use LanguageModel for one feature-group candidate. */
function buildCandidateModel(candidate: LLMCandidate): LanguageModel {
  const providerId = candidate.providerId as ProviderId;
  const apiKey = candidate.apiKey || resolveApiKey(candidate.providerId, undefined);
  const baseUrl = candidate.baseUrl || resolveBaseUrl(candidate.providerId, undefined);
  const proxy = resolveProxy(candidate.providerId);
  return getModel({
    providerId,
    modelId: candidate.modelId,
    apiKey,
    baseUrl,
    proxy,
    fetchImpl: fetchWithRedirectValidation,
  }).model;
}

/**
 * Resolve a language model from explicit parameters.
 *
 * Use this when model config comes from the request body.
 */
export async function resolveModel(params: {
  modelString?: string;
  /**
   * Optional generation stage (a `callLLM` source label, e.g. 'scene-content').
   * When set and a route is configured via `MODEL_ROUTES`, the route wins for
   * this call — even over a client-sent `modelString` (x-model). Unrouted
   * stages fall back to `modelString` then `DEFAULT_MODEL`. See
   * lib/server/model-routes.ts.
   */
  stage?: LlmStage;
  apiKey?: string;
  baseUrl?: string;
  providerType?: string;
  thinkingConfig?: ThinkingConfig;
}): Promise<ResolvedModel> {
  // Resolution order: stage route > x-model > DEFAULT_MODEL.
  // A configured stage route is the operator's deliberate per-stage choice and
  // wins even over a client-sent x-model (otherwise the browser UI, which always
  // sends its saved model, would shadow every route). Unrouted stages fall back
  // to the client x-model, then DEFAULT_MODEL. There is intentionally no hardcoded
  // model fallback — if nothing resolves we fail loud rather than silently pick a
  // vendor default.
  const stageRoute = getStageRoute(params.stage);
  const stageModel = stageRoute?.model;

  // Admin-configured per-feature-group routing (chat / content generation /
  // assessment & grading / support) — skipped entirely when the operator has
  // already pinned this stage via MODEL_ROUTES (file-wins, same precedent as
  // every other admin-settable default in this app). Sits ABOVE the client's
  // x-model: a learner has no settings of their own (BB.1) and a parent/
  // admin's x-model reflects their own feature-agnostic choice, so without
  // this precedence a feature group could never actually take effect.
  const featureGroup = stageModel ? undefined : getFeatureGroupForStage(params.stage);
  const groupConfig = featureGroup ? getFeatureGroupConfig(featureGroup) : undefined;
  const groupModelString = groupConfig
    ? `${groupConfig.primary.providerId}:${groupConfig.primary.modelId}`
    : undefined;

  const modelString =
    stageModel || groupModelString || params.modelString || process.env.DEFAULT_MODEL;
  if (!modelString) {
    throw new Error(
      'No model could be resolved. Configure DEFAULT_MODEL (and/or a MODEL_ROUTES entry for this stage), or send a model via x-model.',
    );
  }
  const { providerId, modelId } = parseModelString(modelString);

  // When a stage route or feature-group override wins, the client-sent
  // connection params (apiKey/baseUrl/providerType) belong to the client's
  // *other* model and must not bleed onto this one — otherwise e.g. a routed
  // Anthropic model would be built with the client's OpenAI providerType/key.
  // Resolves purely from server config, as if no x-model was sent.
  const routed = Boolean(stageModel) || Boolean(groupModelString);
  const clientApiKey = routed ? undefined : params.apiKey;
  const clientProviderType = routed ? undefined : params.providerType;
  const clientBaseUrlParam = routed ? undefined : params.baseUrl;

  // Server-managed providers are admin-owned: the operator's key and base URL
  // are authoritative and any client-sent override is ignored. Origin URL
  // validation therefore applies only to unmanaged providers, where the base
  // URL really is client-supplied. (Server-configured URLs are trusted by the
  // operator.) Every provider fetch still runs through a transport that
  // re-validates redirect hops: no upstream can be assumed to redirect only to
  // public targets, so the hop target is checked regardless of who chose the
  // origin.
  const managed = isServerConfiguredProvider('providers', providerId);
  const registeredProviderType = getProvider(providerId)?.type;
  if (
    clientProviderType &&
    registeredProviderType &&
    clientProviderType !== registeredProviderType
  ) {
    throw new Error(
      `Provider type mismatch for ${providerId}: expected ${registeredProviderType}, received ${clientProviderType}.`,
    );
  }
  const effectiveProviderType = (clientProviderType || registeredProviderType) as
    | ProviderType
    | undefined;
  if (effectiveProviderType === 'bedrock' && (providerId !== 'bedrock' || !managed)) {
    throw new Error('Amazon Bedrock must be enabled by the server operator before it can be used.');
  }
  const clientBaseUrl = managed ? undefined : clientBaseUrlParam || undefined;
  if (clientBaseUrl) {
    const ssrfError = await validateUrlForSSRF(clientBaseUrl);
    if (ssrfError) {
      throw new Error(ssrfError);
    }
  }

  // A feature-group primary carries its own independent key/base URL (per
  // the admin-facing design: each feature can point at a wholly separate
  // vendor account, not just a different model on the shared one) — falls
  // through to the normal managed/unmanaged resolution only when the admin
  // left it blank, e.g. deliberately reusing an already-configured provider.
  const apiKey = groupModelString
    ? groupConfig!.primary.apiKey || resolveApiKey(providerId, '')
    : resolveApiKey(providerId, clientApiKey || '');
  const baseUrl = groupModelString
    ? groupConfig!.primary.baseUrl || resolveBaseUrl(providerId, undefined)
    : resolveBaseUrl(providerId, clientBaseUrl);
  const proxy = resolveProxy(providerId);
  const { model, modelInfo } = getModel({
    providerId,
    modelId,
    apiKey,
    baseUrl,
    proxy,
    providerType: clientProviderType as ProviderType | undefined,
    // Re-validate every redirect hop of the outbound request (see
    // fetchWithRedirectValidation); the base URL above is checked at origin.
    fetchImpl: fetchWithRedirectValidation,
  });
  const fallbackModels =
    groupConfig && groupConfig.fallbacks.length > 0
      ? groupConfig.fallbacks.map(buildCandidateModel)
      : undefined;

  // Thinking arbitration mirrors model routing — the route carries a full
  // ThinkingConfig (mode/effort/level/enabled/budgetTokens/…) which callLLM
  // normalizes against the model's capability:
  //  - routed + thinking set → the route's thinking wins (over client thinking).
  //  - routed + no thinking  → routed model uses its own default; client thinking
  //    is dropped (it belonged to the client's other model).
  //  - unrouted              → honor the client's thinking config.
  const thinkingConfig: ThinkingConfig | undefined = routed
    ? stageRoute?.thinking
    : params.thinkingConfig;

  return {
    model,
    modelInfo,
    modelString,
    providerId,
    modelId,
    apiKey,
    baseUrl,
    thinkingConfig,
    fallbackModels,
  };
}

function getThinkingConfigFromBody(body: unknown): ThinkingConfig | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as { thinkingConfig?: unknown; thinking?: unknown };
  const config = record.thinkingConfig ?? record.thinking;
  return config && typeof config === 'object' ? (config as ThinkingConfig) : undefined;
}

/**
 * Resolve a language model from standard request headers.
 *
 * Reads: x-model, x-api-key, x-base-url, x-provider-type
 * Note: requiresApiKey is derived server-side from the provider registry,
 * never from client headers, to prevent auth bypass.
 */
export async function resolveModelFromHeaders(
  req: NextRequest,
  stage?: LlmStage,
  thinkingConfig?: ThinkingConfig,
): Promise<ResolvedModel> {
  return resolveModel({
    modelString: req.headers.get('x-model') || undefined,
    stage,
    apiKey: req.headers.get('x-api-key') || undefined,
    baseUrl: req.headers.get('x-base-url') || undefined,
    providerType: req.headers.get('x-provider-type') || undefined,
    thinkingConfig,
  });
}

/**
 * Resolve a language model from standard request headers plus body fields.
 *
 * Reads model credentials from headers and per-request thinking config from
 * the JSON body field `thinkingConfig` (or legacy/eval field `thinking`).
 */
export async function resolveModelFromRequest(
  req: NextRequest,
  body: unknown,
  stage?: LlmStage,
): Promise<ResolvedModel> {
  // Pass the client's body thinking into resolveModel so the single arbiter
  // there decides (a routed stage may override or drop it). See resolveModel.
  return resolveModelFromHeaders(req, stage, getThinkingConfigFromBody(body));
}
