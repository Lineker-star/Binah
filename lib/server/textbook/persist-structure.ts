/**
 * Persist the Q.1 structuring plan (lib/textbook/structure-plan.ts) as real
 * rows on `book_modules`/`book_chapters`, alongside the existing
 * `textbook_ingestions.chapters` JSON the Chapter Review screen still reads.
 *
 * Best-effort: a failure here is logged and swallowed by the caller rather
 * than failing the ingestion request, since nothing user-visible depends on
 * these tables yet (see app/api/textbook/ingest/route.ts).
 */
import type { DetectedChapter } from '@/lib/pdf/textbook-outline';
import {
  lessonsForChapter,
  needsModuleLayer,
  groupChaptersIntoModules,
  type TextbookChapterRef,
} from '@/lib/textbook/structure-plan';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>;

export async function persistBookStructure(
  admin: ServiceRoleClient,
  ingestionId: string,
  totalPages: number,
  chapters: readonly DetectedChapter[],
): Promise<void> {
  if (chapters.length === 0) return;

  // Every detected section (chapter, front matter, back matter alike) gets
  // a stable sequential number -- book_chapters.chapter_number is required
  // on every row, including front/back matter.
  const numbered = chapters.map((c, i) => ({ ...c, chapterNumber: i + 1 }));
  const numberedByChapterNumber = new Map(numbered.map((c) => [c.chapterNumber, c]));

  const moduleIdByChapterNumber = new Map<number, string>();

  if (needsModuleLayer(totalPages)) {
    const refs: TextbookChapterRef[] = numbered.map((c) => ({
      chapterNumber: c.chapterNumber,
      pageCount: c.endPage - c.startPage + 1,
    }));
    const groups = groupChaptersIntoModules(refs);

    const moduleRows = groups.map((group) => {
      const first = numberedByChapterNumber.get(group.chapters[0].chapterNumber)!;
      const last = numberedByChapterNumber.get(
        group.chapters[group.chapters.length - 1].chapterNumber,
      )!;
      return {
        ingestion_id: ingestionId,
        title: `Module ${group.moduleNumber}`,
        module_number: group.moduleNumber,
        page_start: first.startPage,
        page_end: last.endPage,
      };
    });

    const { data: insertedModules, error: moduleError } = await admin
      .from('book_modules')
      .insert(moduleRows)
      .select('id, module_number');
    if (moduleError) throw moduleError;

    const moduleIdByNumber = new Map(
      (insertedModules ?? []).map((m) => [m.module_number as number, m.id as string]),
    );
    for (const group of groups) {
      const moduleId = moduleIdByNumber.get(group.moduleNumber);
      if (!moduleId) continue;
      for (const ref of group.chapters) {
        moduleIdByChapterNumber.set(ref.chapterNumber, moduleId);
      }
    }
  }

  const chapterRows = numbered.map((c) => ({
    ingestion_id: ingestionId,
    module_id: moduleIdByChapterNumber.get(c.chapterNumber) ?? null,
    title: c.title,
    chapter_number: c.chapterNumber,
    page_start: c.startPage,
    page_end: c.endPage,
    // Front/back matter is never turned into a lesson (see IngestedChapter
    // .includeAsLesson defaulting to `kind === 'chapter'`), so it gets no
    // planned lesson count at all rather than running the formula on pages
    // that were never meant to become lessons.
    planned_lesson_count:
      c.kind === 'chapter' ? lessonsForChapter(c.endPage - c.startPage + 1) : null,
    is_front_or_back_matter: c.kind !== 'chapter',
    detection_source: c.detectionMethod,
  }));

  const { error: chapterError } = await admin.from('book_chapters').insert(chapterRows);
  if (chapterError) throw chapterError;
}
