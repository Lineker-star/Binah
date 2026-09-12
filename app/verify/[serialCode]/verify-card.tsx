'use client';

/**
 * Routed through the app's own react-i18next system (all 12 locales) --
 * `I18nProvider` is mounted at the root layout, so `useI18n()` is already
 * available here with no extra wiring. Locale detection is whatever the
 * app already uses everywhere else (lib/hooks/use-i18n.tsx: a saved
 * localStorage preference, else the browser's own `navigator.language`,
 * else the app default) -- that mechanism was never session-based to
 * begin with, so it works identically for this page's anonymous visitors.
 * The locale switcher below is the same LanguageSwitcher component used
 * elsewhere, not a bespoke toggle.
 */
import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import { DEFAULT_BRAND } from '@/lib/brand/brand-config';
import { useI18n } from '@/lib/hooks/use-i18n';
import { LanguageSwitcher } from '@/components/language-switcher';

export interface VerifyCertificateRow {
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

export function VerifyCard({ result }: { result: VerifyCertificateRow | null }) {
  const { t, locale } = useI18n();
  const found = !!result;
  const dateText = found
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(result.issued_at))
    : null;

  return (
    <div className="relative w-full max-w-md rounded-2xl border border-border/60 bg-card p-8 text-center shadow-sm">
      <div className="absolute top-4 right-4 rounded-full bg-muted/60">
        <LanguageSwitcher />
      </div>

      <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary mb-6">
        <ShieldCheck className="size-3.5" />
        {t('certificateVerify.eyebrow', { productName: DEFAULT_BRAND.productName })}
      </div>

      {found ? (
        <>
          <CheckCircle2 className="mx-auto size-10 text-emerald-500 mb-3" />
          <h1 className="text-lg font-semibold text-foreground mb-1">
            {t('certificateVerify.foundHeading')}
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            {t('certificateVerify.foundSubtitle')}
          </p>
          <dl className="text-left space-y-3 border-t border-border/60 pt-6">
            <Field label={t('certificateVerify.labelCourse')} value={result.course_title} />
            <Field label={t('certificateVerify.labelGrade')} value={result.grade} />
            <Field
              label={t('certificateVerify.labelAwardedTo')}
              value={result.learner_display_name}
            />
            <Field label={t('certificateVerify.labelIssued')} value={dateText as string} />
          </dl>
        </>
      ) : (
        <>
          <XCircle className="mx-auto size-10 text-destructive mb-3" />
          <h1 className="text-lg font-semibold text-foreground mb-1">
            {t('certificateVerify.notFoundHeading')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('certificateVerify.notFoundSubtitle')}
          </p>
        </>
      )}
    </div>
  );
}
