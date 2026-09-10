'use client';

import { useEffect, useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/lib/hooks/use-i18n';
import { fetchLinkedChildren, type ChildCourseProgress, type LinkedChild } from '@/lib/supabase/parent';
import type { SessionStatus } from '@/lib/supabase/learning-session';
import type { Course } from '@/lib/supabase/courses';
import { createLogger } from '@/lib/logger';

const log = createLogger('ParentDashboard');

const STATUS_LABEL_KEY: Record<SessionStatus, string> = {
  active: 'classroom.session.statusActive',
  paused: 'classroom.session.statusPaused',
  completed: 'classroom.session.statusCompleted',
  abandoned: 'classroom.session.statusAbandoned',
};

// Same status-badge treatment as the learner's own History view
// (app/history/page.tsx) — reused verbatim for consistency, not reinvented.
const COURSE_BADGE: Record<Course['status'], { key: string; className: string }> = {
  planning: {
    key: 'history.courseStatusPlanning',
    className: 'bg-muted text-muted-foreground',
  },
  in_progress: {
    key: 'history.courseStatusInProgress',
    className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  completed: {
    key: 'history.courseStatusCompleted',
    className: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  },
};

export default function ParentDashboardPage() {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<LinkedChild[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchLinkedChildren()
      .then((rows) => {
        if (!cancelled) setChildren(rows);
      })
      .catch((err) => {
        log.error('Failed to load linked children:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-lg font-semibold text-foreground">{t('parent.dashboardTitle')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('parent.subtitle')}</p>

      {loading && (
        <div className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('common.loading')}
        </div>
      )}

      {!loading && children.length === 0 && (
        <div className="mt-10 flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
          <Users className="h-6 w-6" />
          {t('parent.noChildren')}
        </div>
      )}

      {!loading && children.length > 0 && (
        <div className="mt-6 flex flex-col gap-6">
          {children.map((child) => (
            <ChildCard key={child.id} child={child} locale={locale} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChildCard({
  child,
  locale,
  t,
}: {
  child: LinkedChild;
  locale: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const metrics = child.metrics;
  const averageScoreDisplay =
    metrics?.avg_assessment_score == null
      ? t('settings.progress.noScoreYet')
      : Math.round(metrics.avg_assessment_score * 10) / 10;
  const lastActiveDisplay = metrics?.last_active_at
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(metrics.last_active_at),
      )
    : t('settings.progress.never');

  return (
    <div className="rounded-2xl border border-border/60 p-4">
      <h2 className="text-sm font-semibold text-foreground">
        {child.display_name || t('parent.unnamed')}
      </h2>

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBlock label={t('settings.progress.totalSessions')} value={String(metrics?.total_sessions ?? 0)} />
        <StatBlock
          label={t('settings.progress.sessionsCompleted')}
          value={String(metrics?.sessions_completed ?? 0)}
        />
        <StatBlock label={t('settings.progress.averageScore')} value={String(averageScoreDisplay)} />
        <StatBlock label={t('settings.progress.lastActive')} value={lastActiveDisplay} />
      </div>

      <h3 className="mt-4 text-xs font-medium text-muted-foreground">{t('parent.coursesLabel')}</h3>
      {child.courses.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">{t('parent.noCourses')}</p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {child.courses.map((entry) => (
            <CourseProgressRow key={entry.course.id} entry={entry} t={t} />
          ))}
        </div>
      )}

      <h3 className="mt-4 text-xs font-medium text-muted-foreground">{t('parent.sessionsLabel')}</h3>
      {child.recentSessions.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">{t('parent.noSessions')}</p>
      ) : (
        <div className="mt-2 flex flex-col divide-y divide-border/60 rounded-xl border border-border/60">
          {child.recentSessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-4 px-3 py-2">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm font-medium text-foreground truncate">{s.title}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(s.started_at).toLocaleDateString()}
                </span>
              </div>
              <Badge variant="outline">{t(STATUS_LABEL_KEY[s.status])}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CourseProgressRow({
  entry,
  t,
}: {
  entry: ChildCourseProgress;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const badge = COURSE_BADGE[entry.course.status];
  return (
    <div className="rounded-xl border border-border/60 px-3 py-2 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground truncate">{entry.course.title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {t('history.lessonsProgress', {
            completed: entry.completedLessons,
            total: entry.totalLessons,
          })}
        </div>
      </div>
      <span
        className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${badge.className}`}
      >
        {t(badge.key)}
      </span>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 p-2.5 flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-base font-semibold text-foreground">{value}</span>
    </div>
  );
}
