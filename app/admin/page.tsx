'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { fetchAllLearnerProfiles, type AdminLearnerListItem } from '@/lib/supabase/admin';
import { createLogger } from '@/lib/logger';

const log = createLogger('AdminLearnerList');

const ROLE_BADGE_VARIANT: Record<AdminLearnerListItem['role'], 'default' | 'secondary' | 'outline'> = {
  admin: 'default',
  parent: 'secondary',
  learner: 'outline',
};

export default function AdminLearnerListPage() {
  const [loading, setLoading] = useState(true);
  const [learners, setLearners] = useState<AdminLearnerListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAllLearnerProfiles()
      .then((rows) => {
        if (!cancelled) setLearners(rows);
      })
      .catch((err) => {
        log.error('Failed to load learner list:', err);
        if (!cancelled) setError('Failed to load accounts.');
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Admin — Accounts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All learner, parent, and admin accounts. Click a row for sessions and assessments.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <Link
            href="/admin/role-requests"
            className="text-sm text-violet-600 dark:text-violet-400 hover:underline"
          >
            Role Requests →
          </Link>
          <Link
            href="/admin/skill-tracks"
            className="text-sm text-violet-600 dark:text-violet-400 hover:underline"
          >
            Skill Tracks →
          </Link>
        </div>
      </div>

      {loading && (
        <div className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading accounts…
        </div>
      )}

      {!loading && error && (
        <div className="mt-10 flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
          <ShieldAlert className="h-6 w-6" />
          {error}
        </div>
      )}

      {!loading && !error && learners.length === 0 && (
        <div className="mt-10 text-center text-sm text-muted-foreground">No accounts yet.</div>
      )}

      {!loading && !error && learners.length > 0 && (
        <div className="mt-6 flex flex-col divide-y divide-border/60 rounded-2xl border border-border/60">
          {learners.map((learner) => (
            <Link
              key={learner.id}
              href={`/admin/${learner.id}`}
              className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/50 transition-colors"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm font-medium text-foreground truncate">
                  {learner.display_name || '(no name)'}
                </span>
                <span className="text-xs text-muted-foreground">
                  Joined {new Date(learner.created_at).toLocaleDateString()}
                  {learner.last_active_at &&
                    ` · Last active ${new Date(learner.last_active_at).toLocaleDateString()}`}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {learner.suspended && <Badge variant="destructive">suspended</Badge>}
                <Badge variant={ROLE_BADGE_VARIANT[learner.role]}>{learner.role}</Badge>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
