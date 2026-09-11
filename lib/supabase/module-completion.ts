import { createClient } from './client';

/**
 * Whether the just-completed chapter was the last one in its module (or,
 * for a book with no module layer, the last chapter in the whole book) to
 * finish all its own planned lessons — the trigger point for an Exam.
 * Mirrors checkChapterCompletion (lib/supabase/chapter-completion.ts) one
 * tier up: same source_ingestion_id/source_chapter_index inputs, same
 * "every chapter in the group has its planned lesson count of completed
 * sessions" comparison, just run over every chapter sharing this chapter's
 * module_id — or, when module_id is null, every real (non-front/back-
 * matter) chapter in the book, since a null module_id there means the book
 * never qualified for a module layer at all (see needsModuleLayer in
 * lib/textbook/structure-plan.ts), not "this chapter is ungrouped."
 *
 * Returns null when the chapter isn't found, isn't fully complete yet, or
 * has no planned_lesson_count (an ingestion written before Q.1/Q.2).
 * `moduleId` on a match is null to signal the no-module-layer case — the
 * caller then scopes the Exam by ingestion/course instead of by module.
 */
export async function checkModuleCompletion(
  sourceIngestionId: string,
  sourceChapterIndex: number,
): Promise<{ moduleId: string | null } | null> {
  const supabase = createClient();
  const chapterNumber = sourceChapterIndex + 1;

  const { data: chapter, error: chapterError } = await supabase
    .from('book_chapters')
    .select('module_id, planned_lesson_count')
    .eq('ingestion_id', sourceIngestionId)
    .eq('chapter_number', chapterNumber)
    .maybeSingle();
  if (chapterError) throw chapterError;
  if (!chapter || chapter.planned_lesson_count == null) return null;

  const moduleId = (chapter.module_id as string | null) ?? null;

  let groupQuery = supabase
    .from('book_chapters')
    .select('chapter_number, planned_lesson_count')
    .eq('ingestion_id', sourceIngestionId)
    .eq('is_front_or_back_matter', false);
  groupQuery = moduleId ? groupQuery.eq('module_id', moduleId) : groupQuery.is('module_id', null);
  const { data: groupChapters, error: groupError } = await groupQuery;
  if (groupError) throw groupError;

  const chapters = (groupChapters ?? []).filter((c) => c.planned_lesson_count != null);
  if (chapters.length === 0) return null;

  const chapterIndices = chapters.map((c) => (c.chapter_number as number) - 1);
  const { data: sessions, error: sessionsError } = await supabase
    .from('learning_sessions')
    .select('source_chapter_index, status')
    .eq('source_ingestion_id', sourceIngestionId)
    .in('source_chapter_index', chapterIndices);
  if (sessionsError) throw sessionsError;

  const completedCounts = new Map<number, number>();
  for (const s of sessions ?? []) {
    if (s.status !== 'completed') continue;
    const idx = s.source_chapter_index as number;
    completedCounts.set(idx, (completedCounts.get(idx) ?? 0) + 1);
  }

  const allComplete = chapters.every((c) => {
    const idx = (c.chapter_number as number) - 1;
    return (completedCounts.get(idx) ?? 0) >= (c.planned_lesson_count as number);
  });

  return allComplete ? { moduleId } : null;
}
