/**
 * One-page course-completion certificate. Built with `pdf-lib` — same
 * tool and pattern as the lecture-notes export (see
 * lib/artifacts/lecture-notes-pdf.ts) — rather than a new dependency.
 * Landscape, the conventional certificate orientation. Styling reuses
 * Binah's own brand config (product name + theme color) instead of
 * inventing a new palette.
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { DEFAULT_BRAND } from '@/lib/brand/brand-config';

const PAGE_WIDTH = 792; // US Letter, landscape, points
const PAGE_HEIGHT = 612;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16) / 255,
    g: parseInt(clean.slice(2, 4), 16) / 255,
    b: parseInt(clean.slice(4, 6), 16) / 255,
  };
}

function centeredText(
  page: PDFPage,
  text: string,
  y: number,
  size: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (PAGE_WIDTH - width) / 2, y, size, font, color });
}

/** Greedy word-wrap — pdf-lib has no built-in text flow. */
function wrapText(text: string, maxWidth: number, size: number, font: PDFFont): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function buildCertificatePdf(params: {
  learnerName: string;
  courseTitle: string;
  completionDate: Date;
  /** Letter grade and overall score (0-100), from the course's final
   *  assessment — undefined/null renders the certificate without a
   *  grade line (e.g. score data not ready yet is never sent through). */
  grade?: string | null;
  overallScorePct?: number | null;
  /** LLM-synthesized skills list; empty/absent omits the section. */
  skillsAcquired?: string[] | null;
  /** Unique verification code (see lib/artifacts/serial-code.ts). */
  serialCode?: string | null;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const brandColorRgb = hexToRgb(DEFAULT_BRAND.themeColor);
  const brand = rgb(brandColorRgb.r, brandColorRgb.g, brandColorRgb.b);
  const ink = rgb(0.12, 0.12, 0.15);
  const muted = rgb(0.42, 0.42, 0.48);

  // Double border rule in the brand color — the only decorative element,
  // deliberately restrained rather than inventing new ornamentation.
  const outerInset = 28;
  const innerInset = 36;
  page.drawRectangle({
    x: outerInset,
    y: outerInset,
    width: PAGE_WIDTH - outerInset * 2,
    height: PAGE_HEIGHT - outerInset * 2,
    borderColor: brand,
    borderWidth: 1.5,
  });
  page.drawRectangle({
    x: innerInset,
    y: innerInset,
    width: PAGE_WIDTH - innerInset * 2,
    height: PAGE_HEIGHT - innerInset * 2,
    borderColor: brand,
    borderWidth: 0.5,
  });

  centeredText(page, DEFAULT_BRAND.productName.toUpperCase(), PAGE_HEIGHT - 96, 13, bold, brand);

  centeredText(page, 'Certificate of Completion', PAGE_HEIGHT - 168, 28, bold, ink);

  centeredText(page, 'This certifies that', PAGE_HEIGHT - 226, 12, font, muted);

  const nameSize = 30;
  centeredText(page, params.learnerName, PAGE_HEIGHT - 272, nameSize, bold, ink);

  // Short rule beneath the name — a conventional certificate flourish.
  const nameWidth = bold.widthOfTextAtSize(params.learnerName, nameSize);
  const ruleWidth = Math.max(220, nameWidth + 40);
  page.drawLine({
    start: { x: (PAGE_WIDTH - ruleWidth) / 2, y: PAGE_HEIGHT - 288 },
    end: { x: (PAGE_WIDTH + ruleWidth) / 2, y: PAGE_HEIGHT - 288 },
    thickness: 0.75,
    color: brand,
  });

  centeredText(page, 'has successfully completed the course', PAGE_HEIGHT - 322, 12, font, muted);
  centeredText(page, params.courseTitle, PAGE_HEIGHT - 352, 18, bold, ink);

  let cursorY = PAGE_HEIGHT - 392;

  if (params.grade || params.overallScorePct != null) {
    const gradeParts: string[] = [];
    if (params.grade) gradeParts.push(`Grade: ${params.grade}`);
    if (params.overallScorePct != null) {
      gradeParts.push(`Overall Score: ${Math.round(params.overallScorePct)}%`);
    }
    centeredText(page, gradeParts.join('   ·   '), cursorY, 13, bold, brand);
    cursorY -= 30;
  }

  if (params.skillsAcquired && params.skillsAcquired.length > 0) {
    centeredText(page, 'SKILLS ACQUIRED', cursorY, 9, bold, muted);
    cursorY -= 16;
    const maxTextWidth = PAGE_WIDTH - innerInset * 2 - 80;
    const lines = wrapText(params.skillsAcquired.join('   ·   '), maxTextWidth, 11, font).slice(
      0,
      3,
    );
    for (const line of lines) {
      centeredText(page, line, cursorY, 11, font, ink);
      cursorY -= 16;
    }
  }

  if (params.serialCode) {
    centeredText(page, `Certificate No. ${params.serialCode}`, outerInset + 64, 9, font, muted);
  }

  const dateText = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
  }).format(params.completionDate);
  centeredText(page, dateText, outerInset + 48, 11, font, muted);

  return doc.save();
}
