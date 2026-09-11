import { describe, it, expect } from 'vitest';
import { computeBookPlan, type BookPlanChapterInput } from '@/lib/textbook/book-plan';

function ch(kind: BookPlanChapterInput['kind'], startPage: number, endPage: number): BookPlanChapterInput {
  return { kind, startPage, endPage };
}

describe('computeBookPlan', () => {
  it('has no modules for a small book, and skips front/back matter for lesson counts', () => {
    const chapters = [
      ch('front_matter', 1, 2),
      ch('chapter', 3, 15), // 13 pages
      ch('chapter', 16, 30), // 15 pages
      ch('back_matter', 31, 32),
    ];

    const plan = computeBookPlan(32, chapters);

    expect(plan.hasModules).toBe(false);
    expect(plan.modules).toEqual([]);
    expect(plan.chapters).toEqual([
      { chapterNumber: 1, plannedLessonCount: null, moduleNumber: null },
      { chapterNumber: 2, plannedLessonCount: 2, moduleNumber: null },
      { chapterNumber: 3, plannedLessonCount: 2, moduleNumber: null },
      { chapterNumber: 4, plannedLessonCount: null, moduleNumber: null },
    ]);
  });

  it('assigns module numbers for a large book, matching groupChaptersIntoModules', () => {
    const chapters = [
      ch('chapter', 1, 100), // 100
      ch('chapter', 101, 150), // 50
      ch('chapter', 151, 450), // 300
      ch('chapter', 451, 510), // 60
    ];

    const plan = computeBookPlan(510, chapters);

    expect(plan.hasModules).toBe(true);
    expect(plan.modules).toHaveLength(2);
    expect(plan.chapters.map((c) => c.moduleNumber)).toEqual([1, 1, 1, 2]);
    expect(plan.chapters.map((c) => c.plannedLessonCount)).toEqual([10, 5, 30, 6]);
  });
});
