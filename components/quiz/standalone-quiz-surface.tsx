'use client';

/**
 * Generic quiz-taking surface for a quiz that isn't embedded in a specific
 * scene — Continuous Assessment first, the future Exam (R.3) reusing it
 * without a second one-off surface. Deliberately lightweight: unlike
 * components/scene-renderers/quiz-view.tsx, there is no draft-recovery or
 * attempt-runtime persistence (nothing keyed by stageId/sceneId to persist
 * against) — just in-memory phase/answer state for the current attempt.
 * The caller decides what happens to the result (recording the assessment,
 * navigating onward); this component only takes the learner through
 * answering -> grading -> reviewing.
 */
import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PieChart, CheckCircle2, RotateCcw, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { QuizQuestion } from '@/lib/types/stage';
import {
  gradeChoiceQuestions,
  gradeShortAnswerQuestion,
  isShortAnswer,
  type QuestionResult,
} from '@/lib/quiz/grading';
import {
  QuizCover,
  SingleChoiceQuestion,
  MultipleChoiceQuestion,
  ShortAnswerQuestion,
  ScoreBanner,
} from '@/components/quiz/quiz-question-parts';

type Phase = 'not_started' | 'answering' | 'grading' | 'reviewing';

export interface StandaloneQuizResult {
  score: number;
  maxScore: number;
  results: QuestionResult[];
}

export interface StandaloneQuizSurfaceProps {
  readonly questions: QuizQuestion[];
  /** Shown on the cover screen in place of the generic in-scene quiz copy. */
  readonly title: string;
  readonly subtitle?: string;
  /** Called once grading finishes. The surface itself never records an
   *  assessment or navigates anywhere -- that's the caller's call, since
   *  what assessment_type/chapter_id/course_id apply differs per use. */
  readonly onComplete?: (result: StandaloneQuizResult) => void | Promise<void>;
}

export function StandaloneQuizSurface({
  questions,
  title,
  subtitle,
  onComplete,
}: StandaloneQuizSurfaceProps) {
  const { t, locale } = useI18n();
  const [phase, setPhase] = useState<Phase>('not_started');
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [results, setResults] = useState<QuestionResult[]>([]);

  const totalPoints = useMemo(
    () => questions.reduce((sum, q) => sum + (q.points ?? 1), 0),
    [questions],
  );

  const allAnswered = useMemo(() => {
    return questions.every((q) => {
      const a = answers[q.id];
      if (!a) return false;
      if (Array.isArray(a)) return a.length > 0;
      return (a as string).trim().length > 0;
    });
  }, [questions, answers]);

  const handleSetAnswer = useCallback((questionId: string, value: string | string[]) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }, []);

  const handleSubmit = useCallback(async () => {
    setPhase('grading');

    const choiceResults = gradeChoiceQuestions(questions, answers);
    const shortAnswerQs = questions.filter(isShortAnswer);
    const aiResults = await Promise.all(
      shortAnswerQs.map((q) =>
        gradeShortAnswerQuestion(q, (answers[q.id] as string) ?? '', locale),
      ),
    );

    const allResultsMap = new Map<string, QuestionResult>();
    for (const r of [...choiceResults, ...aiResults]) {
      allResultsMap.set(r.questionId, r);
    }
    const ordered = questions.map((q) => allResultsMap.get(q.id)!).filter(Boolean);

    setResults(ordered);
    setPhase('reviewing');

    const earned = ordered.reduce((sum, r) => sum + r.earned, 0);
    await onComplete?.({ score: earned, maxScore: totalPoints, results: ordered });
  }, [questions, answers, locale, totalPoints, onComplete]);

  const handleRetry = useCallback(() => {
    setPhase('not_started');
    setAnswers({});
    setResults([]);
  }, []);

  const earnedScore = useMemo(() => results.reduce((sum, r) => sum + r.earned, 0), [results]);

  const resultMap = useMemo(() => {
    const map: Record<string, QuestionResult> = {};
    results.forEach((r) => {
      map[r.questionId] = r;
    });
    return map;
  }, [results]);

  return (
    <div className="w-full h-full bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-900 overflow-hidden flex flex-col">
      <AnimatePresence mode="wait">
        {phase === 'not_started' && (
          <motion.div
            key="cover"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex-1"
          >
            <QuizCover
              questionCount={questions.length}
              totalPoints={totalPoints}
              onStart={() => setPhase('answering')}
              title={title}
              subtitle={subtitle}
            />
          </motion.div>
        )}

        {phase === 'answering' && (
          <motion.div
            key="answering"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex-1 flex flex-col min-h-0"
          >
            <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80 backdrop-blur shrink-0">
              <div className="flex items-center gap-2">
                <PieChart className="w-4 h-4 text-violet-500" />
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                  {title}
                </span>
                <span className="text-xs text-gray-400 ml-1">
                  {
                    Object.keys(answers).filter((k) => {
                      const a = answers[k];
                      if (Array.isArray(a)) return a.length > 0;
                      return typeof a === 'string' && a.trim().length > 0;
                    }).length
                  }{' '}
                  / {questions.length}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!allAnswered}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  allAnswered
                    ? 'bg-gradient-to-r from-violet-500 to-purple-500 text-white shadow-sm hover:shadow-md hover:shadow-violet-200/50 dark:hover:shadow-violet-900/50 active:scale-[0.97]'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                }`}
              >
                {t('quiz.submitAnswers')}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {questions.map((q, i) => {
                if (q.type === 'single') {
                  return (
                    <SingleChoiceQuestion
                      key={q.id}
                      question={q}
                      index={i}
                      value={answers[q.id] as string | undefined}
                      onChange={(v) => handleSetAnswer(q.id, v)}
                    />
                  );
                }
                if (q.type === 'multiple') {
                  return (
                    <MultipleChoiceQuestion
                      key={q.id}
                      question={q}
                      index={i}
                      value={answers[q.id] as string[] | undefined}
                      onChange={(v) => handleSetAnswer(q.id, v)}
                    />
                  );
                }
                return (
                  <ShortAnswerQuestion
                    key={q.id}
                    question={q}
                    index={i}
                    value={answers[q.id] as string | undefined}
                    onChange={(v) => handleSetAnswer(q.id, v)}
                  />
                );
              })}
            </div>
          </motion.div>
        )}

        {phase === 'grading' && (
          <motion.div
            key="grading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center gap-5"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
            >
              <Loader2 className="w-10 h-10 text-violet-500" />
            </motion.div>
            <div className="text-center">
              <p className="text-base font-semibold text-gray-700 dark:text-gray-200">
                {t('quiz.aiGrading')}
              </p>
              <p className="text-sm text-gray-400 mt-1">{t('quiz.aiGradingWait')}</p>
            </div>
          </motion.div>
        )}

        {phase === 'reviewing' && (
          <motion.div
            key="reviewing"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex-1 flex flex-col min-h-0"
          >
            <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80 backdrop-blur shrink-0">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                  {t('quiz.quizReport')}
                </span>
              </div>
              <button
                type="button"
                onClick={handleRetry}
                className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t('quiz.retry')}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <ScoreBanner score={earnedScore} total={totalPoints} results={results} />

              {questions.map((q, i) => {
                const r = resultMap[q.id];
                if (q.type === 'single') {
                  return (
                    <SingleChoiceQuestion
                      key={q.id}
                      question={q}
                      index={i}
                      value={answers[q.id] as string | undefined}
                      onChange={() => {}}
                      disabled
                      result={r}
                    />
                  );
                }
                if (q.type === 'multiple') {
                  return (
                    <MultipleChoiceQuestion
                      key={q.id}
                      question={q}
                      index={i}
                      value={answers[q.id] as string[] | undefined}
                      onChange={() => {}}
                      disabled
                      result={r}
                    />
                  );
                }
                return (
                  <ShortAnswerQuestion
                    key={q.id}
                    question={q}
                    index={i}
                    value={answers[q.id] as string | undefined}
                    onChange={() => {}}
                    disabled
                    result={r}
                  />
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
