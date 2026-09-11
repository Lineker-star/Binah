import { describe, it, expect } from 'vitest';
import { lessonsForChapter, needsModuleLayer } from '@/lib/textbook/structure-plan';

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
