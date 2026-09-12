'use client';

/**
 * French-first, English-toggle card for the public certificate
 * verification page. Deliberately NOT routed through the app's
 * react-i18next system — that's client-only with no server-rendered path
 * (see app/verify/[serialCode]/page.tsx), and this page's audience
 * (external verifiers) differs from learners already using the product in
 * a chosen locale. Two languages, hand-kept in one object, is proportionate
 * to one small public page — the full 12-locale system would be overkill
 * here.
 */
import { useState } from 'react';
import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEFAULT_BRAND } from '@/lib/brand/brand-config';

export interface VerifyCertificateRow {
  course_title: string;
  grade: string;
  learner_display_name: string;
  issued_at: string;
}

type Lang = 'fr' | 'en';

const DATE_LOCALE: Record<Lang, string> = { fr: 'fr-FR', en: 'en-US' };

const COPY: Record<
  Lang,
  {
    eyebrow: (productName: string) => string;
    foundHeading: string;
    foundSubtitle: string;
    labelCourse: string;
    labelGrade: string;
    labelAwardedTo: string;
    labelIssued: string;
    notFoundHeading: string;
    notFoundSubtitle: string;
  }
> = {
  fr: {
    eyebrow: (productName) => `Vérification de certificat ${productName}`,
    foundHeading: 'Certificat vérifié',
    foundSubtitle: 'Ce certificat est authentique et enregistré.',
    labelCourse: 'Cours',
    labelGrade: 'Note',
    labelAwardedTo: 'Délivré à',
    labelIssued: 'Date de délivrance',
    notFoundHeading: 'Certificat introuvable',
    notFoundSubtitle:
      "Nous n'avons pas pu vérifier de certificat avec ce code. Vérifiez le code et réessayez.",
  },
  en: {
    eyebrow: (productName) => `${productName} Certificate Verification`,
    foundHeading: 'Certificate verified',
    foundSubtitle: 'This certificate is authentic and on record.',
    labelCourse: 'Course',
    labelGrade: 'Grade',
    labelAwardedTo: 'Awarded to',
    labelIssued: 'Issued',
    notFoundHeading: 'Certificate not found',
    notFoundSubtitle:
      "We couldn't verify a certificate with this code. Double-check the code and try again.",
  },
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</dt>
      <dd className="text-sm font-medium text-foreground mt-0.5">{value}</dd>
    </div>
  );
}

export function VerifyCard({ result }: { result: VerifyCertificateRow | null }) {
  const [lang, setLang] = useState<Lang>('fr');
  const t = COPY[lang];
  const found = !!result;
  const dateText = found
    ? new Intl.DateTimeFormat(DATE_LOCALE[lang], { dateStyle: 'long' }).format(
        new Date(result.issued_at),
      )
    : null;

  return (
    <div className="relative w-full max-w-md rounded-2xl border border-border/60 bg-card p-8 text-center shadow-sm">
      <div className="absolute top-4 right-4 flex items-center gap-0.5 rounded-full border border-border/60 p-0.5">
        {(['fr', 'en'] as const).map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => setLang(code)}
            aria-pressed={lang === code}
            className={cn(
              'px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors cursor-pointer',
              lang === code
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {code.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary mb-6">
        <ShieldCheck className="size-3.5" />
        {t.eyebrow(DEFAULT_BRAND.productName)}
      </div>

      {found ? (
        <>
          <CheckCircle2 className="mx-auto size-10 text-emerald-500 mb-3" />
          <h1 className="text-lg font-semibold text-foreground mb-1">{t.foundHeading}</h1>
          <p className="text-sm text-muted-foreground mb-6">{t.foundSubtitle}</p>
          <dl className="text-left space-y-3 border-t border-border/60 pt-6">
            <Field label={t.labelCourse} value={result.course_title} />
            <Field label={t.labelGrade} value={result.grade} />
            <Field label={t.labelAwardedTo} value={result.learner_display_name} />
            <Field label={t.labelIssued} value={dateText as string} />
          </dl>
        </>
      ) : (
        <>
          <XCircle className="mx-auto size-10 text-destructive mb-3" />
          <h1 className="text-lg font-semibold text-foreground mb-1">{t.notFoundHeading}</h1>
          <p className="text-sm text-muted-foreground">{t.notFoundSubtitle}</p>
        </>
      )}
    </div>
  );
}
