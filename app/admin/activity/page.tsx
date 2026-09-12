'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, ShieldAlert } from 'lucide-react';
import {
  fetchAdminActivity,
  type AdminActivityRow,
  type AdminActivityTotals,
} from '@/lib/supabase/admin-activity';
import { createLogger } from '@/lib/logger';

const log = createLogger('AdminActivity');

export default function AdminActivityPage() {
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState<AdminActivityTotals | null>(null);
  const [rows, setRows] = useState<AdminActivityRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAdminActivity()
      .then(({ totals: t, rows: r }) => {
        if (cancelled) return;
        setTotals(t);
        setRows(r);
      })
      .catch((err) => {
        log.error('Failed to load activity report:', err);
        if (!cancelled) setError('Failed to load the activity report.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All accounts
      </Link>

      <div className="mt-6">
        <h1 className="text-lg font-semibold text-foreground">Activity</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sessions, assessments, certificates, and exports/downloads across every account.
        </p>
      </div>

      {loading && (
        <div className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading activity…
        </div>
      )}

      {!loading && (error || !totals) && (
        <div className="mt-10 flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
          <ShieldAlert className="h-6 w-6" />
          {error || 'No data available.'}
        </div>
      )}

      {!loading && totals && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatBlock label="Sessions created" value={totals.sessionsCreated} />
            <StatBlock label="Sessions completed" value={totals.sessionsCompleted} />
            <StatBlock label="Assessments taken" value={totals.assessmentsTaken} />
            <StatBlock label="Certificates issued" value={totals.certificatesIssued} />
            <StatBlock label="Exports created" value={totals.exportsCreated} />
            <StatBlock label="Downloads recorded" value={totals.downloadsRecorded} />
            <StatBlock label="Video exports created" value={totals.videoExportsCreated} />
            <StatBlock label="Video exports downloaded" value={totals.videoExportsDownloaded} />
          </div>

          <h2 className="mt-8 text-sm font-semibold text-foreground">By account</h2>
          {rows.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No accounts yet.</p>
          ) : (
            <div className="mt-2 overflow-x-auto rounded-2xl border border-border/60">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Account</th>
                    <th className="px-4 py-2 font-medium text-right">Sessions</th>
                    <th className="px-4 py-2 font-medium text-right">Completed</th>
                    <th className="px-4 py-2 font-medium text-right">Assessments</th>
                    <th className="px-4 py-2 font-medium text-right">Avg score</th>
                    <th className="px-4 py-2 font-medium text-right">Certificates</th>
                    <th className="px-4 py-2 font-medium text-right">Exports</th>
                    <th className="px-4 py-2 font-medium text-right">Downloads</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {rows.map((row) => (
                    <tr key={row.learnerId}>
                      <td className="px-4 py-2.5 text-foreground truncate max-w-[220px]">
                        {row.displayName || '(no name)'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.sessionsCreated}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.sessionsCompleted}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.assessmentsTaken}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {row.avgAssessmentScore == null
                          ? '—'
                          : String(Math.round(row.avgAssessmentScore * 10) / 10)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.certificatesIssued}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.exportsCreated}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.downloadsRecorded}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border/60 p-3 flex flex-col gap-1">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold text-foreground tabular-nums">{value}</span>
    </div>
  );
}
