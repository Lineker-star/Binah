/**
 * Client-only TTS config resolution — split out of tts-providers.ts, which
 * also carries server-only synthesis logic (generateTTS and friends) that
 * transitively imports lib/server/provider-config.ts (Node's `fs`/`path`).
 * Anything reachable from a Client Component must import from HERE, not
 * from tts-providers.ts, even via a dynamic import — webpack still has to
 * build a browser chunk for a dynamic import's whole module graph, and
 * that fails outright once it hits an unresolvable `fs`.
 *
 * This module's own dependencies (TTS_PROVIDERS/lib/audio/constants.ts,
 * the TTSModelConfig type, and a dynamic import of the settings store) are
 * all confirmed to have no path back to provider-config.ts.
 */
import { TTS_PROVIDERS } from './constants';
import type { TTSModelConfig } from './types';

/**
 * Get current TTS configuration from the settings store.
 * Browser-context only — throws if called during SSR/on the server.
 */
export async function getCurrentTTSConfig(): Promise<TTSModelConfig> {
  if (typeof window === 'undefined') {
    throw new Error('getCurrentTTSConfig() can only be called in browser context');
  }

  const { useSettingsStore } = await import('@/lib/store/settings');
  const { ttsProviderId, ttsVoice, ttsSpeed, ttsProvidersConfig } = useSettingsStore.getState();

  const providerConfig = ttsProvidersConfig?.[ttsProviderId];

  return {
    providerId: ttsProviderId,
    modelId:
      providerConfig?.modelId ||
      TTS_PROVIDERS[ttsProviderId as keyof typeof TTS_PROVIDERS]?.defaultModelId ||
      '',
    apiKey: providerConfig?.apiKey,
    baseUrl: providerConfig?.baseUrl || providerConfig?.customDefaultBaseUrl,
    voice: ttsVoice,
    speed: ttsSpeed,
  };
}
