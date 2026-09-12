'use client';

/**
 * Visual growth-over-time charts for the "My Progress" settings tab —
 * extends the existing learning_metrics snapshot (progress-settings.tsx's
 * StatCard grid, a single current-state row) with actual trend data drawn
 * from full history: every assessments row (a retake never overwrites the
 * failed attempt — Tier R.4 — so this is genuine attempt-by-attempt
 * history, not just the latest score per scope) and every learning_
 * sessions row. No new schema needed for either.
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useTheme } from '@/lib/hooks/use-theme';
import { listOwnAssessments, type AssessmentRecord } from '@/lib/supabase/assessments';
import { listLearnerSessions, type LearningSession } from '@/lib/supabase/learning-session';
import { createLogger } from '@/lib/logger';
import { EChart, chartPalette } from './echart';
import type { EChartsCoreOption } from 'echarts/core';

const log = createLogger('ProgressGrowthCharts');

const ASSESSMENT_TYPE_LABEL_KEY: Record<string, string> = {
  quiz: 'settings.progress.typeQuiz',
  continuous_assessment: 'settings.progress.typeContinuousAssessment',
  exam: 'settings.progress.typeExam',
  pbl: 'settings.progress.typePbl',
  course_final: 'settings.progress.typeCourseFinal',
};

function ChartCard({
  label,
  hasData,
  emptyLabel,
  children,
}: {
  label: string;
  hasData: boolean;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/60 p-4">
      <div className="text-[12px] text-muted-foreground mb-2">{label}</div>
      {hasData ? (
        children
      ) : (
        <div className="h-[120px] flex items-center justify-center text-[12px] text-muted-foreground">
          {emptyLabel}
        </div>
      )}
    </div>
  );
}

export function ProgressGrowthCharts() {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [assessments, setAssessments] = useState<AssessmentRecord[]>([]);
  const [sessions, setSessions] = useState<LearningSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listOwnAssessments(), listLearnerSessions()])
      .then(([a, s]) => {
        if (cancelled) return;
        setAssessments(a);
        setSessions(s);
      })
      .catch((err) => log.warn('Failed to load growth chart data (ignored):', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scoreTrend = useMemo(() => {
    return assessments
      .filter((a) => a.score != null && a.max_score != null && a.max_score > 0)
      .map((a) => [a.created_at, Math.round((a.score! / a.max_score!) * 1000) / 10] as const);
  }, [assessments]);

  const passFailByType = useMemo(() => {
    const byType = new Map<string, { pass: number; fail: number }>();
    for (const a of assessments) {
      if (a.passed == null) continue;
      const entry = byType.get(a.assessment_type) ?? { pass: 0, fail: 0 };
      if (a.passed) entry.pass += 1;
      else entry.fail += 1;
      byType.set(a.assessment_type, entry);
    }
    return byType;
  }, [assessments]);

  const activeMinutesByDay = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const s of sessions) {
      if (!s.started_at || !s.total_active_seconds) continue;
      const day = s.started_at.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + s.total_active_seconds);
    }
    return byDay;
  }, [sessions]);

  const scoreTrendOption: EChartsCoreOption = useMemo(() => {
    const palette = chartPalette(isDark);
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v}%` },
      grid: { left: 44, right: 16, top: 16, bottom: 28 },
      xAxis: {
        type: 'time',
        axisLabel: { color: palette.axis, fontSize: 11 },
        axisLine: { lineStyle: { color: palette.split } },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        axisLabel: { color: palette.axis, fontSize: 11, formatter: '{value}%' },
        splitLine: { lineStyle: { color: palette.split } },
      },
      series: [
        {
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          itemStyle: { color: palette.accent },
          lineStyle: { color: palette.accent, width: 1.5, opacity: isDark ? 0.6 : 0.8 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [...palette.accentAreaStops],
            },
          },
          data: scoreTrend as unknown as [string, number][],
        },
      ],
    };
  }, [scoreTrend, isDark]);

  const passFailOption: EChartsCoreOption = useMemo(() => {
    const palette = chartPalette(isDark);
    const types = [...passFailByType.keys()];
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { top: 0, textStyle: { color: palette.axis, fontSize: 11 } },
      grid: { left: 40, right: 16, top: 32, bottom: 28 },
      xAxis: {
        type: 'category',
        data: types.map((ty) => t(ASSESSMENT_TYPE_LABEL_KEY[ty] ?? ty)),
        axisLabel: { color: palette.axis, fontSize: 11 },
        axisLine: { lineStyle: { color: palette.split } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: palette.axis, fontSize: 11 },
        splitLine: { lineStyle: { color: palette.split } },
      },
      series: [
        {
          name: t('settings.progress.passed'),
          type: 'bar',
          stack: 'total',
          itemStyle: { color: palette.success },
          data: types.map((ty) => passFailByType.get(ty)!.pass),
        },
        {
          name: t('settings.progress.failed'),
          type: 'bar',
          stack: 'total',
          itemStyle: { color: palette.danger },
          data: types.map((ty) => passFailByType.get(ty)!.fail),
        },
      ],
    };
  }, [passFailByType, isDark, t]);

  const timeActiveOption: EChartsCoreOption = useMemo(() => {
    const palette = chartPalette(isDark);
    const days = [...activeMinutesByDay.keys()].sort();
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v} min` },
      grid: { left: 40, right: 16, top: 16, bottom: 28 },
      xAxis: {
        type: 'category',
        data: days,
        axisLabel: { color: palette.axis, fontSize: 11 },
        axisLine: { lineStyle: { color: palette.split } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: palette.axis, fontSize: 11 },
        splitLine: { lineStyle: { color: palette.split } },
      },
      series: [
        {
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          itemStyle: { color: palette.accent },
          lineStyle: { color: palette.accent, width: 1, opacity: isDark ? 0.5 : 0.7 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [...palette.accentAreaStops],
            },
          },
          data: days.map((d) => Math.round((activeMinutesByDay.get(d)! / 60) * 10) / 10),
        },
      ],
    };
  }, [activeMinutesByDay, isDark]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('settings.progress.loading')}
      </div>
    );
  }

  const hasScoreTrend = scoreTrend.length > 0;
  const hasPassFail = passFailByType.size > 0;
  const hasTimeActive = activeMinutesByDay.size > 0;
  if (!hasScoreTrend && !hasPassFail && !hasTimeActive) return null;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[13px] font-medium text-muted-foreground">
        {t('settings.progress.growthHeading')}
      </h3>
      <ChartCard
        label={t('settings.progress.scoreTrendLabel')}
        hasData={hasScoreTrend}
        emptyLabel={t('settings.progress.chartEmpty')}
      >
        <EChart option={scoreTrendOption} height={200} />
      </ChartCard>
      <ChartCard
        label={t('settings.progress.passFailLabel')}
        hasData={hasPassFail}
        emptyLabel={t('settings.progress.chartEmpty')}
      >
        <EChart option={passFailOption} height={200} />
      </ChartCard>
      <ChartCard
        label={t('settings.progress.timeActiveLabel')}
        hasData={hasTimeActive}
        emptyLabel={t('settings.progress.chartEmpty')}
      >
        <EChart option={timeActiveOption} height={200} />
      </ChartCard>
    </div>
  );
}
