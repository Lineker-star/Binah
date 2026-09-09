'use client';

import { useEffect, useState } from 'react';
import { Loader2, TrendingUp, CheckCircle2, Flame, Clock, Award } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { fetchOwnMetrics, type LearningMetrics } from '@/lib/supabase/learning-metrics';
import { createClient } from '@/lib/supabase/client';
import { createLogger } from '@/lib/logger';

const log = createLogger('ProgressSettings');

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 p-4 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[12px]">{label}</span>
      </div>
      <div className="text-xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

export function ProgressSettings() {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<LearningMetrics | null>(null);
  const [signedIn, setSignedIn] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // fetchOwnMetrics resolves to null both for "not signed in" and for
    // "signed in, no row yet" — check the session directly too so those two
    // states get different copy instead of both reading as one generic
    // empty state.
    Promise.all([createClient().auth.getUser(), fetchOwnMetrics()])
      .then(([{ data }, m]) => {
        if (cancelled) return;
        setSignedIn(!!data.user);
        setMetrics(m);
      })
      .catch((err) => {
        log.error('Failed to load learning metrics:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('settings.progress.loading')}
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-sm text-muted-foreground">
        <TrendingUp className="h-6 w-6" />
        {t('settings.progress.notSignedIn')}
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-sm text-muted-foreground">
        <TrendingUp className="h-6 w-6" />
        {t('settings.progress.empty')}
      </div>
    );
  }

  const averageScoreDisplay =
    metrics.avg_assessment_score == null
      ? t('settings.progress.noScoreYet')
      : Math.round(metrics.avg_assessment_score * 10) / 10;

  const lastActiveDisplay = metrics.last_active_at
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(metrics.last_active_at),
      )
    : t('settings.progress.never');

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard
          icon={TrendingUp}
          label={t('settings.progress.totalSessions')}
          value={String(metrics.total_sessions)}
        />
        <StatCard
          icon={CheckCircle2}
          label={t('settings.progress.sessionsCompleted')}
          value={String(metrics.sessions_completed)}
        />
        <StatCard
          icon={Award}
          label={t('settings.progress.averageScore')}
          value={String(averageScoreDisplay)}
        />
        <StatCard
          icon={Flame}
          label={t('settings.progress.currentStreak')}
          value={t('settings.progress.streakDays', { count: metrics.current_streak_days })}
        />
        <StatCard
          icon={Clock}
          label={t('settings.progress.lastActive')}
          value={lastActiveDisplay}
        />
      </div>
    </div>
  );
}
