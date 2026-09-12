'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Loader2, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  fetchPendingRoleRequests,
  approveRoleRequest,
  rejectRoleRequest,
  type PendingRoleRequest,
} from '@/lib/supabase/admin';
import { createLogger } from '@/lib/logger';

const log = createLogger('AdminRoleRequests');

export default function AdminRoleRequestsPage() {
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<PendingRoleRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actingOnId, setActingOnId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchPendingRoleRequests()
      .then(setRequests)
      .catch((err) => {
        log.error('Failed to load pending role requests:', err);
        setError('Failed to load pending requests.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleApprove = async (request: PendingRoleRequest) => {
    setActingOnId(request.id);
    try {
      await approveRoleRequest(request);
      setRequests((prev) => prev.filter((r) => r.id !== request.id));
      toast.success(
        `${request.learner_display_name || request.learner_email || 'Account'} is now a ${request.requested_role}.`,
      );
    } catch (err) {
      log.error('Failed to approve role request:', err);
      toast.error('Failed to approve this request.');
    } finally {
      setActingOnId(null);
    }
  };

  const handleReject = async (request: PendingRoleRequest) => {
    setActingOnId(request.id);
    try {
      await rejectRoleRequest(request.id);
      setRequests((prev) => prev.filter((r) => r.id !== request.id));
      toast.success('Request rejected.');
    } catch (err) {
      log.error('Failed to reject role request:', err);
      toast.error('Failed to reject this request.');
    } finally {
      setActingOnId(null);
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

      <div className="mt-6">
        <h1 className="text-lg font-semibold text-foreground">Role Requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pending requests to become a parent/tutor account. Approving changes the account&apos;s
          role immediately; the requester sees it reflected next time they load the app.
        </p>
      </div>

      {loading && (
        <div className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading requests…
        </div>
      )}

      {!loading && error && (
        <div className="mt-10 flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
          <ShieldAlert className="h-6 w-6" />
          {error}
        </div>
      )}

      {!loading && !error && requests.length === 0 && (
        <div className="mt-10 text-center text-sm text-muted-foreground">
          No pending requests.
        </div>
      )}

      {!loading && !error && requests.length > 0 && (
        <div className="mt-6 flex flex-col divide-y divide-border/60 rounded-2xl border border-border/60">
          {requests.map((request) => (
            <div
              key={request.id}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm font-medium text-foreground truncate">
                  {request.learner_display_name || '(no name)'}
                  {request.learner_email && (
                    <span className="text-muted-foreground font-normal"> · {request.learner_email}</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  Requested {request.requested_role} · {new Date(request.created_at).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={actingOnId === request.id}
                  onClick={() => handleReject(request)}
                >
                  {actingOnId === request.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                  Reject
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={actingOnId === request.id}
                  onClick={() => handleApprove(request)}
                >
                  {actingOnId === request.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Approve
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
