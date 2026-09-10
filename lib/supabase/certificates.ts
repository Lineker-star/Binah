/**
 * Generate (if needed) and get a signed download URL for a completed
 * course's certificate. Idempotent server-side — safe to call both as a
 * fire-and-forget at course completion and again on-demand from a
 * "Download Certificate" click.
 */
export async function getCertificateDownloadUrl(courseId: string): Promise<string> {
  const res = await fetch('/api/artifacts/certificate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as { url: string };
  return data.url;
}
