'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Award,
  Download,
  ExternalLink,
  Loader2,
  Play,
  Trash2,
  Trophy,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { createLogger } from '@/lib/logger';
import {
  listLearnerSessions,
  removeSessionFromHistory,
  resumeSession,
  type LearningSession,
  type SessionStatus,
} from '@/lib/supabase/learning-session';
import { listLearnerCourses, removeCourseFromHistory, type Course } from '@/lib/supabase/courses';
import {
  getCertificateDownloadUrl,
  getCertificateExcellenceDownloadUrl,
} from '@/lib/supabase/certificates';
import {
  getArtifactDownloadUrl,
  listGeneratedArtifacts,
  type GeneratedArtifact,
} from '@/lib/supabase/artifacts';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const log = createLogger('LearningHistory');

type StatusFilter = 'all' | 'inProgress' | 'finished';

const SESSION_BADGE: Record<SessionStatus, { key: string; className: string }> = {
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

const ARTIFACT_TYPE_KEYS: Record<string, string> = {
  pptx: 'history.artifactType.pptx',
  resource_pack: 'history.artifactType.resource_pack',
  classroom_zip: 'history.artifactType.classroom_zip',
  mp4: 'history.artifactType.mp4',
  lecture_notes_pdf: 'history.artifactType.lecture_notes_pdf',
  certificate: 'history.artifactType.certificate',
  certificate_excellence: 'history.artifactType.certificate_excellence',
};

const COURSE_BADGE: Record<Course['status'], { key: string; className: string }> = {
  planning: {
    key: 'history.courseStatusPlanning',
    className: 'bg-muted text-muted-foreground',
  },
  in_progress: {
    key: 'history.courseStatusInProgress',
    className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  completed: {
    key: 'history.courseStatusCompleted',
    className: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  },
};

function isCourseFinished(course: Course): boolean {
  return course.status === 'completed';
}
function isSessionFinished(session: LearningSession): boolean {
  return session.status === 'completed' || session.status === 'abandoned';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleDateString();
  }
}

export default function HistoryPage() {
  const { t, locale } = useI18n();
  const router = useRouter();

  const [loaded, setLoaded] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [sessions, setSessions] = useState<LearningSession[]>([]);
  const [artifacts, setArtifacts] = useState<GeneratedArtifact[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadingCertificateId, setDownloadingCertificateId] = useState<string | null>(null);
  const [downloadingCertificateExcellenceId, setDownloadingCertificateExcellenceId] = useState<
    string | null
  >(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removeCourseTarget, setRemoveCourseTarget] = useState<Course | null>(null);
  const [removeSessionTarget, setRemoveSessionTarget] = useState<LearningSession | null>(null);

  useEffect(() => {
    Promise.all([listLearnerCourses(), listLearnerSessions(), listGeneratedArtifacts()])
      .then(([c, s, a]) => {
        setCourses(c);
        setSessions(s);
        setArtifacts(a);
      })
      .catch((err) => log.error('Failed to load learning history:', err))
      .finally(() => setLoaded(true));
  }, []);

  const handleDownload = async (artifact: GeneratedArtifact) => {
    setDownloadingId(artifact.id);
    try {
      const url = await getArtifactDownloadUrl(artifact.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      log.error('Failed to get artifact download URL:', err);
      toast.error(t('history.downloadFailed'));
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadCertificate = async (course: Course) => {
    setDownloadingCertificateId(course.id);
    try {
      const url = await getCertificateDownloadUrl({ courseId: course.id });
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      log.error('Failed to download certificate:', err);
      toast.error(t('history.downloadFailed'));
    } finally {
      setDownloadingCertificateId(null);
    }
  };

  const handleDownloadCertificateExcellence = async (course: Course) => {
    setDownloadingCertificateExcellenceId(course.id);
    try {
      const result = await getCertificateExcellenceDownloadUrl({ courseId: course.id });
      if (result.status === 'ineligible') {
        toast.info(t('history.certificateIneligible'));
        return;
      }
      if (result.status === 'pending') {
        toast.info(t('history.certificatePending'));
        return;
      }
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      log.error('Failed to download certificate of excellence:', err);
      toast.error(t('history.downloadFailed'));
    } finally {
      setDownloadingCertificateExcellenceId(null);
    }
  };

  const sessionsByCourse = useMemo(() => {
    const map = new Map<string, LearningSession[]>();
    for (const s of sessions) {
      if (!s.course_id) continue;
      const list = map.get(s.course_id) ?? [];
      list.push(s);
      map.set(s.course_id, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.lesson_number ?? 0) - (b.lesson_number ?? 0));
    }
    return map;
  }, [sessions]);

  const standaloneSessions = useMemo(() => sessions.filter((s) => !s.course_id), [sessions]);

  const filteredCourses = useMemo(
    () =>
      courses.filter((c) => {
        if (filter === 'inProgress') return !isCourseFinished(c);
        if (filter === 'finished') return isCourseFinished(c);
        return true;
      }),
    [courses, filter],
  );

  const filteredStandalone = useMemo(
    () =>
      standaloneSessions.filter((s) => {
        if (filter === 'inProgress') return !isSessionFinished(s);
        if (filter === 'finished') return isSessionFinished(s);
        return true;
      }),
    [standaloneSessions, filter],
  );

  const goToSession = (session: LearningSession) => {
    if (!session.stage_id) return;
    router.push(`/classroom/${session.stage_id}`);
  };

  const handleContinue = async (session: LearningSession) => {
    if (!session.stage_id) return;
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
      setBusyId(null);
    }
  };

  const confirmRemoveCourse = async () => {
    if (!removeCourseTarget) return;
    const course = removeCourseTarget;
    setRemoveCourseTarget(null);
    setBusyId(course.id);
    try {
      await removeCourseFromHistory(course.id);
      setCourses((prev) => prev.filter((c) => c.id !== course.id));
      toast.success(t('history.removed'));
    } catch (err) {
      log.error('Failed to remove course from history:', err);
      toast.error(t('history.removeFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const confirmRemoveSession = async () => {
    if (!removeSessionTarget) return;
    const session = removeSessionTarget;
    setRemoveSessionTarget(null);
    setBusyId(session.id);
    try {
      await removeSessionFromHistory(session.id);
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      toast.success(t('history.removed'));
    } catch (err) {
      log.error('Failed to remove session from history:', err);
      toast.error(t('history.removeFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const totalCount = courses.length + standaloneSessions.length;
  const filteredCount = filteredCourses.length + filteredStandalone.length;

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <Link
        href="/app"
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="size-3.5" />
        {t('history.backToHome')}
      </Link>

      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t('history.pageTitle')}</h1>
          <p className="text-[13px] text-muted-foreground mt-1">{t('history.subtitle')}</p>
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
          <TabsList>
            <TabsTrigger value="all">{t('history.filterAll')}</TabsTrigger>
            <TabsTrigger value="inProgress">{t('history.filterInProgress')}</TabsTrigger>
            <TabsTrigger value="finished">{t('history.filterFinished')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {!loaded ? (
        <div className="py-16 text-center text-[13px] text-muted-foreground">
          {t('common.loading')}
        </div>
      ) : totalCount === 0 ? (
        <div className="py-16 text-center text-[13px] text-muted-foreground">
          {t('history.emptyAll')}
        </div>
      ) : filteredCount === 0 ? (
        <div className="py-16 text-center text-[13px] text-muted-foreground/60">
          {t('history.emptyFiltered')}
        </div>
      ) : (
        <div className="flex flex-col gap-10">
          {filteredCourses.length > 0 && (
            <section>
              <h2 className="text-[13px] font-medium text-muted-foreground mb-3">
                {t('history.coursesHeading')}
              </h2>
              <div className="flex flex-col gap-4">
                {filteredCourses.map((course) => {
                  const lessons = sessionsByCourse.get(course.id) ?? [];
                  const total = course.planned_lesson_count ?? lessons.length;
                  const completedCount = lessons.filter((l) => l.status === 'completed').length;
                  const badge = COURSE_BADGE[course.status];
                  return (
                    <div
                      key={course.id}
                      className="rounded-2xl border border-border/60 bg-card/60 p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[14px] font-medium text-foreground truncate">
                            {course.title}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span
                              className={cn(
                                'text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                                badge.className,
                              )}
                            >
                              {t(badge.key)}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {t('history.lessonsProgress', { completed: completedCount, total })}
                            </span>
                          </div>
                        </div>
                        <div className="shrink-0 flex items-center gap-1.5">
                          {course.status === 'completed' && (
                            <button
                              type="button"
                              onClick={() => handleDownloadCertificate(course)}
                              disabled={downloadingCertificateId === course.id}
                              title={t('history.downloadCertificate')}
                              className="inline-flex items-center justify-center size-8 rounded-lg border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              {downloadingCertificateId === course.id ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Award className="size-3.5" />
                              )}
                            </button>
                          )}
                          {course.status === 'completed' && (
                            <button
                              type="button"
                              onClick={() => handleDownloadCertificateExcellence(course)}
                              disabled={downloadingCertificateExcellenceId === course.id}
                              title={t('history.downloadCertificateExcellence')}
                              className="inline-flex items-center justify-center size-8 rounded-lg border border-amber-300/60 dark:border-amber-700/60 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              {downloadingCertificateExcellenceId === course.id ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Trophy className="size-3.5" />
                              )}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setRemoveCourseTarget(course)}
                            disabled={busyId === course.id}
                            title={t('history.removeFromHistory')}
                            className="inline-flex items-center justify-center size-8 rounded-lg border border-border/60 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            {busyId === course.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="size-3.5" />
                            )}
                          </button>
                        </div>
                      </div>

                      {lessons.length > 0 && (
                        <div className="mt-3 flex flex-col gap-1.5">
                          {lessons.map((session) => {
                            const sBadge = SESSION_BADGE[session.status];
                            return (
                              <button
                                key={session.id}
                                type="button"
                                onClick={() => handleContinue(session)}
                                disabled={busyId === session.id || !session.stage_id}
                                className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-muted/50 transition-colors disabled:opacity-50 cursor-pointer"
                              >
                                <span className="flex items-center gap-2 min-w-0">
                                  {busyId === session.id ? (
                                    <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
                                  ) : (
                                    <Play className="size-3 shrink-0 text-muted-foreground" />
                                  )}
                                  <span className="text-[12.5px] text-foreground/85 truncate">
                                    {t('history.lessonLabel', {
                                      number: session.lesson_number ?? '—',
                                    })}
                                    {session.title ? ` — ${session.title}` : ''}
                                  </span>
                                </span>
                                <span
                                  className={cn(
                                    'shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                                    sBadge.className,
                                  )}
                                >
                                  {t(sBadge.key)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {filteredStandalone.length > 0 && (
            <section>
              <h2 className="text-[13px] font-medium text-muted-foreground mb-3">
                {t('history.standaloneHeading')}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {filteredStandalone.map((session) => {
                  const badge = SESSION_BADGE[session.status];
                  return (
                    <div
                      key={session.id}
                      className="group rounded-2xl border border-border/60 bg-card/60 p-4 flex flex-col gap-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[14px] font-medium text-foreground truncate">
                            {session.title}
                          </div>
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
                      <div className="flex items-center gap-1.5 mt-1">
                        <button
                          type="button"
                          onClick={() => handleContinue(session)}
                          disabled={busyId === session.id || !session.stage_id}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-lg bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
                        >
                          {busyId === session.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Play className="size-3" />
                          )}
                          {t('classroom.session.continueLabel')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRemoveSessionTarget(session)}
                          disabled={busyId === session.id}
                          title={t('history.removeFromHistory')}
                          className="inline-flex items-center justify-center size-8 rounded-lg border border-border/60 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}

      {loaded && artifacts.length > 0 && (
        <section className="mt-10">
          <h2 className="text-[13px] font-medium text-muted-foreground mb-3">
            {t('history.downloadsHeading')}
          </h2>
          <div className="flex flex-col gap-2">
            {artifacts.map((artifact) => (
              <div
                key={artifact.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/60 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-[13px] text-foreground/85 truncate">
                    {ARTIFACT_TYPE_KEYS[artifact.artifact_type]
                      ? t(ARTIFACT_TYPE_KEYS[artifact.artifact_type])
                      : artifact.artifact_type}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatDate(artifact.generated_at, locale)}
                    {artifact.file_size_bytes != null &&
                      ` · ${formatFileSize(artifact.file_size_bytes)}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDownload(artifact)}
                  disabled={downloadingId === artifact.id}
                  className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border/60 text-[12px] text-foreground/80 hover:bg-muted/60 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {downloadingId === artifact.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Download className="size-3" />
                  )}
                  {t('history.downloadAction')}
                  <ExternalLink className="size-3 text-muted-foreground" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <AlertDialog
        open={removeCourseTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRemoveCourseTarget(null);
        }}
      >
        <AlertDialogContent className="sm:max-w-[400px]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('history.removeCourseConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('history.removeCourseConfirmDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemoveCourse}>
              {t('history.removeFromHistory')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={removeSessionTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRemoveSessionTarget(null);
        }}
      >
        <AlertDialogContent className="sm:max-w-[400px]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('history.removeSessionConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('history.removeSessionConfirmDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemoveSession}>
              {t('history.removeFromHistory')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
