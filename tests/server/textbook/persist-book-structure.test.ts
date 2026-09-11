import { describe, it, expect } from 'vitest';
import { persistBookStructure } from '@/lib/server/textbook/persist-structure';
import type { DetectedChapter } from '@/lib/pdf/textbook-outline';

/** A minimal fake Supabase client recording every insert, supporting both
 *  `await admin.from(t).insert(rows)` and
 *  `await admin.from(t).insert(rows).select(cols)`. */
function createFakeAdmin() {
  const inserted: Record<'book_modules' | 'book_chapters', unknown[]> = {
    book_modules: [],
    book_chapters: [],
  };
  let moduleIdCounter = 0;

  const admin = {
    from(table: 'book_modules' | 'book_chapters') {
      return {
        insert(rows: Array<Record<string, unknown>>) {
          inserted[table].push(...rows);
          return {
            then(resolve: (v: { error: null }) => void) {
              resolve({ error: null });
            },
            select() {
              if (table !== 'book_modules') return Promise.resolve({ data: null, error: null });
              const data = rows.map((r) => ({
                id: `mod-${++moduleIdCounter}`,
                module_number: r.module_number,
              }));
              return Promise.resolve({ data, error: null });
            },
          };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { admin, inserted };
}

function detected(
  title: string,
  startPage: number,
  endPage: number,
  kind: DetectedChapter['kind'] = 'chapter',
): DetectedChapter {
  return { title, startPage, endPage, detectionMethod: 'native_outline', kind };
}

describe('persistBookStructure', () => {
  it('inserts book_chapters with no module layer for a small book', async () => {
    const { admin, inserted } = createFakeAdmin();
    const chapters: DetectedChapter[] = [
      detected('Preface', 1, 2, 'front_matter'),
      detected('Chapter 1', 3, 15), // 13 pages
      detected('Chapter 2', 16, 30), // 15 pages
      detected('Index', 31, 32, 'back_matter'),
    ];

    await persistBookStructure(admin, 'ing-1', 32, chapters);

    expect(inserted.book_modules).toHaveLength(0);
    expect(inserted.book_chapters).toHaveLength(4);

    const rows = inserted.book_chapters as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.chapter_number)).toEqual([1, 2, 3, 4]);
    expect(rows.every((r) => r.module_id === null)).toBe(true);
    expect(rows[0]).toMatchObject({ is_front_or_back_matter: true, planned_lesson_count: null });
    expect(rows[3]).toMatchObject({ is_front_or_back_matter: true, planned_lesson_count: null });
    // 13 pages -> max(2, round(1.3)) = 2; 15 pages -> max(2, round(1.5)) = 2.
    expect(rows[1]).toMatchObject({
      is_front_or_back_matter: false,
      planned_lesson_count: 2,
      page_start: 3,
      page_end: 15,
    });
    expect(rows[2]).toMatchObject({ is_front_or_back_matter: false, planned_lesson_count: 2 });
  });

  it('inserts book_modules first and links book_chapters.module_id for a large book', async () => {
    const { admin, inserted } = createFakeAdmin();
    // 100 + 50 + 300 + 60 = 510 total pages -> needs modules.
    // Greedy grouping: [ch1,ch2,ch3] reach 450 (>=200), ch4 alone is 60.
    const chapters: DetectedChapter[] = [
      detected('Chapter 1', 1, 100),
      detected('Chapter 2', 101, 150),
      detected('Chapter 3', 151, 450),
      detected('Chapter 4', 451, 510),
    ];

    await persistBookStructure(admin, 'ing-2', 510, chapters);

    expect(inserted.book_modules).toHaveLength(2);
    const moduleRows = inserted.book_modules as Array<Record<string, unknown>>;
    expect(moduleRows[0]).toMatchObject({ module_number: 1, page_start: 1, page_end: 450 });
    expect(moduleRows[1]).toMatchObject({ module_number: 2, page_start: 451, page_end: 510 });

    const chapterRows = inserted.book_chapters as Array<Record<string, unknown>>;
    expect(chapterRows).toHaveLength(4);
    // Chapters 1-3 share module 1's id; chapter 4 gets module 2's id.
    expect(chapterRows[0].module_id).toBe(chapterRows[1].module_id);
    expect(chapterRows[1].module_id).toBe(chapterRows[2].module_id);
    expect(chapterRows[3].module_id).not.toBe(chapterRows[0].module_id);
    expect(chapterRows[3].module_id).not.toBeNull();

    // 100 -> 10, 50 -> 5, 300 -> 30, 60 -> 6.
    expect(chapterRows.map((r) => r.planned_lesson_count)).toEqual([10, 5, 30, 6]);
  });

  it('is a no-op for an empty chapter list', async () => {
    const { admin, inserted } = createFakeAdmin();
    await persistBookStructure(admin, 'ing-3', 0, []);
    expect(inserted.book_modules).toHaveLength(0);
    expect(inserted.book_chapters).toHaveLength(0);
  });
});
