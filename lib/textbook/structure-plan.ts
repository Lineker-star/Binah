/**
 * Textbook course structuring: how many lessons a chapter becomes, and
 * whether a book needs a module layer above its chapters.
 *
 * The lesson formula was confirmed with the user after the naive
 * `ceil(page_count / 10)` reading of the spec was checked against its own
 * worked examples and found to diverge (21 pages -> 3 lessons instead of
 * the stated 2; 54 pages -> 6 instead of the stated 5). `round`, clamped to
 * a minimum of 2 lessons once a chapter exceeds the single-lesson
 * threshold, reproduces every worked example exactly with no discrepancy.
 */

/** A chapter at or under this many pages is a single lesson; splitting
 *  starts strictly above it. */
const SINGLE_LESSON_PAGE_LIMIT = 10;

/** Divisor: a chapter is scored at roughly this many pages per lesson. */
const PAGES_PER_LESSON = 10;

/**
 * How many lessons a chapter of `pageCount` pages should split into.
 *
 * <=10 pages: 1 lesson. Above that: round(pageCount / 10), clamped to a
 * minimum of 2 so an 11-page chapter (just over the threshold) never
 * rounds back down to a single lesson.
 */
export function lessonsForChapter(pageCount: number): number {
  if (pageCount <= SINGLE_LESSON_PAGE_LIMIT) return 1;
  return Math.max(2, Math.round(pageCount / PAGES_PER_LESSON));
}

/**
 * A book at or under this many total pages is one course made of chapters
 * made of lessons directly -- no module layer. Above it, the book is
 * structured into modules first, each targeting ~200+ pages and containing
 * multiple chapters as they appear in the book.
 *
 * The original spec left the 150-200 page band ambiguous (a separate
 * <=150 "no modules" rule and a >200 "modules" rule, with a gap between
 * them). Confirmed with the user: that band resolves to "no module
 * layer," so the effective boundary is this single cutoff at 200 rather
 * than two separate 150/200 thresholds.
 */
const MODULE_LAYER_PAGE_THRESHOLD = 200;

export function needsModuleLayer(totalPageCount: number): boolean {
  return totalPageCount > MODULE_LAYER_PAGE_THRESHOLD;
}
