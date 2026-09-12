'use client';

/**
 * Shared ECharts instance lifecycle — lazy init, setOption on option
 * change, resize on window resize, dispose on unmount. Generalizes the
 * pattern already established (hand-rolled, one chart) in usage-
 * dashboard.tsx, since the three Progress growth charts (see progress-
 * growth-charts.tsx) each need the same wiring.
 */
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, SVGRenderer]);

interface EChartProps {
  option: EChartsCoreOption;
  height?: number;
}

export function EChart({ option, height = 200 }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!chartRef.current) {
      chartRef.current = echarts.init(containerRef.current, undefined, { renderer: 'svg' });
    }
    chartRef.current.setOption(option, true);
    chartRef.current.resize();
  }, [option]);

  useEffect(() => {
    const onResize = () => chartRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}

/** Theme-aware colors shared across the growth charts — same violet
 *  accent/axis/split-line values usage-dashboard.tsx already computes
 *  inline, factored out here since three charts share them (one chart
 *  didn't warrant it there). */
export function chartPalette(isDark: boolean) {
  return {
    axis: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)',
    split: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    accent: isDark ? '#a78bfa' : '#7c3aed',
    accentAreaStops: [
      { offset: 0, color: isDark ? 'rgba(167,139,250,0.35)' : 'rgba(124,58,237,0.25)' },
      { offset: 1, color: isDark ? 'rgba(167,139,250,0.02)' : 'rgba(124,58,237,0.02)' },
    ] as const,
    success: isDark ? '#34d399' : '#059669',
    danger: isDark ? '#f87171' : '#dc2626',
  };
}
