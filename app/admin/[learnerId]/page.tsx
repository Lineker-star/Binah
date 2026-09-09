'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  fetchLearnerDetail,
  changeUserRole,
  fetchLinkedChildrenForParent,
  linkParentToChild,
  type LearnerDetail,
  type AdminLinkedChild,
} from '@/lib/supabase/admin';
import { USER_ROLES, type UserRole } from '@/lib/supabase/profile';
import { createLogger } from '@/lib/logger';

const log = createLogger('AdminLearnerDetail');

export default function AdminLearnerDetailPage() {
  const params = useParams();
  const learnerId = params?.learnerId as string;

  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<LearnerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roleDraft, setRoleDraft] = useState<UserRole>('learner');
  const [changingRole, setChangingRole] = useState(false);

  const [children, setChildren] = useState<AdminLinkedChild[]>([]);
  const [childEmail, setChildEmail] = useState('');
  const [linking, setLinking] = useState(false);

  const loadChildren = (parentId: string) => {
    fetchLinkedChildrenForParent(parentId)
      .then(setChildren)
      .catch((err) => log.error('Failed to load linked children:', err));
  };

  useEffect(() => {
    if (!learnerId) return;
    let cancelled = false;
    setLoading(true);
    fetchLearnerDetail(learnerId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        if (d) {
          setRoleDraft(d.profile.role);
          if (d.profile.role === 'parent') loadChildren(d.profile.id);
        }
      })
      .catch((err) => {
        log.error('Failed to load learner detail:', err);
        if (!cancelled) setError('Failed to load this account.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [learnerId]);

  const handleLinkChild = async () => {
    if (!detail) return;
    setLinking(true);
    try {
      await linkParentToChild(detail.profile.id, childEmail);
      setChildEmail('');
      loadChildren(detail.profile.id);
      toast.success('Child linked.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to link child.';
      toast.error(message);
    } finally {
      setLinking(false);
    }
  };

  const handleRoleChange = async (newRole: UserRole) => {
    if (!detail || newRole === detail.profile.role) return;
    setChangingRole(true);
    try {
      await changeUserRole(detail.profile.id, detail.profile.role, newRole);
      setDetail({ ...detail, profile: { ...detail.profile, role: newRole } });
      setRoleDraft(newRole);
      if (newRole === 'parent') loadChildren(detail.profile.id);
      toast.success(`Role changed to ${newRole}.`);
    } catch (err) {
      log.error('Failed to change role:', err);
      toast.error('Failed to change role.');
      setRoleDraft(detail.profile.role);
    } finally {
      setChangingRole(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All accounts
      </Link>

      {loading && (
        <div className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      )}

      {!loading && (error || !detail) && (
        <div className="mt-10 flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
          <ShieldAlert className="h-6 w-6" />
          {error || 'Account not found.'}
        </div>
      )}

      {!loading && detail && (
        <>
          <div className="mt-6 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-foreground">
                {detail.profile.display_name || '(no name)'}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Joined {new Date(detail.profile.created_at).toLocaleDateString()}
                {detail.metrics?.last_active_at &&
                  ` · Last active ${new Date(detail.metrics.last_active_at).toLocaleDateString()}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={roleDraft}
                onValueChange={(v) => handleRoleChange(v as UserRole)}
                disabled={changingRole}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {USER_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {changingRole && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          </div>

          {detail.profile.role === 'parent' && (
            <section className="mt-6">
              <h2 className="text-sm font-semibold text-foreground">
                Linked children ({children.length})
              </h2>
              {children.length > 0 && (
                <div className="mt-2 flex flex-col divide-y divide-border/60 rounded-2xl border border-border/60">
                  {children.map((c) => (
                    <div key={c.id} className="px-4 py-2.5 text-sm text-foreground">
                      {c.display_name || '(no name)'}
                      {c.email && <span className="text-muted-foreground"> · {c.email}</span>}
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-end gap-2">
                <div className="flex-1 flex flex-col gap-1.5">
                  <Label htmlFor="link-child-email" className="text-xs">
                    Link a child by email
                  </Label>
                  <Input
                    id="link-child-email"
                    type="email"
                    value={childEmail}
                    onChange={(e) => setChildEmail(e.target.value)}
                    placeholder="child@example.com"
                  />
                </div>
                <Button size="sm" onClick={handleLinkChild} disabled={linking || !childEmail.trim()}>
                  {linking && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                  Link
                </Button>
              </div>
            </section>
          )}

          {detail.metrics && (
            <div className="mt-4 grid grid-cols-3 gap-3">
              <StatBlock label="Total sessions" value={String(detail.metrics.total_sessions)} />
              <StatBlock label="Completed" value={String(detail.metrics.sessions_completed)} />
              <StatBlock
                label="Avg score"
                value={
                  detail.metrics.avg_assessment_score == null
                    ? '—'
                    : String(Math.round(detail.metrics.avg_assessment_score * 10) / 10)
                }
              />
            </div>
          )}

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-foreground">
              Sessions ({detail.sessions.length})
            </h2>
            {detail.sessions.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No sessions yet.</p>
            ) : (
              <div className="mt-2 flex flex-col divide-y divide-border/60 rounded-2xl border border-border/60">
                {detail.sessions.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-sm font-medium text-foreground truncate">
                        {s.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Started {new Date(s.started_at).toLocaleDateString()}
                      </span>
                    </div>
                    <Badge variant="outline">{s.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-foreground">
              Assessments ({detail.assessments.length})
            </h2>
            {detail.assessments.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No assessments yet.</p>
            ) : (
              <div className="mt-2 flex flex-col divide-y divide-border/60 rounded-2xl border border-border/60">
                {detail.assessments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-sm font-medium text-foreground truncate">
                        {a.assessment_type} · {a.evaluated_by}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(a.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <span className="text-sm text-muted-foreground shrink-0">
                      {a.score != null && a.max_score != null ? `${a.score}/${a.max_score}` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 p-3 flex flex-col gap-1">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold text-foreground">{value}</span>
    </div>
  );
}
