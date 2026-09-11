import { describe, it, expect } from 'vitest';
import {
  lessonsForChapter,
  needsModuleLayer,
  groupChaptersIntoModules,
  type TextbookChapterRef,
} from '@/lib/textbook/structure-plan';

describe('lessonsForChapter', () => {
  it('exactly matches the confirmed worked examples', () => {
    expect(lessonsForChapter(10)).toBe(1);
    expect(lessonsForChapter(11)).toBe(2);
    expect(lessonsForChapter(21)).toBe(2);
    expect(lessonsForChapter(48)).toBe(5);
    expect(lessonsForChapter(49)).toBe(5);
    expect(lessonsForChapter(50)).toBe(5);
    expect(lessonsForChapter(52)).toBe(5);
    expect(lessonsForChapter(54)).toBe(5);
  });

  it('never returns fewer than 1 lesson at or under the single-lesson threshold', () => {
    expect(lessonsForChapter(1)).toBe(1);
    expect(lessonsForChapter(9)).toBe(1);
  });

  it('never returns fewer than 2 lessons once split (round-down boundary)', () => {
    // round(11/10) alone would be 1 -- the clamp is what makes this 2.
    expect(lessonsForChapter(11)).toBe(2);
    expect(lessonsForChapter(14)).toBe(2);
  });
});

describe('needsModuleLayer', () => {
  it('has no module layer at or under the resolved 200-page cutoff', () => {
    expect(needsModuleLayer(1)).toBe(false);
    expect(needsModuleLayer(150)).toBe(false);
    // The originally-ambiguous 150-200 band resolves to "no modules".
    expect(needsModuleLayer(175)).toBe(false);
    expect(needsModuleLayer(200)).toBe(false);
  });

  it('requires a module layer strictly above 200 pages', () => {
    expect(needsModuleLayer(201)).toBe(true);
    expect(needsModuleLayer(400)).toBe(true);
  });
});

function chapter(chapterNumber: number, pageCount: number): TextbookChapterRef {
  return { chapterNumber, pageCount };
}

describe('groupChaptersIntoModules', () => {
  it('divides an evenly-sized book into equal modules', () => {
    // 8 chapters of 50 pages: every 4th chapter crosses the 200 target.
    const chapters = Array.from({ length: 8 }, (_, i) => chapter(i + 1, 50));

    const modules = groupChaptersIntoModules(chapters);

    expect(modules).toHaveLength(2);
    expect(modules[0]).toMatchObject({
      moduleNumber: 1,
      totalPageCount: 200,
    });
    expect(modules[0].chapters.map((c) => c.chapterNumber)).toEqual([1, 2, 3, 4]);
    expect(modules[1]).toMatchObject({
      moduleNumber: 2,
      totalPageCount: 200,
    });
    expect(modules[1].chapters.map((c) => c.chapterNumber)).toEqual([5, 6, 7, 8]);
  });

  it('leaves a legitimately small trailing module instead of re-bucketing', () => {
    // First 4 chapters close a 200-page module; the 5th chapter alone
    // (50 pages) is everything left, and must not pull from chapter 4.
    const chapters = [
      chapter(1, 50),
      chapter(2, 50),
      chapter(3, 50),
      chapter(4, 50),
      chapter(5, 50),
    ];

    const modules = groupChaptersIntoModules(chapters);

    expect(modules).toHaveLength(2);
    expect(modules[0].chapters.map((c) => c.chapterNumber)).toEqual([1, 2, 3, 4]);
    expect(modules[0].totalPageCount).toBe(200);
    expect(modules[1].chapters.map((c) => c.chapterNumber)).toEqual([5]);
    expect(modules[1].totalPageCount).toBe(50);
  });

  it('makes each oversized chapter its own module, never splitting it', () => {
    const chapters = [chapter(1, 250), chapter(2, 300), chapter(3, 220)];

    const modules = groupChaptersIntoModules(chapters);

    expect(modules).toHaveLength(3);
    modules.forEach((module, i) => {
      expect(module.chapters).toHaveLength(1);
      expect(module.chapters[0].chapterNumber).toBe(i + 1);
      expect(module.totalPageCount).toBe(chapters[i].pageCount);
    });
  });

  it('keeps a chapter whole even when it pushes a module well over target', () => {
    // Module 1 accumulates to 150, then a single 300-page chapter joins
    // it (total 450) rather than starting a new module and being split.
    const chapters = [chapter(1, 100), chapter(2, 50), chapter(3, 300), chapter(4, 60)];

    const modules = groupChaptersIntoModules(chapters);

    expect(modules).toHaveLength(2);
    expect(modules[0].chapters.map((c) => c.chapterNumber)).toEqual([1, 2, 3]);
    expect(modules[0].totalPageCount).toBe(450);
    expect(modules[1].chapters.map((c) => c.chapterNumber)).toEqual([4]);
    expect(modules[1].totalPageCount).toBe(60);
  });

  it('returns no modules for an empty chapter list', () => {
    expect(groupChaptersIntoModules([])).toEqual([]);
  });
});
