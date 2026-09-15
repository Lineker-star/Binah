'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { createLogger } from '@/lib/logger';
import { generateExam, type ExamResult } from '@/lib/courses/exam';
import { recordAssessment } from '@/lib/supabase/assessments';
import {
  StandaloneQuizSurface,
  type StandaloneQuizResult,
} from '@/components/quiz/standalone-quiz-surface';

const log = createLogger('ExamPage');

export default function ExamPage() {
  const params = useParams();
  const kind = params?.kind as string;
  const id = params?.id as string;
  const router = useRouter();
  const { t } = useI18n();

  const [exam, setExam] = useState<ExamResult | null>(null);
  const [error, setError] = useState(false);
  const requestedRef = useRef(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!id || (kind !== 'module' && kind !== 'book') || requestedRef.current) return;
    requestedRef.current = true;
    generateExam(kind, id)
      .then(setExam)
      .catch((err) => {
        log.error('Failed to generate exam:', err);
        setError(true);
      });
  }, [kind, id]);

  const handleComplete = async (result: StandaloneQuizResult) => {
    if (!exam) return;
    await recordAssessment({
      assessmentType: 'exam',
      sessionId: null,
      moduleId: exam.moduleId,
      courseId: exam.moduleId ? null : exam.courseId,
      score: result.score,
      maxScore: result.maxScore,
      evaluatedBy: 'system',
    }).catch((err) => {
      log.warn('Failed to record exam (ignored):', err);
    });
    setDone(true);
  };

  const backHref = exam ? `/textbook/${exam.ingestionId}` : '/app';

  if (error) {
    return (
      <div className="max-w-xl mx-auto px-6 py-24 flex flex-col items-center gap-3 text-center">
        <div className="text-[14px] text-destructive">{t('exam.generateFailed')}</div>
        <Link href="/app" className="text-[13px] text-primary hover:underline mt-2">
          {t('history.backToHome')}
        </Link>
      </div>
    );
  }

  if (!exam) {
    return (
      <div className="max-w-xl mx-auto px-6 py-24 flex flex-col items-center gap-3 text-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
        <div className="text-[14px] text-foreground/85">{t('exam.generating')}</div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] w-full flex flex-col">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between shrink-0">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          {t('history.backToHome')}
        </Link>
        <span className="text-[13px] font-medium text-foreground truncate max-w-[50%]">
          {exam.examTitle}
        </span>
      </div>

      <div className="flex-1 min-h-0">
        <StandaloneQuizSurface
          questions={exam.questions}
          title={t('exam.title')}
          subtitle={t('exam.subtitle', { scope: exam.examTitle })}
          onComplete={handleComplete}
          onRetake={() => setDone(false)}
        />
      </div>

      {done && (
        <div className="fixed left-0 right-0 bottom-0 flex justify-center px-6 pb-6 pt-10 bg-gradient-to-t from-background via-background/95 to-transparent pointer-events-none">
          <button
            type="button"
            onClick={() => router.push(backHref)}
            className="pointer-events-auto inline-flex items-center gap-1.5 h-10 px-5 rounded-xl bg-primary text-primary-foreground text-[13.5px] font-semibold hover:opacity-90 transition-opacity cursor-pointer shadow-lg"
          >
            {t('exam.continueToBook')}
          </button>
        </div>
      )}
    </div>
  );
}
