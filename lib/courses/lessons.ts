import { nanoid } from 'nanoid';
import type { GenerationSessionState } from '@/app/generation-preview/types';
import type { Course } from '@/lib/supabase/courses';

/**
 * Compose the requirement text for one lesson of a structured course —
 * scopes the LLM to just this lesson instead of letting it try to cover
 * the whole course's planned lesson count in a single pass.
 *
 * There is no pre-planned per-lesson syllabus (the courses table has no
 * column for one): each lesson is generated from the course's
 * title/description, its position in the sequence, and (from lesson 2
 * onward) the scene titles of the immediately preceding lesson — not from
 * a shared outline of what every lesson should cover. Good enough for a
 * first pass — a richer version would plan lesson topics once upfront
 * (cheap: just titles, not full content) and hand each lesson its own
 * topic here instead of inferring continuity from the prior lesson alone.
 *
 * `priorLessonTitles` threads prior-lesson context through the ONE channel
 * app/api/generate/scene-outlines-stream/route.ts already treats as open
 * free-form instruction text (`requirements.requirement`), rather than
 * reusing `researchContext` (which the route/prompt template already give
 * a distinct meaning: web-search findings) or adding a new field to that
 * route or to @openmaic/generation's buildOutlinePrompt.
 */
export function buildLessonRequirement(
  course: Pick<Course, 'title' | 'description' | 'planned_lesson_count'>,
  lessonNumber: number,
  priorLessonTitles?: string[],
): string {
  const total = course.planned_lesson_count;
  const intro = `Lesson ${lessonNumber} of ${total ?? 'several'} in the course "${course.title}".`;
  const context = course.description ? ` Course context: ${course.description}` : '';
  const continuity =
    priorLessonTitles && priorLessonTitles.length > 0
      ? ` The previous lesson covered: ${priorLessonTitles.join('; ')}. Build on this — introduce new material for this lesson rather than repeating what was already covered.`
      : '';
  return `${intro}${context}${continuity} Keep this lesson focused and appropriately scoped for a single lesson — do not try to cover the entire course's content in this one lesson.`;
}

/**
 * Build the sessionStorage payload for generating one course lesson —
 * mirrors the homepage's ad-hoc generationSession shape (see
 * app/page.tsx's handleGenerate) but minimal, since a lazily-continued
 * lesson (2..N) has no course-materials/web-search form state to carry
 * over, matching how /skill-tracks starts a session.
 */
export function buildLessonSessionState(
  course: Course,
  lessonNumber: number,
  priorLessonTitles?: string[],
): GenerationSessionState {
  return {
    sessionId: nanoid(),
    requirements: { requirement: buildLessonRequirement(course, lessonNumber, priorLessonTitles) },
    pdfText: '',
    pdfImages: [],
    imageStorageIds: [],
    sceneOutlines: null,
    currentStep: 'generating',
    courseId: course.id,
    lessonNumber,
  };
}
