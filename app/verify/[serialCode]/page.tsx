/**
 * Public certificate verification page — no sign-in required. Calls the
 * `verify_certificate` Postgres function (security-definer, EXECUTE
 * granted to `anon`) and renders exactly what it returns: course_title,
 * grade, learner display name, issue date. Deliberately does NOT query
 * `certificates`/`profiles` directly — the RPC is the only sanctioned
 * projection of that data for an anonymous viewer, and this page must
 * never expose more than it does (no overall_score, no skills_acquired,
 * no serial_code, no email — see the function's own definition).
 *
 * The actual fetch stays server-side (this file); rendering lives in the
 * client component below (it needs useI18n(), which needs client
 * context), fully localized through the app's own 12-locale i18n system
 * (I18nProvider is mounted at the root layout, so it's already available
 * here) rather than a page-specific bilingual scheme.
 */
import { createClient } from '@/lib/supabase/server';
import { VerifyCard, type VerifyCertificateRow } from './verify-card';

export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ serialCode: string }>;
}) {
  const { serialCode } = await params;
  const normalizedCode = decodeURIComponent(serialCode).trim().toUpperCase();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('verify_certificate', {
    p_serial_code: normalizedCode,
  });

  const result =
    (!error && Array.isArray(data) ? (data[0] as VerifyCertificateRow) : null) ?? null;

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background px-4 py-16">
      <VerifyCard result={result} />
    </div>
  );
}
