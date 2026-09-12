/**
 * Public certificate verification page — no sign-in required. Calls the
 * `verify_certificate` Postgres function (security-definer, EXECUTE
 * granted to `anon`) and renders exactly what it returns: course_title,
 * grade, learner display name, issue date. Deliberately does NOT query
 * `certificates`/`profiles` directly — the RPC is the only sanctioned
 * projection of that data for an anonymous viewer, and this page must
 * never expose more than it does (no overall_score, no skills_acquired,
 * no serial_code, no email — see the function's own definition).
 */
import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import { DEFAULT_BRAND } from '@/lib/brand/brand-config';
import { createClient } from '@/lib/supabase/server';

interface VerifyCertificateRow {
  course_title: string;
  grade: string;
  learner_display_name: string;
  issued_at: string;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</dt>
      <dd className="text-sm font-medium text-foreground mt-0.5">{value}</dd>
    </div>
  );
}

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

  const result = (Array.isArray(data) ? (data[0] as VerifyCertificateRow) : null) ?? null;
  const found = !error && !!result;
  const dateText = found
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(new Date(result.issued_at))
    : null;

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-8 text-center shadow-sm">
        <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary mb-6">
          <ShieldCheck className="size-3.5" />
          {DEFAULT_BRAND.productName} Certificate Verification
        </div>

        {found ? (
          <>
            <CheckCircle2 className="mx-auto size-10 text-emerald-500 mb-3" />
            <h1 className="text-lg font-semibold text-foreground mb-1">Certificate verified</h1>
            <p className="text-sm text-muted-foreground mb-6">
              This certificate is authentic and on record.
            </p>
            <dl className="text-left space-y-3 border-t border-border/60 pt-6">
              <Field label="Course" value={result.course_title} />
              <Field label="Grade" value={result.grade} />
              <Field label="Awarded to" value={result.learner_display_name} />
              <Field label="Issued" value={dateText as string} />
            </dl>
          </>
        ) : (
          <>
            <XCircle className="mx-auto size-10 text-destructive mb-3" />
            <h1 className="text-lg font-semibold text-foreground mb-1">Certificate not found</h1>
            <p className="text-sm text-muted-foreground">
              We couldn't verify a certificate with this code. Double-check the code and try
              again.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
