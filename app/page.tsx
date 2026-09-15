'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Award,
  Bot,
  Building2,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Loader2,
  TrendingUp,
  UserRound,
} from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { createClient } from '@/lib/supabase/client';
import { DEFAULT_BRAND } from '@/lib/brand/brand-config';
import { GoogleLogo } from '@/components/icons/google-logo';
import { NetworkBackground } from '@/components/marketing/network-background';
import { LanguageSwitcher } from '@/components/language-switcher';
import { cn } from '@/lib/utils';

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-80px' },
} as const;

function useGoogleSignIn() {
  const [loading, setLoading] = useState(false);

  const start = async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: new URL('/auth/callback', window.location.origin).toString() },
      });
      // On success the browser is already navigating to Google; a returned
      // error means the redirect never happened, so re-enable the button.
      if (error) setLoading(false);
    } catch {
      setLoading(false);
    }
  };

  return { start, loading };
}

function TopBar() {
  const { t } = useI18n();
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#05050f]/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <div className="flex items-center gap-2.5">
          <img src={DEFAULT_BRAND.markSrc} alt="" className="h-8 w-8 rounded-lg" />
          <span className="text-[17px] font-bold tracking-tight text-white">
            {DEFAULT_BRAND.shortName.toUpperCase()}
          </span>
        </div>
        <nav className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/auth"
            className="rounded-full px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white sm:px-4"
          >
            {t('auth.signInTitle')}
          </Link>
          <Link
            href="/auth?mode=sign-up"
            className="rounded-full bg-white px-3.5 py-2 text-sm font-semibold text-slate-950 shadow-sm transition-all hover:bg-white/90 active:scale-95 sm:px-4"
          >
            {t('auth.signUpCta')}
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  const { t } = useI18n();
  const { start: startGoogle, loading: googleLoading } = useGoogleSignIn();

  return (
    <section className="relative flex min-h-[100dvh] items-center overflow-hidden pt-16">
      {/* Ambient glow field behind everything — deliberately dim so text stays
          the brightest thing on screen. */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-10%] h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-indigo-600/25 blur-[140px]" />
        <div className="absolute bottom-[-15%] right-[5%] h-[420px] w-[420px] rounded-full bg-violet-600/20 blur-[120px]" />
      </div>
      <NetworkBackground className="absolute inset-0 h-full w-full opacity-60" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#05050f]" />

      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center px-5 py-24 text-center sm:px-8">
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className="text-balance text-[2.6rem] font-bold leading-[1.08] tracking-tight text-white sm:text-6xl md:text-7xl"
        >
          {t('landing.hero.headline')}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.12, ease: 'easeOut' }}
          className="mt-6 max-w-2xl text-balance text-base leading-relaxed text-slate-300 sm:text-lg"
        >
          {t('landing.hero.subheadline')}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.24, ease: 'easeOut' }}
          className="mt-10 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row"
        >
          <Link
            href="/auth?mode=sign-up"
            className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-7 text-[15px] font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_8px_30px_-6px_rgba(99,102,241,0.65)] transition-all hover:shadow-[0_0_0_1px_rgba(255,255,255,0.12),0_10px_40px_-6px_rgba(99,102,241,0.85)] active:scale-[0.97] sm:w-auto"
          >
            {t('landing.hero.getStarted')}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <button
            type="button"
            onClick={startGoogle}
            disabled={googleLoading}
            className="inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-full border border-white/15 bg-white/[0.04] px-7 text-[15px] font-medium text-white backdrop-blur-sm transition-all hover:bg-white/[0.08] active:scale-[0.97] disabled:opacity-60 sm:w-auto"
          >
            {googleLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <GoogleLogo className="size-4" />
            )}
            {t('auth.continueWithGoogle')}
          </button>
        </motion.div>
      </div>
    </section>
  );
}

interface FeatureItem {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}

function Features() {
  const { t } = useI18n();

  const items: FeatureItem[] = [
    { icon: Bot, title: t('landing.features.teacherTitle'), desc: t('landing.features.teacherDesc') },
    {
      icon: GraduationCap,
      title: t('landing.features.coursesTitle'),
      desc: t('landing.features.coursesDesc'),
    },
    { icon: FileText, title: t('landing.features.textbookTitle'), desc: t('landing.features.textbookDesc') },
    {
      icon: ClipboardCheck,
      title: t('landing.features.assessmentTitle'),
      desc: t('landing.features.assessmentDesc'),
    },
    { icon: Award, title: t('landing.features.certificateTitle'), desc: t('landing.features.certificateDesc') },
    { icon: TrendingUp, title: t('landing.features.progressTitle'), desc: t('landing.features.progressDesc') },
  ];

  return (
    <section className="relative bg-[#05050f] px-5 py-24 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <motion.div {...fadeUp} transition={{ duration: 0.6 }} className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {t('landing.features.heading')}
          </h2>
          <p className="mt-4 text-balance text-[15px] text-slate-400">{t('landing.features.subheading')}</p>
        </motion.div>

        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, i) => (
            <motion.div
              key={item.title}
              {...fadeUp}
              transition={{ duration: 0.5, delay: (i % 3) * 0.08 }}
              className="group rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-all hover:border-indigo-400/40 hover:bg-white/[0.06]"
            >
              <div className="inline-flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 text-indigo-300 ring-1 ring-inset ring-indigo-400/20 transition-colors group-hover:text-indigo-200">
                <item.icon className="size-5" />
              </div>
              <h3 className="mt-4 text-[15px] font-semibold text-white">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

interface ScenarioItem {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}

function HowItWorks() {
  const { t } = useI18n();

  const scenarios: ScenarioItem[] = [
    { icon: UserRound, title: t('landing.howItWorks.learnerTitle'), desc: t('landing.howItWorks.learnerDesc') },
    { icon: Building2, title: t('landing.howItWorks.schoolTitle'), desc: t('landing.howItWorks.schoolDesc') },
    {
      icon: GraduationCap,
      title: t('landing.howItWorks.examTitle'),
      desc: t('landing.howItWorks.examDesc'),
    },
  ];

  return (
    <section className="relative border-t border-white/10 bg-[#07070f] px-5 py-24 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <motion.div {...fadeUp} transition={{ duration: 0.6 }} className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {t('landing.howItWorks.heading')}
          </h2>
          <p className="mt-4 text-balance text-[15px] text-slate-400">{t('landing.howItWorks.subheading')}</p>
        </motion.div>

        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-3">
          {scenarios.map((s, i) => (
            <motion.div
              key={s.title}
              {...fadeUp}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-7"
            >
              <div className="inline-flex size-12 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-300 ring-1 ring-inset ring-indigo-400/25">
                <s.icon className="size-5" />
              </div>
              <h3 className="mt-5 text-[16px] font-semibold text-white">{s.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-slate-400">{s.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  const { t } = useI18n();

  return (
    <section className="relative bg-[#05050f] px-5 py-24 sm:px-8">
      <motion.div
        {...fadeUp}
        transition={{ duration: 0.6 }}
        className="relative mx-auto max-w-4xl overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-indigo-600/20 via-white/[0.03] to-violet-600/20 px-6 py-16 text-center sm:px-16"
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 h-[300px] w-[600px] -translate-x-1/2 rounded-full bg-indigo-500/20 blur-[110px]" />
        </div>
        <div className="relative z-10">
          <h2 className="text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {t('landing.cta.heading')}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-balance text-[15px] text-slate-300">
            {t('landing.cta.subheading')}
          </p>
          <Link
            href="/auth?mode=sign-up"
            className={cn(
              'mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-8 text-[15px] font-semibold text-white shadow-[0_8px_30px_-6px_rgba(99,102,241,0.65)] transition-all hover:shadow-[0_10px_40px_-6px_rgba(99,102,241,0.85)] active:scale-[0.97]',
            )}
          >
            {t('landing.cta.button')}
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </motion.div>
    </section>
  );
}

function Footer() {
  const { t } = useI18n();
  return (
    <footer className="border-t border-white/10 bg-[#05050f] px-5 py-10 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="flex items-center gap-2">
          <img src={DEFAULT_BRAND.markSrc} alt="" className="h-6 w-6 rounded-md opacity-90" />
          <span className="text-sm text-slate-400">{t('landing.footer.tagline')}</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-slate-500">
            <LanguageSwitcher />
          </div>
          <Link href="/auth" className="text-sm text-slate-400 transition-colors hover:text-white">
            {t('auth.signInTitle')}
          </Link>
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-[100dvh] w-full bg-[#05050f]">
      <TopBar />
      <Hero />
      <Features />
      <HowItWorks />
      <FinalCta />
      <Footer />
    </div>
  );
}
