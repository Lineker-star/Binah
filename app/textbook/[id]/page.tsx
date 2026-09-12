'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ChevronDown, Loader2, Pause, Play, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { createLogger } from '@/lib/logger';
import {
  fetchAudioOverview,
  fetchIngestion,
  generateAudioOverview,
  setIngestionCourseId,
  updateIngestionChapters,
  type SignedAudioOverviewTurn,
  type TextbookIngestion,
} from '@/lib/supabase/textbook-ingestions';
import { createCourse } from '@/lib/supabase/courses';
import { buildChapterLessonSessionState } from '@/lib/courses/lessons';
import type { IngestedChapter } from '@/lib/textbook/types';
import {
  listIngestionLessonsByChapter,
  type ChapterExportLesson,
} from '@/lib/supabase/learning-session';
import { listBookChapterIds } from '@/lib/supabase/book-chapters';
import { ChapterDownloadMenu } from '@/components/textbook/chapter-download-menu';

const log = createLogger('TextbookChapterReview');

const AUDIO_POLL_INTERVAL_MS = 4000;
const AUDIO_POLL_MAX_ATTEMPTS = 10;
const INGESTION_POLL_INTERVAL_MS = 3000;

function estimateMinutes(items: IngestedChapter[]): number {
  const pages = items
    .filter((c) => c.includeAsLesson)
    .reduce((sum, c) => sum + (c.endPage - c.startPage + 1), 0);
  return Math.max(5, Math.round((pages / 15) * 15));
}

export default function TextbookChapterReviewPage() {
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();
  const { t } = useI18n();

  const [ingestion, setIngestion] = useState<TextbookIngestion | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [building, setBuilding] = useState(false);

  const [audioTurns, setAudioTurns] = useState<SignedAudioOverviewTurn[] | null>(null);
  const [audioStatus, setAudioStatus] = useState<'pending' | 'ready' | 'failed'>('pending');
  const audioTriggeredRef = useRef(false);
  const audioPollCountRef = useRef(0);

  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // Per-lesson/per-chapter download data — best-effort and non-blocking:
  // the chapter cards render fine before/without this, it just skips
  // showing a download action until it resolves (or for an anonymous
  // visitor, forever — both queries return empty rather than erroring).
  const [chapterLessons, setChapterLessons] = useState<Map<number, ChapterExportLesson[]>>(
    new Map(),
  );
  const [bookChapterIds, setBookChapterIds] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    if (!ingestion) return;
    listIngestionLessonsByChapter(ingestion.id)
      .then(setChapterLessons)
      .catch((err) => log.warn('Failed to load chapter lesson data (ignored):', err));
    listBookChapterIds(ingestion.id)
      .then(setBookChapterIds)
      .catch((err) => log.warn('Failed to load book chapter ids (ignored):', err));
  }, [ingestion?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(() => {
    fetchIngestion(id)
      .then(setIngestion)
      .catch((err) => log.error('Failed to load textbook ingestion:', err))
      .finally(() => setLoaded(true));
  }, [id]);

  useEffect(load, [load]);

  // Poll while the main ingestion (chapter detection + summaries) is still processing.
  useEffect(() => {
    if (ingestion?.status !== 'processing') return;
    const timer = setInterval(load, INGESTION_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [ingestion?.status, load]);

  // Once summaries are ready, kick off the Audio Overview (best-effort, once)
  // and poll a bounded number of times for the result.
  useEffect(() => {
    if (ingestion?.status !== 'ready' || audioTriggeredRef.current) return;
    audioTriggeredRef.current = true;
    generateAudioOverview(id).catch((err) =>
      log.warn('Failed to start audio overview generation (ignored):', err),
    );
  }, [ingestion?.status, id]);

  useEffect(() => {
    if (ingestion?.status !== 'ready' || audioStatus !== 'pending') return;
    const timer = setInterval(() => {
      audioPollCountRef.current += 1;
      fetchAudioOverview(id)
        .then((res) => {
          if (res.status === 'ready' || res.status === 'failed') {
            setAudioStatus(res.status);
            setAudioTurns(res.turns);
          } else if (audioPollCountRef.current >= AUDIO_POLL_MAX_ATTEMPTS) {
            setAudioStatus('failed');
          }
        })
        .catch((err) => log.warn('Failed to poll audio overview (ignored):', err));
    }, AUDIO_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [ingestion?.status, audioStatus, id]);

  const items = ingestion?.chapters?.items ?? [];
  const selectedCount = items.filter((c) => c.includeAsLesson).length;

  // Both fields are absent (not just null) on ingestions written before Q.3
  // -- `some` naturally stays false for those, and the list below renders
  // exactly as it did before this hierarchy existed.
  const hasModules = items.some((c) => c.moduleNumber != null);
  const hasLessonPlan = items.some((c) => c.plannedLessonCount != null);
  const moduleLessonTotals = new Map<number, number>();
  if (hasModules) {
    for (const chapter of items) {
      if (chapter.moduleNumber == null || chapter.plannedLessonCount == null) continue;
      moduleLessonTotals.set(
        chapter.moduleNumber,
        (moduleLessonTotals.get(chapter.moduleNumber) ?? 0) + chapter.plannedLessonCount,
      );
    }
  }

  const chapterOnlyItems = items.filter((c) => c.kind === 'chapter');
  const totalLessons = chapterOnlyItems.reduce((sum, c) => sum + (c.plannedLessonCount ?? 0), 0);
  const moduleCount = new Set(
    items.map((c) => c.moduleNumber).filter((n): n is number => n != null),
  ).size;

  // Contiguous groups by module number -- module assignment never
  // interleaves (see lib/textbook/structure-plan.ts#groupChaptersIntoModules),
  // so a single left-to-right pass is enough to bucket every item.
  interface ModuleGroup {
    moduleNumber: number;
    entries: Array<{ chapter: IngestedChapter; index: number }>;
  }
  const moduleGroups: ModuleGroup[] = [];
  if (hasModules) {
    for (let index = 0; index < items.length; index++) {
      const chapter = items[index];
      if (chapter.moduleNumber == null) continue;
      const currentGroup = moduleGroups[moduleGroups.length - 1];
      if (currentGroup?.moduleNumber === chapter.moduleNumber) {
        currentGroup.entries.push({ chapter, index });
      } else {
        moduleGroups.push({ moduleNumber: chapter.moduleNumber, entries: [{ chapter, index }] });
      }
    }
  }

  const [collapsedModules, setCollapsedModules] = useState<Set<number>>(new Set());
  const toggleModuleCollapsed = (moduleNumber: number) => {
    setCollapsedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleNumber)) next.delete(moduleNumber);
      else next.add(moduleNumber);
      return next;
    });
  };

  const toggleChapter = (index: number) => {
    if (!ingestion?.chapters) return;
    const nextItems = ingestion.chapters.items.map((c, i) =>
      i === index ? { ...c, includeAsLesson: !c.includeAsLesson } : c,
    );
    const nextChapters = { ...ingestion.chapters, items: nextItems };
    setIngestion({ ...ingestion, chapters: nextChapters });
    updateIngestionChapters(ingestion.id, nextChapters).catch((err) => {
      log.error('Failed to save chapter selection (ignored):', err);
    });
  };

  const playTurn = (index: number) => {
    if (!audioTurns?.[index]?.url) return;
    const el = audioElRef.current;
    if (!el) return;
    el.src = audioTurns[index].url!;
    el.play().catch((err) => log.warn('Audio overview playback failed:', err));
    setPlayingIndex(index);
  };

  const handlePlayPause = () => {
    if (!audioTurns || audioTurns.length === 0) return;
    const el = audioElRef.current;
    if (playingIndex !== null && el && !el.paused) {
      el.pause();
      setPlayingIndex(null);
      return;
    }
    playTurn(playingIndex ?? 0);
  };

  const handleAudioEnded = () => {
    if (playingIndex === null || !audioTurns) return;
    const next = playingIndex + 1;
    if (next < audioTurns.length) {
      playTurn(next);
    } else {
      setPlayingIndex(null);
    }
  };

  const handleBuildCourse = async () => {
    if (!ingestion?.chapters) return;
    const selected = ingestion.chapters.items
      .map((c, i) => ({ chapter: c, index: i }))
      .filter((e) => e.chapter.includeAsLesson);
    if (selected.length === 0) {
      toast.warning(t('textbook.noChaptersSelected'));
      return;
    }
    setBuilding(true);
    try {
      const plannedMinutes = 15;
      const course = await createCourse({
        title: ingestion.original_filename.replace(/\.pdf$/i, ''),
        description: ingestion.chapters.wholeBookSummary || null,
        plannedLessonCount: selected.length,
        plannedMinutesPerLesson: plannedMinutes,
      });
      await setIngestionCourseId(ingestion.id, course.id);

      const first = selected[0];
      const sessionState = buildChapterLessonSessionState(
        course,
        1,
        first.chapter.title,
        first.chapter.text,
        ingestion.id,
        first.index,
      );
      sessionStorage.setItem('generationSession', JSON.stringify(sessionState));
      router.push('/generation-preview');
    } catch (err) {
      log.error('Failed to build course from textbook:', err);
      toast.error(t('textbook.buildFailed'));
      setBuilding(false);
    }
  };

  if (!loaded) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-24 text-center text-[13px] text-muted-foreground">
        {t('common.loading')}
      </div>
    );
  }

  if (!ingestion) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-24 text-center text-[13px] text-muted-foreground">
        {t('textbook.notFound')}
      </div>
    );
  }

  if (ingestion.status === 'processing' || ingestion.status === 'uploaded') {
    return (
      <div className="max-w-4xl mx-auto px-6 py-24 flex flex-col items-center gap-3 text-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
        <div className="text-[14px] text-foreground/85">{t('textbook.processing')}</div>
        <div className="text-[12px] text-muted-foreground">{ingestion.original_filename}</div>
      </div>
    );
  }

  if (ingestion.status === 'error') {
    return (
      <div className="max-w-4xl mx-auto px-6 py-24 flex flex-col items-center gap-3 text-center">
        <div className="text-[14px] text-destructive">{t('textbook.error')}</div>
        {ingestion.error_message && (
          <div className="text-[12px] text-muted-foreground max-w-md">{ingestion.error_message}</div>
        )}
        <Link href="/" className="text-[13px] text-primary hover:underline mt-2">
          {t('history.backToHome')}
        </Link>
      </div>
    );
  }

  const chapters = ingestion.chapters!;
  const bookTitle = ingestion.original_filename.replace(/\.pdf$/i, '');

  const renderChapterCard = (chapter: IngestedChapter, index: number): ReactNode => {
    const isFrontOrBack = chapter.kind !== 'chapter';
    return (
      <div
        key={index}
        className={cn(
          'rounded-xl border border-border/60 bg-card/60 p-4 flex gap-3 items-start transition-colors',
          !chapter.includeAsLesson && 'opacity-55',
        )}
      >
        <input
          type="checkbox"
          checked={chapter.includeAsLesson}
          onChange={() => toggleChapter(index)}
          className="mt-1 size-4 accent-primary cursor-pointer"
        />
        {!isFrontOrBack ? (
          <div className="shrink-0 size-7 rounded-lg bg-primary/10 text-primary text-[12px] font-bold flex items-center justify-center">
            {items.slice(0, index + 1).filter((c) => c.kind === 'chapter').length}
          </div>
        ) : (
          <div className="shrink-0 size-7 rounded-lg bg-muted text-muted-foreground text-[12px] flex items-center justify-center">
            —
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[14px] font-medium text-foreground">{chapter.title}</span>
            {isFrontOrBack ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                {chapter.kind === 'front_matter' ? t('textbook.frontMatter') : t('textbook.backMatter')}
              </span>
            ) : (
              <span
                className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded-full',
                  chapter.detectionMethod === 'native_outline'
                    ? 'bg-muted text-muted-foreground'
                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                )}
              >
                {chapter.detectionMethod === 'native_outline'
                  ? t('textbook.pdfOutline')
                  : t('textbook.aiDetected')}
              </span>
            )}
            {chapter.plannedLessonCount != null && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                {t('textbook.lessonCount', { count: chapter.plannedLessonCount })}
              </span>
            )}
          </div>
          {chapter.summary && (
            <p className="text-[13px] leading-relaxed text-muted-foreground">{chapter.summary}</p>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <span className="text-[12px] text-muted-foreground tabular-nums">
            {t('textbook.pageRange', { start: chapter.startPage, end: chapter.endPage })}
          </span>
          {!isFrontOrBack && (
            <ChapterDownloadMenu
              title={chapter.title}
              lessons={chapterLessons.get(index) ?? []}
              chapterId={bookChapterIds.get(index + 1) ?? null}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 pb-32">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="size-3.5" />
        {t('history.backToHome')}
      </Link>

      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">{bookTitle}</h1>
        {hasLessonPlan && (
          <p className="text-[14px] font-semibold text-primary mt-2">
            {hasModules
              ? t('textbook.totalLessonsWithModules', {
                  lessons: totalLessons,
                  modules: moduleCount,
                  chapters: chapterOnlyItems.length,
                })
              : t('textbook.totalLessonsNoModules', {
                  lessons: totalLessons,
                  chapters: chapterOnlyItems.length,
                })}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {ingestion.total_pages != null && (
            <span className="text-[12px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {t('textbook.pageCount', { count: ingestion.total_pages })}
            </span>
          )}
          <span className="text-[12px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {t('textbook.sectionsDetected', { count: items.length })}
          </span>
          <span className="text-[12px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {t('textbook.estimatedMinutes', { minutes: estimateMinutes(items) })}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr] gap-4 mb-8">
        <div className="rounded-2xl border border-border/60 bg-card/60 p-5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-primary block mb-2">
            {t('textbook.whatThisBookCovers')}
          </span>
          <p className="text-[14.5px] leading-relaxed text-foreground/90">
            {chapters.wholeBookSummary || t('textbook.summaryUnavailable')}
          </p>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/60 p-4 flex flex-col gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
            {t('textbook.audioOverview')}
          </span>
          {audioStatus === 'pending' && (
            <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t('textbook.audioGenerating')}
            </div>
          )}
          {audioStatus === 'failed' && (
            <div className="text-[12.5px] text-muted-foreground">{t('textbook.audioUnavailable')}</div>
          )}
          {audioStatus === 'ready' && audioTurns && audioTurns.length > 0 && (
            <>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handlePlayPause}
                  className="shrink-0 size-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90 transition-opacity cursor-pointer"
                >
                  {playingIndex !== null ? <Pause className="size-4" /> : <Play className="size-4" />}
                </button>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-foreground">
                    {t('textbook.twoVoicesIntro')}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {t('textbook.turnOf', {
                      current: (playingIndex ?? 0) + 1,
                      total: audioTurns.length,
                    })}
                  </div>
                </div>
              </div>
              <div className="flex gap-1.5">
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {t('textbook.teacher')}
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {t('textbook.classmate')}
                </span>
              </div>
              <audio ref={audioElRef} onEnded={handleAudioEnded} className="hidden" />
            </>
          )}
        </div>
      </div>

      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide">
          {t('textbook.chaptersHeading')}
        </h2>
      </div>

      {hasModules ? (
        <div className="flex flex-col gap-3">
          {moduleGroups.map((group) => {
            const collapsed = collapsedModules.has(group.moduleNumber);
            const lessonTotal = moduleLessonTotals.get(group.moduleNumber);
            return (
              <div
                key={group.moduleNumber}
                className="rounded-2xl border border-border/60 bg-card/40 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleModuleCollapsed(group.moduleNumber)}
                  aria-expanded={!collapsed}
                  className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ChevronDown
                      className={cn(
                        'size-4 shrink-0 text-muted-foreground transition-transform',
                        collapsed && '-rotate-90',
                      )}
                    />
                    <h3 className="text-[13px] font-semibold text-foreground truncate">
                      {t('textbook.moduleHeading', { number: group.moduleNumber })}
                    </h3>
                  </div>
                  {lessonTotal != null && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {t('textbook.lessonCount', { count: lessonTotal })}
                    </span>
                  )}
                </button>
                {!collapsed && (
                  <div className="flex flex-col gap-2 px-3 pb-3 pt-1">
                    {group.entries.map(({ chapter, index }) => renderChapterCard(chapter, index))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((chapter, index) => renderChapterCard(chapter, index))}
        </div>
      )}

      <div className="fixed left-0 right-0 bottom-0 flex justify-center px-6 pb-6 pt-10 bg-gradient-to-t from-background via-background/95 to-transparent pointer-events-none">
        <div className="pointer-events-auto w-full max-w-4xl flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-card px-5 py-3 shadow-lg">
          <div className="text-[13px] text-muted-foreground">
            {t('textbook.selectionStatus', { selected: selectedCount, total: items.length })}
          </div>
          <button
            type="button"
            onClick={handleBuildCourse}
            disabled={building || selectedCount === 0}
            className="inline-flex items-center gap-1.5 h-10 px-5 rounded-xl bg-primary text-primary-foreground text-[13.5px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
          >
            {building && <Loader2 className="size-3.5 animate-spin" />}
            <Sparkles className="size-3.5" />
            {t('textbook.buildCourse')}
          </button>
        </div>
      </div>
    </div>
  );
}
