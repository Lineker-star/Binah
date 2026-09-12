/**
 * Generate (if needed) and get a signed download URL for a completed
 * course's plain Certificate of Completion. Idempotent server-side — safe
 * to call both as a fire-and-forget at course/session completion and
 * again on-demand from a "Download Certificate" click. Unconditional: no
 * lesson-count threshold — every completed course or session gets one,
 * same as before the richer tier below existed.
 *
 * Two shapes: `courseId` for a Structured Course; `sessionId` for an
 * ad-hoc single-prompt session with no `courses` row — the certificate is
 * keyed to the session instead.
 */
export async function getCertificateDownloadUrl(
  target: { courseId: string } | { sessionId: string },
): Promise<string> {
  const res = await fetch('/api/artifacts/certificate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(target),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as { url: string };
  return data.url;
}

/**
 * Generate (if needed) and get a signed download URL for a "Certificate
 * of Excellence" — a SEPARATE, ADDITIONAL certificate (grade,
 * overall_score, skills_acquired, serial_code) reserved for courses of
 * more than 10 lessons (see app/api/artifacts/certificate-excellence/
 * route.ts). courseId-only — an ad-hoc session (always exactly one
 * lesson) can never qualify, unlike the plain certificate above.
 */
export type CertificateExcellenceResult =
  | { status: 'ready'; url: string }
  | { status: 'ineligible' }
  | { status: 'pending' };

export async function getCertificateExcellenceDownloadUrl(target: {
  courseId: string;
}): Promise<CertificateExcellenceResult> {
  const res = await fetch('/api/artifacts/certificate-excellence', {
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
