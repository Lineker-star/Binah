/**
 * Native-PDF-bookmark chapter detection + per-page text extraction.
 *
 * Uses unpdf's underlying pdfjs `PDFDocumentProxy` directly (not unpdf's
 * `extractText({ mergePages: true })` convenience path used elsewhere in
 * this app) for two reasons: `.getOutline()` — the PDF's own bookmark tree
 * — is only reachable on the raw document proxy, and per-PAGE text (not one
 * merged blob) is what lets a chapter's text be sliced by page range
 * without re-parsing the document per chapter.
 */
import { getDocumentProxy, extractText } from 'unpdf';
import { createLogger } from '@/lib/logger';

const log = createLogger('TextbookOutline');

export type ChapterKind = 'chapter' | 'front_matter' | 'back_matter';
export type ChapterDetectionMethod = 'native_outline' | 'ai_fallback';

export interface DetectedChapter {
  title: string;
  /** 1-based, inclusive page range. */
  startPage: number;
  endPage: number;
  detectionMethod: ChapterDetectionMethod;
  kind: ChapterKind;
}

export interface TextbookOutlineResult {
  totalPages: number;
  /** Empty when the PDF has no native outline/bookmarks at all. */
  chapters: DetectedChapter[];
  /** One entry per page (index 0 = page 1), always populated. */
  pageTexts: string[];
}

const FRONT_MATTER_RE =
  /^(preface|foreword|acknowledg|about the author|contents|table of contents|copyright|dedication|introduction to the (author|edition))/i;
const BACK_MATTER_RE =
  /^(glossary|index|appendix|bibliography|references|further reading|answer key|solutions?)/i;

export function classifyChapterKind(title: string): ChapterKind {
  const t = title.trim();
  if (FRONT_MATTER_RE.test(t)) return 'front_matter';
  if (BACK_MATTER_RE.test(t)) return 'back_matter';
  return 'chapter';
}

interface RawOutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items: RawOutlineNode[];
}

/** Resolve one outline node's `dest` to a 0-based page index, or null if unresolvable. */
async function resolveDestToPageIndex(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
  dest: RawOutlineNode['dest'],
): Promise<number | null> {
  if (!dest) return null;
  try {
    const explicitDest = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
    if (!explicitDest || !Array.isArray(explicitDest) || explicitDest.length === 0) return null;
    const ref = explicitDest[0];
    if (ref == null) return null;
    return await pdf.getPageIndex(ref as never);
  } catch (err) {
    log.warn('Failed to resolve outline destination (skipping entry):', err);
    return null;
  }
}

/**
 * Flatten the PDF's top-level outline (bookmark) entries into ordered
 * chapters with resolved page ranges. Only top-level entries become
 * chapters — nested sub-headings aren't split out further, matching the
 * chapter-to-lesson granularity the rest of this feature works at.
 */
async function resolveOutlineToChapters(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
  rawOutline: RawOutlineNode[],
  totalPages: number,
): Promise<DetectedChapter[]> {
  const resolved: Array<{ title: string; pageIndex: number }> = [];
  for (const node of rawOutline) {
    const pageIndex = await resolveDestToPageIndex(pdf, node.dest);
    const title = node.title?.trim();
    if (pageIndex != null && title) {
      resolved.push({ title, pageIndex });
    }
  }
  // Bookmarks are almost always already in reading order; sort defensively
  // in case a PDF's outline entries don't match page order.
  resolved.sort((a, b) => a.pageIndex - b.pageIndex);

  const chapters: DetectedChapter[] = [];
  for (let i = 0; i < resolved.length; i++) {
    const startPage = resolved[i].pageIndex + 1;
    const nextStart = i + 1 < resolved.length ? resolved[i + 1].pageIndex + 1 : totalPages + 1;
    const endPage = Math.max(startPage, nextStart - 1);
    chapters.push({
      title: resolved[i].title,
      startPage,
      endPage,
      detectionMethod: 'native_outline',
      kind: classifyChapterKind(resolved[i].title),
    });
  }
  return chapters;
}

/**
 * Extract a PDF's native outline (chapters, if it has bookmarks) and every
 * page's text in one document parse. `chapters` is empty when the PDF has
 * no usable outline — callers fall back to heuristic detection (see
 * `lib/pdf/heading-heuristic.ts`) using the same `pageTexts`.
 */
export async function extractTextbookOutline(pdfBuffer: Buffer): Promise<TextbookOutlineResult> {
  const uint8 = new Uint8Array(pdfBuffer);
  const pdf = await getDocumentProxy(uint8);
  const totalPages = pdf.numPages;

  const { text: pageTexts } = await extractText(pdf, { mergePages: false });

  let chapters: DetectedChapter[] = [];
  try {
    const rawOutline = (await pdf.getOutline()) as RawOutlineNode[] | null;
    if (rawOutline && rawOutline.length > 0) {
      chapters = await resolveOutlineToChapters(pdf, rawOutline, totalPages);
    }
  } catch (err) {
    log.warn('Failed to read PDF outline (falling back to heuristic detection):', err);
  }

  return { totalPages, chapters, pageTexts };
}

/** Slice + join a chapter's own text from the full per-page array. */
export function extractChapterText(pageTexts: string[], startPage: number, endPage: number): string {
  return pageTexts.slice(startPage - 1, endPage).join('\n\n').trim();
}
