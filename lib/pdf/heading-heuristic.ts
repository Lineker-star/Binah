/**
 * Cheap, deterministic heading-candidate detection for PDFs with no native
 * outline/bookmarks — step 1 of the two-step fallback (see
 * lib/server/textbook/chapter-fallback.ts for step 2, the LLM cleanup
 * pass). Font size is derived from each text item's transform matrix
 * (pdfjs doesn't expose it as a plain number), which `unpdf`'s own
 * `extractText` convenience wrapper doesn't surface — this drops to the
 * raw `PDFPageProxy.getTextContent()` for that reason.
 */
import { getDocumentProxy } from 'unpdf';
import { createLogger } from '@/lib/logger';

const log = createLogger('HeadingHeuristic');

export interface HeadingCandidate {
  /** 1-based page number. */
  page: number;
  text: string;
  fontSize: number;
}

interface TextItemLike {
  str?: string;
  transform?: number[];
  hasEOL?: boolean;
}

function fontSizeOf(item: TextItemLike): number {
  const t = item.transform;
  if (!t || t.length < 4) return 0;
  return Math.hypot(t[0], t[1]);
}

/**
 * Group a page's text items into lines (pdfjs emits one item per text run,
 * not per line), then flag short lines whose font size clearly stands out
 * from the page's median body-text size as heading candidates.
 */
function candidatesFromPageItems(page: number, items: TextItemLike[]): HeadingCandidate[] {
  const sizes = items.map(fontSizeOf).filter((s) => s > 0);
  if (sizes.length === 0) return [];
  const sorted = [...sizes].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median <= 0) return [];

  const lines: Array<{ text: string; fontSize: number }> = [];
  let current: { text: string; fontSize: number } | null = null;
  for (const item of items) {
    const str = item.str ?? '';
    const size = fontSizeOf(item);
    if (!current) {
      current = { text: str, fontSize: size };
    } else {
      current.text += str;
      current.fontSize = Math.max(current.fontSize, size);
    }
    if (item.hasEOL) {
      lines.push(current);
      current = null;
    }
  }
  if (current && current.text.trim()) lines.push(current);

  const candidates: HeadingCandidate[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (!text || text.length > 120) continue;
    if (line.fontSize >= median * 1.3) {
      candidates.push({ page, text, fontSize: line.fontSize });
    }
  }
  return candidates;
}

/**
 * Scan every page for heading candidates. Only runs when native-outline
 * detection found nothing, so the per-page `getTextContent()` cost (a
 * second pass over the document, beyond the per-page text already
 * extracted for chapter slicing) is confined to that less-common path.
 */
export async function detectHeadingCandidates(pdfBuffer: Buffer): Promise<HeadingCandidate[]> {
  const uint8 = new Uint8Array(pdfBuffer);
  const pdf = await getDocumentProxy(uint8);
  const candidates: HeadingCandidate[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    try {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const items = (content.items as TextItemLike[]).filter((i) => typeof i.str === 'string');
      candidates.push(...candidatesFromPageItems(pageNum, items));
    } catch (err) {
      log.warn(`Failed to scan page ${pageNum} for heading candidates (skipping):`, err);
    }
  }

  return candidates;
}
