'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronDown,
  Clock,
  Loader2,
  Pause,
  Play,
  Presentation,
  Search,
  Square,
  Upload,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { InputGroup, InputGroupInput, InputGroupButton } from '@/components/ui/input-group';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';
import {
  listLearnerSessions,
  pauseSession,
  resumeSession,
  endSession,
  type LearningSession,
  type SessionStatus,
} from '@/lib/supabase/learning-session';

const log = createLogger('RecentSessions');
const RECENT_OPEN_STORAGE_KEY = 'recentClassroomsOpen';

const STATUS_BADGE: Record<SessionStatus, { key: string; className: string }> = {
  active: {
    key: 'classroom.session.statusActive',
    className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  paused: {
    key: 'classroom.session.statusPaused',
    className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  completed: {
    key: 'classroom.session.statusCompleted',
    className: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  },
  abandoned: {
    key: 'classroom.session.statusAbandoned',
    className: 'bg-muted text-muted-foreground',
  },
};

function formatDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleDateString();
  }
}

function SessionCard({
  session,
  busy,
  onContinue,
  onPause,
  onEnd,
}: {
  session: LearningSession;
  busy: boolean;
  onContinue: (session: LearningSession) => void;
  onPause: (session: LearningSession) => void;
  onEnd: (session: LearningSession) => void;
}) {
  const { t, locale } = useI18n();
  const badge = STATUS_BADGE[session.status];
  const finished = session.status === 'completed' || session.status === 'abandoned';

  return (
    <div className="group rounded-2xl border border-border/60 bg-card/60 p-4 flex flex-col gap-3 hover:border-border hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-foreground truncate">{session.title}</div>
          {session.topic && (
            <div className="text-[12px] text-muted-foreground truncate mt-0.5">
              {session.topic}
            </div>
          )}
        </div>
        <span
          className={cn(
            'shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full',
            badge.className,
          )}
        >
          {t(badge.key)}
        </span>
      </div>

      <div className="text-[11px] text-muted-foreground">
        {formatDate(session.updated_at, locale)}
      </div>

      {!finished && (
        <div className="flex items-center gap-1.5 mt-1">
          <button
            type="button"
            onClick={() => onContinue(session)}
            disabled={busy}
            className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-lg bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
          >
            {busy ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Play className="size-3" />
            )}
            {t('classroom.session.continueLabel')}
          </button>
          {session.status === 'active' && (
            <button
              type="button"
              onClick={() => onPause(session)}
              disabled={busy}
              title={t('classroom.session.pauseAction')}
              className="inline-flex items-center justify-center size-8 rounded-lg border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Pause className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onEnd(session)}
            disabled={busy}
            title={t('classroom.session.endAction')}
            className="inline-flex items-center justify-center size-8 rounded-lg border border-border/60 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Square className="size-3" />
          </button>
        </div>
      )}
    </div>
  );
}

export function RecentSessions({
  onImportClassroom,
  importingClassroom,
  pptxImportEnabled,
  onImportPptx,
  importingPptx,
}: {
  onImportClassroom: () => void;
  importingClassroom: boolean;
  pptxImportEnabled: boolean;
  onImportPptx: () => void;
  importingPptx: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();

  const [loaded, setLoaded] = useState(false);
  const [sessions, setSessions] = useState<LearningSession[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [open, setOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_OPEN_STORAGE_KEY);
      if (saved !== null) setOpen(saved !== 'false');
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  const persistOpen = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(RECENT_OPEN_STORAGE_KEY, String(next));
    } catch {
      /* ignore */
    }
  };

  const load = () => {
    listLearnerSessions()
      .then(setSessions)
      .catch((err) => {
        log.error('Failed to load sessions:', err);
      })
      .finally(() => setLoaded(true));
  };

  useEffect(load, []);

  const deferredQuery = useDeferredValue(searchQuery);
  const isSearching = deferredQuery.trim().length > 0;
  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      const title = s.title?.toLowerCase() ?? '';
      const topic = s.topic?.toLowerCase() ?? '';
      return title.includes(q) || topic.includes(q);
    });
  }, [sessions, deferredQuery]);

  const inProgress = useMemo(
    () =>
      filtered
        .filter((s) => s.status === 'active' || s.status === 'paused')
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
          return b.updated_at.localeCompare(a.updated_at);
        }),
    [filtered],
  );
  const finished = useMemo(
    () =>
      filtered
        .filter((s) => s.status === 'completed' || s.status === 'abandoned')
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [filtered],
  );

  const goToSession = (session: LearningSession) => {
    if (!session.stage_id) return;
    router.push(`/classroom/${session.stage_id}`);
  };

  const handleContinue = async (session: LearningSession) => {
    if (session.status === 'active') {
      goToSession(session);
      return;
    }
    setBusyId(session.id);
    try {
      const updated = await resumeSession(session.id);
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      goToSession(updated);
    } catch (err) {
      log.error('Failed to resume session:', err);
      toast.error(t('classroom.moveFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const handlePause = async (session: LearningSession) => {
    setBusyId(session.id);
    try {
      const updated = await pauseSession(session.id);
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      log.error('Failed to pause session:', err);
      toast.error(t('classroom.moveFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const handleEnd = async (session: LearningSession) => {
    setBusyId(session.id);
    try {
      // Ended from this list, not from the classroom's own completion signal
      // — the course was, by definition, not finished, so this is always
      // `abandoned` (see the reasoning in `lib/supabase/learning-session.ts`).
      const updated = await endSession(session.id, { completed: false });
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      log.error('Failed to end session:', err);
      toast.error(t('classroom.moveFailed'));
    } finally {
      setBusyId(null);
    }
  };

  if (!loaded) return null;

  const totalCount = sessions.length;
  const nothingAtAll = totalCount === 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.5 }}
      className="relative z-10 mt-10 w-full max-w-6xl flex flex-col items-center"
    >
      {/* Trigger — divider-line with centered text, same chrome as before. */}
      <div className="group w-full flex items-center gap-4 h-9">
        <div className="flex-1 h-px bg-border/40 group-hover:bg-border/70 transition-colors" />
        <div className="shrink-0 flex items-center gap-3 text-[13px] text-muted-foreground select-none">
          <button
            onClick={() => persistOpen(!open)}
            className="flex items-center gap-2 hover:text-foreground/70 transition-colors cursor-pointer"
          >
            <Clock className="size-3.5" />
            {t('classroom.recentClassrooms')}
            <span className="text-[11px] tabular-nums">{totalCount}</span>
            <motion.div
              animate={{ rotate: open ? 180 : 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
            >
              <ChevronDown className="size-3.5" />
            </motion.div>
          </button>

          <AnimatePresence initial={false}>
            {!searchOpen ? (
              <motion.button
                key="search-icon"
                ref={searchButtonRef}
                type="button"
                aria-label={t('classroom.searchAriaLabel')}
                onClick={() => {
                  setSearchOpen(true);
                  if (!open) persistOpen(true);
                  requestAnimationFrame(() => searchInputRef.current?.focus());
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12, ease: 'easeOut' }}
                className="flex items-center justify-center size-6 rounded-full text-muted-foreground/50 hover:text-foreground/70 hover:bg-muted/50 transition-colors cursor-pointer"
              >
                <Search className="size-3.5" />
              </motion.button>
            ) : (
              <motion.div
                key="search-input"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 200 }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
                className="overflow-hidden"
              >
                <InputGroup
                  className={cn(
                    'h-7 text-[12px] rounded-full bg-muted/40 border-transparent shadow-none',
                    'transition-colors',
                    'hover:bg-muted/60',
                    'has-[[data-slot=input-group-control]:focus-visible]:bg-muted/60',
                    'has-[[data-slot=input-group-control]:focus-visible]:border-transparent',
                    'has-[[data-slot=input-group-control]:focus-visible]:ring-0',
                  )}
                >
                  <InputGroupInput
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        if (searchQuery) {
                          setSearchQuery('');
                        } else {
                          setSearchOpen(false);
                          requestAnimationFrame(() => searchButtonRef.current?.focus());
                        }
                      }
                    }}
                    onBlur={() => {
                      if (!searchQuery) setSearchOpen(false);
                    }}
                    placeholder={t('classroom.searchPlaceholder')}
                    aria-label={t('classroom.searchAriaLabel')}
                    className="h-7 pl-3 placeholder:text-muted-foreground/50"
                  />
                  {searchQuery && (
                    <InputGroupButton
                      size="icon-xs"
                      aria-label={t('classroom.clearSearch')}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSearchQuery('');
                        searchInputRef.current?.focus();
                      }}
                    >
                      <X />
                    </InputGroupButton>
                  )}
                </InputGroup>
              </motion.div>
            )}
          </AnimatePresence>

          <button
            onClick={onImportClassroom}
            disabled={importingClassroom}
            className="group/import grid grid-cols-[auto_0fr] hover:grid-cols-[auto_1fr] items-center gap-1 rounded-full px-1.5 py-0.5 text-[12px] text-muted-foreground/35 hover:text-muted-foreground/70 hover:bg-muted/50 transition-all duration-200 cursor-pointer"
          >
            <Upload className="size-3" />
            <span className="overflow-hidden opacity-0 group-hover/import:opacity-100 transition-opacity duration-200 whitespace-nowrap">
              {t('import.classroom')}
            </span>
          </button>
          {pptxImportEnabled && (
            <button
              onClick={onImportPptx}
              disabled={importingPptx}
              className="group/import-pptx grid grid-cols-[auto_0fr] hover:grid-cols-[auto_1fr] items-center gap-1 rounded-full px-1.5 py-0.5 text-[12px] text-muted-foreground/35 hover:text-muted-foreground/70 hover:bg-muted/50 transition-all duration-200 cursor-pointer"
            >
              <Presentation className="size-3" />
              <span className="overflow-hidden opacity-0 group-hover/import-pptx:opacity-100 transition-opacity duration-200 whitespace-nowrap">
                {t('import.pptx')}
              </span>
            </button>
          )}
        </div>
        <div className="flex-1 h-px bg-border/40 group-hover:bg-border/70 transition-colors" />
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
            className="w-full overflow-hidden"
          >
            {nothingAtAll ? (
              <div className="pt-8 pb-2 text-center text-[13px] text-muted-foreground">
                {t('classroom.emptyLibraryHint')}
              </div>
            ) : isSearching && filtered.length === 0 ? (
              <div className="pt-8 pb-2 text-center text-[13px] text-muted-foreground/60">
                {t('classroom.searchEmpty')}
              </div>
            ) : (
              <div className="pt-8">
                {inProgress.length > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-5">
                    {inProgress.map((session, i) => (
                      <motion.div
                        key={session.id}
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04, duration: 0.35, ease: 'easeOut' }}
                      >
                        <SessionCard
                          session={session}
                          busy={busyId === session.id}
                          onContinue={handleContinue}
                          onPause={handlePause}
                          onEnd={handleEnd}
                        />
                      </motion.div>
                    ))}
                  </div>
                )}

                {finished.length > 0 && (
                  <div className={cn(inProgress.length > 0 && 'mt-6')}>
                    <button
                      type="button"
                      onClick={() => setShowCompleted((v) => !v)}
                      className="text-[12px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    >
                      {showCompleted
                        ? t('classroom.session.hideCompleted')
                        : t('classroom.session.showCompleted', { count: finished.length })}
                    </button>
                    <AnimatePresence>
                      {showCompleted && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
                          className="overflow-hidden"
                        >
                          <div className="pt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-5">
                            {finished.map((session) => (
                              <SessionCard
                                key={session.id}
                                session={session}
                                busy={busyId === session.id}
                                onContinue={handleContinue}
                                onPause={handlePause}
                                onEnd={handleEnd}
                              />
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {inProgress.length === 0 && finished.length === 0 && (
                  <div className="pt-8 pb-2 text-center text-[13px] text-muted-foreground/60">
                    {t('classroom.searchEmpty')}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
