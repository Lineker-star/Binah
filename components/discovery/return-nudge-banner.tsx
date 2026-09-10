'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '@/lib/hooks/use-i18n';
import { createLogger } from '@/lib/logger';
import { computeReturnNudge, dismissReturnNudge, type ReturnNudge } from '@/lib/homepage/return-nudge';
import { resumeSession } from '@/lib/supabase/learning-session';

const log = createLogger('ReturnNudge');

/** Dismissible "welcome back" banner — never blocking, shown at most once per qualifying gap. */
export function ReturnNudgeBanner({
  signedIn,
  onOpenProgress,
}: {
  signedIn: boolean;
  onOpenProgress: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [nudge, setNudge] = useState<ReturnNudge | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    computeReturnNudge()
      .then((n) => {
        if (!cancelled) setNudge(n);
      })
      .catch((err) => log.warn('Failed to compute return nudge (ignored):', err));
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  if (!nudge || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    dismissReturnNudge(nudge.lastActiveAt);
  };

  const handleAction = async () => {
    if (nudge.kind === 'weak_area') {
      onOpenProgress();
      return;
    }
    const session = nudge.session;
    if (!session.stage_id) return;
    setBusy(true);
    try {
      if (session.status !== 'active') {
        await resumeSession(session.id);
      }
      router.push(`/classroom/${session.stage_id}`);
    } catch (err) {
      log.error('Failed to resume session from return nudge:', err);
      toast.error(t('classroom.moveFailed'));
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="w-full mb-4 flex items-center gap-3 rounded-2xl border border-violet-200/60 dark:border-violet-800/40 bg-violet-50/60 dark:bg-violet-950/20 px-4 py-3"
      >
        <Sparkles className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
        <div className="min-w-0 flex-1 text-[13px] text-foreground/85">
          {nudge.kind === 'resume_session'
            ? t('home.returnNudge.resumeSession', { title: nudge.session.title })
            : t('home.returnNudge.weakArea', { area: nudge.focusArea })}
        </div>
        <button
          type="button"
          onClick={handleAction}
          disabled={busy}
          className="shrink-0 text-[12.5px] font-medium text-violet-700 dark:text-violet-300 hover:underline disabled:opacity-50 cursor-pointer"
        >
          {nudge.kind === 'resume_session'
            ? t('home.returnNudge.continueAction')
            : t('home.returnNudge.viewAction')}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          title={t('common.close')}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <X className="size-3.5" />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
