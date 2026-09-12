/**
 * Generate (if needed) and get a signed download URL for a completed
 * course's certificate. Idempotent server-side — safe to call both as a
 * fire-and-forget at course completion and again on-demand from a
 * "Download Certificate" click.
 *
 * Two shapes: `courseId` for a Structured Course; `sessionId` for an
 * ad-hoc single-prompt session with no `courses` row — the certificate is
 * keyed to the session instead. Certificates are for large courses only
 * (more than 10 lessons — see app/api/artifacts/certificate/route.ts), so
 * a `sessionId` (always exactly one lesson) is always `ineligible`.
 */
export type CertificateResult =
  | { status: 'ready'; url: string }
  | { status: 'ineligible' }
  | { status: 'pending' };

export async function getCertificateDownloadUrl(
  target: { courseId: string } | { sessionId: string },
): Promise<CertificateResult> {
  const res = await fetch('/api/artifacts/certificate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(target),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as { eligible: boolean; pending?: boolean; url?: string };
  if (!data.eligible) return { status: 'ineligible' };
  if (data.pending || !data.url) return { status: 'pending' };
  return { status: 'ready', url: data.url };
}
