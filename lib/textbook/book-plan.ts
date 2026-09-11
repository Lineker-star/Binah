/**
 * Orchestrates the pure structure-plan.ts primitives over a full detected
 * chapter list, once, so every consumer (the DB persistence layer and the
 * ingestion JSON the Chapter Review screen reads) derives the identical
 * chapter numbering, lesson counts, and module assignment -- never
 * recomputed independently, which would risk the two drifting apart.
 */
import type { ChapterKind } from './types';
import {
  lessonsForChapter,
  needsModuleLayer,
  groupChaptersIntoModules,
  type TextbookModule,
} from './structure-plan';

export interface BookPlanChapterInput {
  kind: ChapterKind;
  startPage: number;
  endPage: number;
}

export interface ChapterPlan {
  chapterNumber: number;
  /** null for front/back matter -- the lesson formula never runs on it. */
  plannedLessonCount: number | null;
  /** null when the book has no module layer. */
  moduleNumber: number | null;
}

export interface BookPlan {
  hasModules: boolean;
  /** Empty when `hasModules` is false. */
  modules: TextbookModule[];
  /** Same order and length as the input chapters. */
  chapters: ChapterPlan[];
}

export function computeBookPlan(
  totalPageCount: number,
  chapters: readonly BookPlanChapterInput[],
): BookPlan {
  const numbered = chapters.map((c, i) => ({ ...c, chapterNumber: i + 1 }));
  const hasModules = needsModuleLayer(totalPageCount);

  let modules: TextbookModule[] = [];
  const moduleNumberByChapterNumber = new Map<number, number>();

  if (hasModules) {
    const refs = numbered.map((c) => ({
      chapterNumber: c.chapterNumber,
      pageCount: c.endPage - c.startPage + 1,
    }));
    modules = groupChaptersIntoModules(refs);
    for (const module of modules) {
      for (const ref of module.chapters) {
        moduleNumberByChapterNumber.set(ref.chapterNumber, module.moduleNumber);
      }
    }
  }

  const chapterPlans: ChapterPlan[] = numbered.map((c) => ({
    chapterNumber: c.chapterNumber,
    plannedLessonCount:
      c.kind === 'chapter' ? lessonsForChapter(c.endPage - c.startPage + 1) : null,
    moduleNumber: hasModules ? (moduleNumberByChapterNumber.get(c.chapterNumber) ?? null) : null,
  }));

  return { hasModules, modules, chapters: chapterPlans };
}
