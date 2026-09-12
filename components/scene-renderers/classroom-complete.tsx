'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { animate, motion, MotionConfig, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import {
  ArrowRight,
  Award,
  FileText,
  HelpCircle,
  Gamepad2,
  Loader2,
  Pause,
  Puzzle,
  RotateCcw,
  Sparkles as SparklesIcon,
  Trophy,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useStageStore } from '@/lib/store';
import type { Scene, SceneType } from '@/lib/types/stage';
import {
  completeSummaryForScenes,
  pendingCompleteSummary,
  readSceneQuizAnswers,
  summarizeScenes,
} from '@/lib/classroom/complete-summary';
import { loadQuizAttemptState } from '@/lib/quiz/runtime';
import { getLearningSession } from '@/lib/classroom/learning-session-signal';
import { fetchCourse, type Course } from '@/lib/supabase/courses';
import { buildChapterLessonSessionState, buildLessonSessionState } from '@/lib/courses/lessons';
import { buildRecapOutline } from '@/lib/courses/recap';
import { fetchIngestion } from '@/lib/supabase/textbook-ingestions';
import {
  getCertificateDownloadUrl,
  getCertificateExcellenceDownloadUrl,
} from '@/lib/supabase/certificates';
import {
  dismissRecommendation,
  listActiveRecommendations,
  type Recommendation,
} from '@/lib/supabase/recommendations';
import { createLogger } from '@/lib/logger';

const log = createLogger('ClassroomComplete');

const SCENE_TYPE_ICONS: Record<SceneType, typeof FileText> = {
  slide: FileText,
  quiz: HelpCircle,
  interactive: Gamepad2,
  pbl: Puzzle,
};

const TYPE_ORDER: SceneType[] = ['slide', 'quiz', 'interactive', 'pbl'];

const CONFETTI_COLORS = [
  '#fbbf24',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#a855f7',
  '#3b82f6',
  '#10b981',
];

function encouragementKey(pct: number): 'high' | 'mid' | 'low' {
  if (pct >= 90) return 'high';
  if (pct >= 70) return 'mid';
  return 'low';
}

interface Particle {
  id: number;
  x: number;
  y: number;
  rotate: number;
  color: string;
  w: number;
  h: number;
  duration: number;
  delay: number;
  round: boolean;
}

function makeConfetti(count: number): Particle[] {
  const arr: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.45;
    const distance = 180 + Math.random() * 280;
    const w = 6 + Math.random() * 6;
    arr.push({
      id: i,
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance - 50,
      rotate: (Math.random() - 0.5) * 720,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      w,
      h: Math.random() > 0.3 ? w * 0.4 : w,
      duration: 1.0 + Math.random() * 0.9,
      delay: Math.random() * 0.12,
      round: Math.random() > 0.72,
    });
  }
  return arr;
}

function Confetti() {
  const prefersReducedMotion = useReducedMotion();
  const particles = useMemo(() => makeConfetti(55), []);
  if (prefersReducedMotion) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-visible"
    >
      {particles.map((p) => (
        <motion.div
          key={p.id}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.2 }}
          animate={{
            x: p.x,
            y: p.y + 220,
            opacity: 0,
            rotate: p.rotate,
            scale: 1,
          }}
          transition={{ duration: p.duration, delay: p.delay, ease: [0.1, 0.5, 0.4, 1] }}
          style={{
            position: 'absolute',
            width: p.w,
            height: p.h,
            backgroundColor: p.color,
            borderRadius: p.round ? '50%' : 2,
          }}
        />
      ))}
    </div>
  );
}

function Sparkle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden>
      <path d="M10 1 L12 8 L19 10 L12 12 L10 19 L8 12 L1 10 L8 8 Z" fill="currentColor" />
    </svg>
  );
}

function Sparkles() {
  const prefersReducedMotion = useReducedMotion();
  const sparkles = useMemo(
    () => [
      { x: -95, y: -40, size: 14, delay: 0.8, repeatDelay: 0.8 },
      { x: 95, y: -20, size: 18, delay: 1.1, repeatDelay: 1.0 },
      { x: -78, y: 55, size: 11, delay: 1.35, repeatDelay: 1.2 },
      { x: 82, y: 62, size: 15, delay: 1.55, repeatDelay: 0.9 },
      { x: 0, y: -88, size: 10, delay: 1.75, repeatDelay: 1.1 },
    ],
    [],
  );
  if (prefersReducedMotion) return null;

  return (
    <>
      {sparkles.map((s, i) => (
        <motion.div
          key={i}
          aria-hidden
          className="absolute text-amber-300 dark:text-amber-200"
          style={{
            width: s.size,
            height: s.size,
            left: `calc(50% + ${s.x}px - ${s.size / 2}px)`,
            top: `calc(50% + ${s.y}px - ${s.size / 2}px)`,
          }}
          initial={{ scale: 0, opacity: 0, rotate: 0 }}
          animate={{ scale: [0, 1, 0.7, 1, 0], opacity: [0, 1, 0.7, 1, 0], rotate: 180 }}
          transition={{
            duration: 2.2,
            delay: s.delay,
            repeat: Infinity,
            repeatDelay: s.repeatDelay,
            ease: 'easeInOut',
          }}
        >
          <Sparkle className="w-full h-full" />
        </motion.div>
      ))}
    </>
  );
}

function TrophySvg({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 150" className={className} aria-hidden>
      <defs>
        <linearGradient id="tc-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="35%" stopColor="#fbbf24" />
          <stop offset="75%" stopColor="#d97706" />
          <stop offset="100%" stopColor="#92400e" />
        </linearGradient>
        <linearGradient id="tc-gold-light" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#fcd34d" />
          <stop offset="50%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>
        <linearGradient id="tc-shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fffbeb" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#fffbeb" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Handles */}
      <path
        d="M 28 32 Q 6 32 8 60 Q 10 82 32 86"
        fill="none"
        stroke="url(#tc-gold)"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M 92 32 Q 114 32 112 60 Q 110 82 88 86"
        fill="none"
        stroke="url(#tc-gold)"
        strokeWidth="7"
        strokeLinecap="round"
      />
      {/* Cup */}
      <path d="M 25 18 L 95 18 L 95 50 Q 95 90 60 100 Q 25 90 25 50 Z" fill="url(#tc-gold)" />
      {/* Shine */}
      <path d="M 33 22 Q 32 60 42 88 L 38 88 Q 30 60 31 22 Z" fill="url(#tc-shine)" />
      {/* Rim */}
      <ellipse cx="60" cy="19" rx="36" ry="4.5" fill="#fde68a" />
      <ellipse
        cx="60"
        cy="19"
        rx="36"
        ry="4.5"
        fill="none"
        stroke="#b45309"
        strokeWidth="0.6"
        opacity="0.35"
      />
      {/* Star */}
      <path
        d="M 60 42 L 63.6 52.3 L 74.5 52.3 L 65.7 58.7 L 69 69 L 60 62.7 L 51 69 L 54.3 58.7 L 45.5 52.3 L 56.4 52.3 Z"
        fill="#ffffff"
        opacity="0.92"
      />
      {/* Stem */}
      <path d="M 52 100 L 68 100 L 66 116 L 54 116 Z" fill="url(#tc-gold)" />
      {/* Base tiers */}
      <rect x="40" y="116" width="40" height="7" rx="2" fill="url(#tc-gold-light)" />
      <rect x="32" y="123" width="56" height="9" rx="2" fill="url(#tc-gold)" />
      <rect x="28" y="132" width="64" height="6" rx="3" fill="url(#tc-gold-light)" />
    </svg>
  );
}

function AnimatedCounter({
  value,
  delay = 0,
  duration = 0.9,
}: {
  value: number;
  delay?: number;
  duration?: number;
}) {
  const prefersReducedMotion = useReducedMotion();
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const controls = animate(0, value, {
      delay,
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [value, delay, duration, prefersReducedMotion]);

  return <>{prefersReducedMotion ? value : display}</>;
}

function QuizRing({ pct, delay = 0 }: { pct: number; delay?: number }) {
  const prefersReducedMotion = useReducedMotion();
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative shrink-0" style={{ width: 88, height: 88 }}>
      <svg viewBox="0 0 88 88" className="w-full h-full -rotate-90">
        <defs>
          <linearGradient id="tc-ring-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
        </defs>
        <circle
          cx="44"
          cy="44"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-amber-200/70 dark:text-amber-900/40"
        />
        <motion.circle
          cx="44"
          cy="44"
          r={radius}
          fill="none"
          stroke="url(#tc-ring-gold)"
          strokeWidth="8"
          strokeLinecap="round"
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - pct / 100) }}
          transition={{
            duration: prefersReducedMotion ? 0 : 1.1,
            delay,
            ease: [0.16, 1, 0.3, 1],
          }}
          style={{ strokeDasharray: circumference }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xl font-black text-amber-700 dark:text-amber-300">
          <AnimatedCounter value={pct} delay={delay} duration={1.0} />
          <span className="text-sm font-bold">%</span>
        </span>
      </div>
    </div>
  );
}

/** How long the auto-continue countdown runs before lesson N+1 starts
 *  generating on its own — long enough to notice and react, short enough
 *  that doing nothing still "smoothly proceeds" per the intended default. */
const AUTO_CONTINUE_COUNTDOWN_SECONDS = 6;

/**
 * Structured-course continuation: only renders when this classroom's
 * tracked session belongs to a course (see lib/courses/lessons.ts).
 *
 * Default behavior is fully automatic — a short visible countdown, then
 * lesson N+1 starts generating on its own (informed by this lesson's scene
 * titles) with no click required. The learner can interrupt it two ways:
 * "Pause" stops the countdown and leaves a manual continue button instead;
 * "Review this lesson again" rewinds to this lesson's first scene, which
 * dismisses this completion screen entirely (the parent only renders it
 * while pending-scene + course-complete holds), naturally cancelling the
 * countdown along with it. Nothing is pre-generated ahead of the learner
 * reaching it — the countdown reaching zero IS the trigger.
 */
/**
 * The course-final recommendation is generated fire-and-forget right after
 * course completion (see app/api/assessments/course-final/route.ts) — this
 * does one delayed fetch rather than polling, and simply shows nothing if
 * it isn't ready yet by then. The reliable, always-current surface for
 * recommendations (including per-lesson ones) is My Progress.
 */
function CourseRecommendationCard({ courseId }: { courseId: string }) {
  const { t } = useI18n();
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      listActiveRecommendations()
        .then((recs) => {
          if (cancelled) return;
          setRecommendation(recs.find((r) => r.course_id === courseId) ?? null);
        })
        .catch((err) => log.warn('Failed to load course recommendation (ignored):', err));
    }, 4000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [courseId]);

  if (!recommendation || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    dismissRecommendation(recommendation.id).catch((err) =>
      log.warn('Failed to dismiss recommendation (ignored):', err),
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1.6 }}
      className="w-full max-w-md rounded-2xl border border-violet-200/60 dark:border-violet-800/40 bg-violet-50/60 dark:bg-violet-950/20 p-4 flex flex-col gap-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-violet-700 dark:text-violet-300">
          <SparklesIcon className="size-3.5" />
          {t('classroomComplete.recommendationTitle')}
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          title={t('classroomComplete.dismissRecommendation')}
          className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <p className="text-[13px] text-foreground/85">{recommendation.recommendation_text}</p>
      {recommendation.suggested_focus_areas && recommendation.suggested_focus_areas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {recommendation.suggested_focus_areas.map((area) => (
            <span
              key={area}
              className="text-[11px] px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300"
            >
              {area}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}

/**
 * Certificate generation is fire-and-forget at course completion (see
 * PlaybackChromeRoot.tsx), so by the time this renders it's usually
 * already generated — but the download route is idempotent, so clicking
 * before that finishes just generates it on demand instead of erroring.
 * Unconditional: every completed course or session gets this one, no
 * lesson-count threshold. The separate, additional Certificate of
 * Excellence (courses over 10 lessons only) has its own button below.
 */
function CertificateDownloadButton({ courseId }: { courseId: string }) {
  const { t } = useI18n();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const url = await getCertificateDownloadUrl({ courseId });
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      log.error('Failed to download certificate:', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={downloading}
      className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-4 py-2 text-sm font-medium text-foreground/80 hover:bg-muted/60 transition-colors disabled:opacity-50 cursor-pointer"
    >
      {downloading ? <Loader2 className="size-4 animate-spin" /> : <Award className="size-4" />}
      {t('classroomComplete.downloadCertificate')}
    </button>
  );
}

/**
 * A separate, additional certificate for courses over 10 lessons (grade,
 * skills acquired, serial code) — shown alongside the plain
 * CertificateDownloadButton above, not instead of it. Always rendered for
 * a completed course; a small course's click resolves to `ineligible`
 * rather than the button being hidden, since eligibility depends on the
 * book's true structured lesson total (not just a client-side field) and
 * isn't worth a pre-check fetch just to decide visibility.
 */
function CertificateExcellenceDownloadButton({ courseId }: { courseId: string }) {
  const { t } = useI18n();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const result = await getCertificateExcellenceDownloadUrl({ courseId });
      if (result.status === 'ineligible') {
        toast.info(t('classroomComplete.certificateIneligible'));
        return;
      }
      if (result.status === 'pending') {
        toast.info(t('classroomComplete.certificatePending'));
        return;
      }
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      log.error('Failed to download certificate of excellence:', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={downloading}
      className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/60 dark:border-amber-700/60 px-4 py-2 text-sm font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors disabled:opacity-50 cursor-pointer"
    >
      {downloading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Trophy className="size-4" />
      )}
      {t('classroomComplete.downloadCertificateExcellence')}
    </button>
  );
}

function CourseContinuation({ stageId, scenes }: { stageId?: string | null; scenes: Scene[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [loaded, setLoaded] = useState<{
    course: Course;
    lessonNumber: number;
    sourceIngestionId: string | null;
    sourceChapterIndex: number | null;
  } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_CONTINUE_COUNTDOWN_SECONDS);
  const [paused, setPaused] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!stageId) return;
    const session = getLearningSession(stageId);
    if (!session?.course_id || !session.lesson_number) return;
    const lessonNumber = session.lesson_number;
    fetchCourse(session.course_id)
      .then((course) => {
        if (course) {
          setLoaded({
            course,
            lessonNumber,
            sourceIngestionId: session.source_ingestion_id,
            sourceChapterIndex: session.source_chapter_index,
          });
        }
      })
      .catch((err) => log.warn('Failed to load course for continuation (ignored):', err));
  }, [stageId]);

  const isLastLesson =
    !!loaded &&
    loaded.course.planned_lesson_count != null &&
    loaded.lessonNumber >= loaded.course.planned_lesson_count;

  const startNextLesson = useCallback(async () => {
    if (!loaded || startedRef.current) return;
    startedRef.current = true;
    const priorLessonTitles = scenes.map((s) => s.title).filter((title): title is string => !!title);

    if (loaded.sourceIngestionId && loaded.sourceChapterIndex != null) {
      try {
        const ingestion = await fetchIngestion(loaded.sourceIngestionId);
        const items = ingestion?.chapters?.items ?? [];
        const nextIndex = items.findIndex(
          (c, i) => i > loaded.sourceChapterIndex! && c.includeAsLesson,
        );
        if (nextIndex !== -1) {
          const nextChapter = items[nextIndex];

          // Every chapter continuation is at least a chapter boundary (the
          // search above always lands on a strictly later chapter, never a
          // second lesson within the same one — a pre-existing gap, not
          // something this recap logic changes). Module-tier wins over
          // chapter-tier when the next chapter belongs to a different
          // module than the one just finished (both need a module layer —
          // see needsModuleLayer in lib/textbook/structure-plan.ts; a
          // module-less book never takes this branch).
          const finishedChapter = items[loaded.sourceChapterIndex];
          const finishedModule = finishedChapter?.moduleNumber ?? null;
          const nextModule = nextChapter.moduleNumber ?? null;
          const recapOutline =
            finishedModule != null && nextModule != null && finishedModule !== nextModule
              ? buildRecapOutline(
                  'module',
                  items
                    .filter((c) => c.moduleNumber === finishedModule && c.summary)
                    .map((c) => c.summary),
                )
              : buildRecapOutline('chapter', finishedChapter?.summary ? [finishedChapter.summary] : []);

          const sessionState = buildChapterLessonSessionState(
            loaded.course,
            loaded.lessonNumber + 1,
            nextChapter.title,
            nextChapter.text,
            loaded.sourceIngestionId,
            nextIndex,
            priorLessonTitles,
          );
          sessionState.recapOutline = recapOutline;
          sessionStorage.setItem('generationSession', JSON.stringify(sessionState));
          router.push('/generation-preview');
          return;
        }
        log.warn('No further selected chapters found; falling back to a general next lesson.');
      } catch (err) {
        log.warn('Failed to load next chapter for continuation (falling back):', err);
      }
    }

    const sessionState = buildLessonSessionState(loaded.course, loaded.lessonNumber + 1, priorLessonTitles);
    sessionState.recapOutline = buildRecapOutline('lesson', priorLessonTitles);
    sessionStorage.setItem('generationSession', JSON.stringify(sessionState));
    router.push('/generation-preview');
  }, [loaded, scenes, router]);

  // The countdown itself — ticks down once a second, then triggers.
  useEffect(() => {
    if (!loaded || isLastLesson || paused || startedRef.current) return;
    if (secondsLeft <= 0) {
      startNextLesson();
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [loaded, isLastLesson, paused, secondsLeft, startNextLesson]);

  const handleReviewLesson = () => {
    if (scenes.length > 0) {
      useStageStore.getState().setCurrentSceneId(scenes[0].id);
    }
  };

  if (!loaded) return null;
  const { lessonNumber, course } = loaded;

  if (isLastLesson) {
    return (
      <div className="flex flex-col items-center gap-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.4 }}
          className="inline-flex items-center gap-2 rounded-full bg-amber-100 dark:bg-amber-900/40 px-4 py-2 text-sm font-semibold text-amber-700 dark:text-amber-300"
        >
          <Trophy className="size-4" />
          {t('classroomComplete.courseComplete', { title: course.title })}
        </motion.div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <CertificateDownloadButton courseId={course.id} />
          <CertificateExcellenceDownloadButton courseId={course.id} />
        </div>
        <CourseRecommendationCard courseId={course.id} />
      </div>
    );
  }

  const nextLessonNumber = lessonNumber + 1;

  if (paused) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center gap-2"
      >
        <button
          type="button"
          onClick={startNextLesson}
          className="inline-flex items-center gap-2 rounded-full bg-violet-600 hover:bg-violet-700 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition-colors"
        >
          <ArrowRight className="size-4" />
          {t('classroomComplete.continueToLesson', { number: nextLessonNumber })}
        </button>
        <button
          type="button"
          onClick={handleReviewLesson}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RotateCcw className="size-3" />
          {t('classroomComplete.reviewLesson')}
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1.4 }}
      className="flex flex-col items-center gap-2.5"
    >
      <div className="inline-flex items-center gap-2 rounded-full bg-violet-100 dark:bg-violet-900/40 px-4 py-2 text-sm font-semibold text-violet-700 dark:text-violet-300">
        <Loader2 className="size-4 animate-spin" />
        {t('classroomComplete.preparingNextLesson', { seconds: secondsLeft })}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPaused(true)}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Pause className="size-3" />
          {t('classroomComplete.pauseAutoContinue')}
        </button>
        <button
          type="button"
          onClick={handleReviewLesson}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RotateCcw className="size-3" />
          {t('classroomComplete.reviewLesson')}
        </button>
      </div>
    </motion.div>
  );
}

interface ClassroomCompletePageProps {
  readonly scenes: Scene[];
  readonly title: string;
  readonly stageId?: string | null;
}

export function ClassroomCompletePage({ scenes, title, stageId }: ClassroomCompletePageProps) {
  const { t, locale } = useI18n();
  const prefersReducedMotion = useReducedMotion();

  const [resolvedSummary, setResolvedSummary] = useState(() => ({
    scenes,
    summary: pendingCompleteSummary(scenes),
  }));
  const summary = completeSummaryForScenes(scenes, resolvedSummary);

  useEffect(() => {
    let cancelled = false;
    void summarizeScenes(scenes, async (sceneId) => {
      const scene = scenes.find((candidate) => candidate.id === sceneId);
      try {
        return await readSceneQuizAnswers(scene, loadQuizAttemptState);
      } catch (error) {
        log.warn(`Failed to load quiz summary for scene ${sceneId}:`, error);
        return undefined;
      }
    }).then((next) => {
      if (!cancelled) setResolvedSummary({ scenes, summary: next });
    });
    return () => {
      cancelled = true;
    };
  }, [scenes]);

  const dateLabel = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(locale).format(new Date());
    } catch {
      return new Date().toLocaleDateString();
    }
  }, [locale]);

  const trailItems = TYPE_ORDER.filter((type) => (summary.countsByType[type] ?? 0) > 0).map(
    (type) => ({
      type,
      count: summary.countsByType[type] ?? 0,
      Icon: SCENE_TYPE_ICONS[type],
      label: t(`classroomComplete.trailLabels.${type}`),
    }),
  );

  return (
    <MotionConfig reducedMotion={prefersReducedMotion ? 'always' : 'user'}>
      <section
        className="absolute inset-0 z-[105] flex items-center justify-center overflow-auto"
        aria-label={t('classroomComplete.title')}
      >
        {/* Single-shot announcement for screen readers — replaces the noisy
            outer aria-live region that used to wrap the live-updating counters. */}
        <span className="sr-only" role="status">
          {t('classroomComplete.title')}
        </span>
        {/* Base background */}
        <div className="absolute inset-0 bg-gradient-to-br from-amber-50 via-white to-orange-50 dark:from-gray-900 dark:via-gray-900 dark:to-amber-950/30" />
        {/* Radial glow */}
        <motion.div
          aria-hidden
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 50% 42%, rgba(251, 191, 36, 0.32), rgba(249, 115, 22, 0.12) 38%, transparent 68%)',
          }}
        />
        {/* Confetti */}
        <Confetti />

        {/* Content */}
        <div className="relative flex flex-col items-center gap-6 max-w-2xl w-full px-8 py-10">
          {/* Trophy + halo + sparkles */}
          <div className="relative" style={{ width: 200, height: 200 }}>
            <motion.div
              aria-hidden
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: [0.9, 1.15, 0.95, 1.1], opacity: [0, 0.55, 0.4, 0.5] }}
              transition={{
                delay: 0.15,
                duration: 2.6,
                repeat: Infinity,
                repeatType: 'reverse',
                ease: 'easeInOut',
              }}
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  'radial-gradient(circle, rgba(251, 191, 36, 0.5), rgba(249, 115, 22, 0.12) 55%, transparent 72%)',
                filter: 'blur(14px)',
              }}
            />
            <motion.div
              aria-hidden
              initial={{ y: 44, scale: 0.4, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.2 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <motion.div
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                style={{ width: 148, height: 185 }}
              >
                <TrophySvg className="w-full h-full drop-shadow-[0_10px_18px_rgba(180,83,9,0.35)]" />
              </motion.div>
            </motion.div>
            <Sparkles />
          </div>

          {/* Ribbon */}
          <motion.div
            initial={{ opacity: 0, scale: 0.7, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: 0.65, type: 'spring', stiffness: 280, damping: 18 }}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 text-white text-xs font-bold uppercase tracking-wider shadow-lg shadow-amber-500/30"
          >
            <Sparkle className="w-3 h-3" />
            {t('classroomComplete.title')}
            <Sparkle className="w-3 h-3" />
          </motion.div>

          {/* Title + date */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.78, duration: 0.4, ease: 'easeOut' }}
            className="text-center space-y-1.5"
          >
            <h2 className="text-3xl md:text-4xl font-black leading-tight bg-gradient-to-br from-amber-700 via-orange-600 to-amber-800 dark:from-amber-200 dark:via-orange-200 dark:to-amber-300 bg-clip-text text-transparent">
              {title || t('classroomComplete.title')}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">{dateLabel}</p>
          </motion.div>

          {/* Stats cards */}
          {trailItems.length > 0 && (
            <div
              className={cn(
                'grid gap-3 w-full',
                trailItems.length === 1 && 'grid-cols-1 max-w-[180px]',
                trailItems.length === 2 && 'grid-cols-2 max-w-md',
                trailItems.length === 3 && 'grid-cols-3',
                trailItems.length === 4 && 'grid-cols-2 sm:grid-cols-4',
              )}
            >
              {trailItems.map(({ type, count, Icon, label }, idx) => {
                const cardDelay = 0.96 + idx * 0.08;
                return (
                  <motion.div
                    key={type}
                    initial={{ opacity: 0, y: 14, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{
                      delay: cardDelay,
                      type: 'spring',
                      stiffness: 260,
                      damping: 20,
                    }}
                    className="rounded-2xl bg-white/90 dark:bg-gray-900/70 border border-amber-100 dark:border-amber-900/40 shadow-sm px-4 py-4 flex flex-col items-center gap-1.5 backdrop-blur-sm"
                  >
                    <Icon
                      className="w-6 h-6 text-amber-500 dark:text-amber-400"
                      strokeWidth={1.8}
                    />
                    <div className="text-3xl font-black text-gray-900 dark:text-gray-100 leading-none">
                      <AnimatedCounter value={count} delay={cardDelay + 0.15} />
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {label}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Quiz card */}
          {summary.quiz && (
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 1.2, type: 'spring', stiffness: 220, damping: 20 }}
              className="w-full rounded-2xl bg-gradient-to-br from-amber-100 via-orange-50 to-amber-100 dark:from-amber-950/50 dark:via-orange-950/30 dark:to-amber-950/50 border border-amber-200 dark:border-amber-900/50 px-6 py-5 shadow-md shadow-amber-200/30 dark:shadow-amber-950/20"
            >
              <div className="flex items-center gap-5">
                <QuizRing pct={summary.quiz.pct} delay={1.3} />
                <div className="flex-1 min-w-0">
                  <div className="text-base font-bold text-amber-700 dark:text-amber-300">
                    {t('classroomComplete.quizScoreLabel', {
                      correct: summary.quiz.correct,
                      total: summary.quiz.total,
                    })}
                  </div>
                  <div className="mt-1 text-sm text-amber-700/80 dark:text-amber-300/80">
                    {t(`classroomComplete.encouragement.${encouragementKey(summary.quiz.pct)}`)}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          <CourseContinuation stageId={stageId} scenes={scenes} />
        </div>
      </section>
    </MotionConfig>
  );
}

export function ClassroomCompletePageConnected() {
  const stage = useStageStore((s) => s.stage);
  const scenes = useStageStore((s) => s.scenes);
  return <ClassroomCompletePage scenes={scenes} title={stage?.name ?? ''} stageId={stage?.id} />;
}
