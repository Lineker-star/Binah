'use client';

import { useEffect } from 'react';
import { useSettingsStore } from '@/lib/store/settings';

/**
 * Fetches server-configured providers on mount and merges into settings
 * store, then rehydrates the caller's own saved provider choice (BB.3) —
 * sequentially, so a personal choice deterministically wins over whatever
 * the server-config pass auto-selected as a fallback, rather than racing two
 * parallel fetches. Safe to call unconditionally for every signed-in role:
 * a learner's own-defaults request 403s and is caught silently (BB.1 — they
 * have no saved row to rehydrate anyway). Renders nothing — purely a
 * side-effect component.
 */
export function ServerProvidersInit() {
  const fetchServerProviders = useSettingsStore((state) => state.fetchServerProviders);
  const fetchOwnProviderDefaults = useSettingsStore((state) => state.fetchOwnProviderDefaults);

  useEffect(() => {
    (async () => {
      await fetchServerProviders();
      await fetchOwnProviderDefaults();
    })();
  }, [fetchServerProviders, fetchOwnProviderDefaults]);

  return null;
}
