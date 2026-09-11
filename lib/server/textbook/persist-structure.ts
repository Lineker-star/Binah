/**
 * Persist a precomputed book plan (lib/textbook/book-plan.ts) as real rows
 * on `book_modules`/`book_chapters`, alongside the existing
 * `textbook_ingestions.chapters` JSON the Chapter Review screen still reads.
 *
 * Takes the plan as an argument rather than computing it itself so the
 * caller can derive the ingestion JSON's plannedLessonCount/moduleNumber
 * fields from the exact same computation -- one source of truth, not two
 * independent calls that could drift.
 *
 * Best-effort: a failure here is logged and swallowed by the caller rather
 * than failing the ingestion request, since nothing user-visible depends on
 * these tables yet (see app/api/textbook/ingest/route.ts).
 */
import type { DetectedChapter } from '@/lib/pdf/textbook-outline';
import type { BookPlan } from '@/lib/textbook/book-plan';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>;

export async function persistBookStructure(
  admin: ServiceRoleClient,
  ingestionId: string,
  chapters: readonly DetectedChapter[],
  plan: BookPlan,
): Promise<void> {
  if (chapters.length === 0) return;

  // Every detected section (chapter, front matter, back matter alike) gets
  // a stable sequential number -- book_chapters.chapter_number is required
  // on every row, including front/back matter.
  const numbered = chapters.map((c, i) => ({ ...c, chapterNumber: i + 1 }));

  const moduleIdByModuleNumber = new Map<number, string>();

  if (plan.hasModules && plan.modules.length > 0) {
    const moduleRows = plan.modules.map((module) => {
      const first = numbered[module.chapters[0].chapterNumber - 1];
      const last = numbered[module.chapters[module.chapters.length - 1].chapterNumber - 1];
      return {
        ingestion_id: ingestionId,
        title: `Module ${module.moduleNumber}`,
        module_number: module.moduleNumber,
        page_start: first.startPage,
        page_end: last.endPage,
      };
    });

    const { data: insertedModules, error: moduleError } = await admin
      .from('book_modules')
      .insert(moduleRows)
      .select('id, module_number');
    if (moduleError) throw moduleError;

    for (const row of insertedModules ?? []) {
      moduleIdByModuleNumber.set(row.module_number as number, row.id as string);
    }
  }

  const chapterPlanByNumber = new Map(plan.chapters.map((c) => [c.chapterNumber, c]));

  const chapterRows = numbered.map((c) => {
    const chapterPlan = chapterPlanByNumber.get(c.chapterNumber);
    return {
      ingestion_id: ingestionId,
      module_id:
        chapterPlan?.moduleNumber != null
          ? (moduleIdByModuleNumber.get(chapterPlan.moduleNumber) ?? null)
          : null,
      title: c.title,
      chapter_number: c.chapterNumber,
      page_start: c.startPage,
      page_end: c.endPage,
      planned_lesson_count: chapterPlan?.plannedLessonCount ?? null,
      is_front_or_back_matter: c.kind !== 'chapter',
      detection_source: c.detectionMethod,
    };
  });

  const { error: chapterError } = await admin.from('book_chapters').insert(chapterRows);
  if (chapterError) throw chapterError;
}
