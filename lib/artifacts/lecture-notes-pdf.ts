/**
 * Minimal PDF layout for a lecture-notes summary: title, overview
 * paragraph, and a bulleted key-points list. Built with `pdf-lib` (already
 * a dependency, used elsewhere only to trim fetched PDFs) rather than
 * pulling in a new HTML-to-PDF or React-PDF dependency for what is a
 * short, plain-text document.
 */
import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 56;
const MAX_WIDTH = PAGE_WIDTH - MARGIN * 2;

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

export async function buildLectureNotesPdf(params: {
  title: string;
  overview: string;
  keyPoints: string[];
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };

  const drawWrapped = (text: string, size: number, useFont: PDFFont, gapAfter: number, indent = 0) => {
    const lines = wrapText(text, useFont, size, MAX_WIDTH - indent);
    for (const line of lines) {
      ensureSpace(size + 4);
      page.drawText(line, {
        x: MARGIN + indent,
        y,
        size,
        font: useFont,
        color: rgb(0.15, 0.15, 0.15),
      });
      y -= size + 4;
    }
    y -= gapAfter;
  };

  drawWrapped(params.title, 20, boldFont, 16);
  if (params.overview) {
    drawWrapped('Overview', 13, boldFont, 4);
    drawWrapped(params.overview, 11, font, 16);
  }
  if (params.keyPoints.length > 0) {
    drawWrapped('Key Points', 13, boldFont, 6);
    for (const point of params.keyPoints) {
      drawWrapped(`•  ${point}`, 11, font, 8, 10);
    }
  }

  return doc.save();
}
