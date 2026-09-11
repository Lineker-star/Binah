/**
 * fetch() with a short exponential-backoff retry, scoped to local/private
 * network targets only and only on a connection-level failure (fetch()
 * itself throwing — refused/reset connections — not an HTTP error
 * response).
 *
 * A local inference server (e.g. Lemonade) running one request at a time
 * can refuse a new connection while still busy with a prior one — observed
 * directly as a TTS call and an ASR call colliding against the same local
 * endpoint. Remote/cloud providers are never retried here: they have their
 * own real rate-limit semantics (HTTP 429, etc.) that a blind connection
 * retry would misapply, so scope is decided by the resolved URL itself
 * (`isLocalOrPrivateUrl`), never by a hardcoded provider id — any current
 * or future provider whose configured endpoint resolves to a local/private
 * address gets this behavior automatically.
 */
import { isLocalOrPrivateUrl } from '@/lib/server/ssrf-guard';

const DEFAULT_ATTEMPTS = 3;
const BASE_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithLocalRetry(
  url: string,
  init: RequestInit,
  options?: { attempts?: number; baseDelayMs?: number },
): Promise<Response> {
  if (!isLocalOrPrivateUrl(url)) {
    return fetch(url, init);
  }

  const attempts = options?.attempts ?? DEFAULT_ATTEMPTS;
  const baseDelayMs = options?.baseDelayMs ?? BASE_DELAY_MS;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      // An abort is the caller cancelling, not the server refusing the
      // connection — never mask that behind a retry.
      if (init.signal?.aborted) throw err;
      lastError = err;
      if (attempt < attempts - 1) {
        await sleep(baseDelayMs * 2 ** attempt);
      }
    }
  }
  throw lastError;
}
