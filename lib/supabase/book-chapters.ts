import { createClient } from './client';

/**
 * Maps a book's chapter_number (1-based) to its book_chapters.id, for
 * surfaces that need the real row id from the ingestion's lighter JSON
 * mirror — e.g. a chapter-level export needs book_chapters.id to scope
 * generated_artifacts.chapter_id (see lib/export/lesson-chapter-export.ts).
 */
export async function listBookChapterIds(ingestionId: string): Promise<Map<number, string>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('book_chapters')
    .select('id, chapter_number')
    .eq('ingestion_id', ingestionId);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.chapter_number as number, row.id as string]));
}
