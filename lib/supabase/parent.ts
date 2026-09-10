import { createClient } from './client';
import type { LearningSession } from './learning-session';
import type { LearningMetrics } from './learning-metrics';
import type { Course } from './courses';

/** One of a linked child's courses, with the same progress shape as the
 *  learner's own History view ("X of Y lessons complete"). */
export interface ChildCourseProgress {
  course: Course;
  completedLessons: number;
  totalLessons: number;
}

/** One linked child, for the parent dashboard — profile + metrics + recent sessions + courses. */
export interface LinkedChild {
  id: string;
  display_name: string | null;
  metrics: LearningMetrics | null;
  recentSessions: LearningSession[];
  courses: ChildCourseProgress[];
}

const RECENT_SESSIONS_PER_CHILD = 5;

/**
 * The signed-in parent's linked children, each with their metrics and a
 * handful of recent sessions — read-only, for the parent dashboard.
 * `sessions_parent_read` / `metrics_parent_read` / `profiles_parent_read`
 * all gate on the same `parent_child_links` row, so once a link exists this
 * just reads through it; no write path is offered anywhere in this module.
 */
export async function fetchLinkedChildren(): Promise<LinkedChild[]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: links, error: linksError } = await supabase
    .from('parent_child_links')
    .select('child_id')
    .eq('parent_id', user.id);
  if (linksError) throw linksError;

  const childIds = (links ?? []).map((l) => l.child_id as string);
  if (childIds.length === 0) return [];

  const [
    { data: profiles, error: profilesError },
    { data: metrics, error: metricsError },
    { data: sessions, error: sessionsError },
    { data: courses, error: coursesError },
    { data: courseSessions, error: courseSessionsError },
  ] = await Promise.all([
    supabase.from('profiles').select('id, display_name').in('id', childIds),
    supabase.from('learning_metrics').select('*').in('learner_id', childIds),
    supabase
      .from('learning_sessions')
      .select('*')
      .in('learner_id', childIds)
      .order('updated_at', { ascending: false }),
    supabase.from('courses').select('*').in('learner_id', childIds).order('updated_at', { ascending: false }),
    // Separate, uncapped query for course-progress counting — the
    // recent-sessions list above is capped to a handful per child, which
    // would undercount a course's completed lessons.
    supabase
      .from('learning_sessions')
      .select('learner_id, course_id, status')
      .in('learner_id', childIds)
      .not('course_id', 'is', null),
  ]);
  if (profilesError) throw profilesError;
  if (metricsError) throw metricsError;
  if (sessionsError) throw sessionsError;
  if (coursesError) throw coursesError;
  if (courseSessionsError) throw courseSessionsError;

  const metricsById = new Map((metrics ?? []).map((m) => [m.learner_id as string, m as LearningMetrics]));
  const sessionsByChild = new Map<string, LearningSession[]>();
  for (const session of (sessions ?? []) as LearningSession[]) {
    const list = sessionsByChild.get(session.learner_id) ?? [];
    if (list.length < RECENT_SESSIONS_PER_CHILD) list.push(session);
    sessionsByChild.set(session.learner_id, list);
  }

  const coursesByChild = new Map<string, Course[]>();
  for (const course of (courses ?? []) as Course[]) {
    const list = coursesByChild.get(course.learner_id) ?? [];
    list.push(course);
    coursesByChild.set(course.learner_id, list);
  }

  const sessionCountsByCourse = new Map<string, { completed: number; total: number }>();
  for (const s of (courseSessions ?? []) as Array<{ course_id: string; status: string }>) {
    const counts = sessionCountsByCourse.get(s.course_id) ?? { completed: 0, total: 0 };
    counts.total += 1;
    if (s.status === 'completed') counts.completed += 1;
    sessionCountsByCourse.set(s.course_id, counts);
  }

  return (profiles ?? []).map((p) => {
    const childCourses = coursesByChild.get(p.id) ?? [];
    return {
      id: p.id,
      display_name: p.display_name,
      metrics: metricsById.get(p.id) ?? null,
      recentSessions: sessionsByChild.get(p.id) ?? [],
      courses: childCourses.map((course) => {
        const counts = sessionCountsByCourse.get(course.id) ?? { completed: 0, total: 0 };
        return {
          course,
          completedLessons: counts.completed,
          totalLessons: course.planned_lesson_count ?? counts.total,
        };
      }),
    };
  });
}
