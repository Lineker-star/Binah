import { createClient } from './client';

/**
 * Whether a book chapter is now fully complete (every one of its planned
 * lessons has a `learning_sessions` row with status 'completed'), and if so
 * the chapter to present a Continuous Assessment for.
 *
 * `sourceIngestionId`/`sourceChapterIndex` are the same pair every
 * chapter-sourced lesson session already carries (see
 * lib/courses/lessons.ts#buildChapterLessonSessionState); `chapter_number`
 * on `book_chapters` is 1-based, `sourceChapterIndex` is 0-based, so
 * number = index + 1 (same conversion app/api/assessments/route.ts already
 * uses for the chapter_id FK).
 *
 * Returns null when the chapter isn't found, has no planned lesson count
 * (an ingestion written before Q.1/Q.2), or isn't fully complete yet.
 */
export async function checkChapterCompletion(
  sourceIngestionId: string,
  sourceChapterIndex: number,
): Promise<{ chapterId: string; chapterTitle: string } | null> {
  const supabase = createClient();
  const chapterNumber = sourceChapterIndex + 1;

  const { data: chapter, error: chapterError } = await supabase
    .from('book_chapters')
    .select('id, title, planned_lesson_count')
    .eq('ingestion_id', sourceIngestionId)
    .eq('chapter_number', chapterNumber)
    .maybeSingle();
  if (chapterError) throw chapterError;
  if (!chapter || chapter.planned_lesson_count == null) return null;

  const { data: sessions, error: sessionsError } = await supabase
    .from('learning_sessions')
    .select('status')
    .eq('source_ingestion_id', sourceIngestionId)
    .eq('source_chapter_index', sourceChapterIndex);
  if (sessionsError) throw sessionsError;

  const completedCount = (sessions ?? []).filter((s) => s.status === 'completed').length;
  if (completedCount < (chapter.planned_lesson_count as number)) return null;

  return { chapterId: chapter.id as string, chapterTitle: chapter.title as string };
}
