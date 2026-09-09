'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { nanoid } from 'nanoid';
import { GraduationCap, Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  fetchPublishedSkillTracks,
  fetchOwnEnrollments,
  enrollInTrack,
  type SkillTrack,
} from '@/lib/supabase/skill-tracks';
import type { GenerationSessionState } from '@/app/generation-preview/types';
import { createLogger } from '@/lib/logger';

const log = createLogger('SkillTracks');

export default function SkillTracksPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [tracks, setTracks] = useState<SkillTrack[]>([]);
  const [enrolledIds, setEnrolledIds] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState<string | null>(null);
  const [enrollingId, setEnrollingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchPublishedSkillTracks(), fetchOwnEnrollments()])
      .then(([trackRows, enrollments]) => {
        if (cancelled) return;
        setTracks(trackRows);
        setEnrolledIds(new Set(enrollments.map((e) => e.skill_track_id)));
      })
      .catch((err) => {
        log.error('Failed to load skill tracks:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const track of tracks) {
      if (track.category) set.add(track.category);
    }
    return Array.from(set).sort();
  }, [tracks]);

  const visibleTracks = category ? tracks.filter((tr) => tr.category === category) : tracks;

  const handleEnroll = async (track: SkillTrack) => {
    setEnrollingId(track.id);
    try {
      await enrollInTrack(track.id);
      setEnrolledIds((prev) => new Set(prev).add(track.id));
    } catch (err) {
      if (err instanceof Error && err.message === 'not-signed-in') {
        toast.error(t('skillTracks.signInToEnroll'));
      } else {
        log.error('Failed to enroll:', err);
        toast.error(t('skillTracks.enrollFailed'));
      }
    } finally {
      setEnrollingId(null);
    }
  };

  const handleStart = (track: SkillTrack) => {
    const requirement = track.description ? `${track.title}\n\n${track.description}` : track.title;
    const sessionState: GenerationSessionState = {
      sessionId: nanoid(),
      requirements: { requirement },
      pdfText: '',
      pdfImages: [],
      imageStorageIds: [],
      sceneOutlines: null,
      currentStep: 'generating',
      skillTrackId: track.id,
    };
    sessionStorage.setItem('generationSession', JSON.stringify(sessionState));
    router.push('/generation-preview');
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('auth.backToHome')}
      </Link>

      <h1 className="mt-6 text-lg font-semibold text-foreground flex items-center gap-2">
        <GraduationCap className="h-5 w-5" />
        {t('skillTracks.pageTitle')}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('skillTracks.subtitle')}</p>

      {loading && (
        <div className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('common.loading')}
        </div>
      )}

      {!loading && categories.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCategory(null)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
              category === null
                ? 'border-violet-400 dark:border-violet-500 bg-violet-50 dark:bg-violet-900/30 text-foreground'
                : 'border-border/60 text-muted-foreground hover:text-foreground',
            )}
          >
            {t('skillTracks.categoryAll')}
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                category === c
                  ? 'border-violet-400 dark:border-violet-500 bg-violet-50 dark:bg-violet-900/30 text-foreground'
                  : 'border-border/60 text-muted-foreground hover:text-foreground',
              )}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {!loading && visibleTracks.length === 0 && (
        <div className="mt-10 text-center text-sm text-muted-foreground">
          {t('skillTracks.empty')}
        </div>
      )}

      {!loading && visibleTracks.length > 0 && (
        <div className="mt-6 flex flex-col gap-3">
          {visibleTracks.map((track) => {
            const enrolled = enrolledIds.has(track.id);
            return (
              <div key={track.id} className="rounded-2xl border border-border/60 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold text-foreground">{track.title}</h2>
                      {track.category && (
                        <Badge variant="outline" className="shrink-0">
                          {track.category}
                        </Badge>
                      )}
                    </div>
                    {track.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{track.description}</p>
                    )}
                  </div>
                  <div className="shrink-0">
                    {enrolled ? (
                      <Button size="sm" onClick={() => handleStart(track)}>
                        {t('skillTracks.startAction')}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEnroll(track)}
                        disabled={enrollingId === track.id}
                      >
                        {enrollingId === track.id && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                        )}
                        {t('skillTracks.enrollAction')}
                      </Button>
                    )}
                  </div>
                </div>
                {enrolled && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" />
                    {t('skillTracks.enrolledBadge')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
