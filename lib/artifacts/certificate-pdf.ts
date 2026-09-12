/**
 * One-page course-completion certificate. Built with `pdf-lib` — same
 * tool and pattern as the lecture-notes export (see
 * lib/artifacts/lecture-notes-pdf.ts) — rather than a new dependency.
 * Landscape, the conventional certificate orientation. Styling reuses
 * Binah's own brand config (product name, mark, theme color) instead of
 * inventing a new palette.
 */
import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { DEFAULT_BRAND } from '@/lib/brand/brand-config';
import { createLogger } from '@/lib/logger';

const log = createLogger('CertificatePdf');

const PAGE_WIDTH = 792; // US Letter, landscape, points
const PAGE_HEIGHT = 612;
const BRAND_MARK_PX = 64; // downsized source resolution -- crisp at the small size it's drawn, without embedding the full multi-hundred-KB public/ asset

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

/**
 * The brand mark, downsized and re-encoded before embedding — the source
 * file under public/ is sized for a favicon/header (hundreds of KB),
 * which would otherwise bloat every certificate far beyond its own
 * content. Best-effort: a missing file or a sharp failure just omits the
 * mark rather than failing certificate generation, since the product
 * name text caption next to it already carries the branding.
 */
async function loadBrandMarkPng(): Promise<Buffer | null> {
  try {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const sharp = (await import('sharp')).default;
    const markPath = path.join(process.cwd(), 'public', DEFAULT_BRAND.markSrc.replace(/^\//, ''));
    const source = await readFile(markPath);
    return await sharp(source)
      .resize({ width: BRAND_MARK_PX, height: BRAND_MARK_PX, fit: 'inside' })
      .png()
      .toBuffer();
  } catch (err) {
    log.warn('Failed to load/resize brand mark for certificate (omitted):', err);
    return null;
  }
}

export async function buildCertificatePdf(params: {
  learnerName: string;
  courseTitle: string;
  completionDate: Date;
  /** Defaults to "Certificate of Completion" (the plain, thresholdless
   *  certificate) — the richer Certificate of Excellence passes its own
   *  heading so the two are visually distinct on the page itself, not
   *  just in the underlying data. */
  heading?: string;
  /** Letter grade and overall score (0-100), from the course's final
   *  assessment — undefined/null renders the certificate without a
   *  grade line (e.g. score data not ready yet is never sent through). */
  grade?: string | null;
  overallScorePct?: number | null;
  /** LLM-synthesized skills list; empty/absent omits the section. */
  skillsAcquired?: string[] | null;
  /** Unique verification code (see lib/artifacts/serial-code.ts) — the
   *  same code the /verify/[serialCode] page looks up. Rendered as a
   *  prominent, boxed, monospaced block since this is what a viewer
   *  would actually type in, not fine print. */
  serialCode?: string | null;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.CourierBold);

  const brandColorRgb = hexToRgb(DEFAULT_BRAND.themeColor);
  const brand = rgb(brandColorRgb.r, brandColorRgb.g, brandColorRgb.b);
  const ink = rgb(0.12, 0.12, 0.15);
  const muted = rgb(0.42, 0.42, 0.48);
  const brandTint = rgb(
    brandColorRgb.r * 0.08 + 1 * 0.92,
    brandColorRgb.g * 0.08 + 1 * 0.92,
    brandColorRgb.b * 0.08 + 1 * 0.92,
  );

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

  // Platform name + mark, side by side, centered as one unit.
  const brandLabel = DEFAULT_BRAND.productName.toUpperCase();
  const brandLabelSize = 13;
  const brandLabelWidth = bold.widthOfTextAtSize(brandLabel, brandLabelSize);
  const brandY = PAGE_HEIGHT - 96;
  let markImage: PDFImage | null = null;
  const markPng = await loadBrandMarkPng();
  if (markPng) {
    try {
      markImage = await doc.embedPng(markPng);
    } catch (err) {
      log.warn('Failed to embed brand mark image (omitted):', err);
    }
  }
  const markDisplaySize = 20;
  const markGap = markImage ? 8 : 0;
  const brandUnitWidth = (markImage ? markDisplaySize + markGap : 0) + brandLabelWidth;
  let brandX = (PAGE_WIDTH - brandUnitWidth) / 2;
  if (markImage) {
    page.drawImage(markImage, {
      x: brandX,
      y: brandY - markDisplaySize / 2 + brandLabelSize * 0.32,
      width: markDisplaySize,
      height: markDisplaySize,
    });
    brandX += markDisplaySize + markGap;
  }
  page.drawText(brandLabel, { x: brandX, y: brandY, size: brandLabelSize, font: bold, color: brand });

  centeredText(page, params.heading ?? 'Certificate of Completion', PAGE_HEIGHT - 168, 28, bold, ink);

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

  cursorY -= 8;

  if (params.serialCode) {
    // Prominent, boxed, monospaced — this is what a viewer types into
    // /verify/[serialCode], not fine print at the bottom.
    const codeSize = 16;
    const labelSize = 8;
    const codeWidth = mono.widthOfTextAtSize(params.serialCode, codeSize);
    const boxWidth = codeWidth + 48;
    const boxHeight = 46;
    const boxX = (PAGE_WIDTH - boxWidth) / 2;
    const boxTop = cursorY;
    const boxY = boxTop - boxHeight;
    page.drawRectangle({
      x: boxX,
      y: boxY,
      width: boxWidth,
      height: boxHeight,
      color: brandTint,
      borderColor: brand,
      borderWidth: 1,
    });
    centeredText(page, 'VERIFICATION CODE', boxY + boxHeight - 15, labelSize, bold, muted);
    centeredText(page, params.serialCode, boxY + 10, codeSize, mono, ink);
    cursorY = boxY - 22;
  }

  // Anchored near the bottom (matching the original, sparser plain-
  // certificate layout) unless heavier content above genuinely pushed
  // the cursor lower than that anchor, in which case it follows down
  // rather than overlapping.
  const dateText = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
  }).format(params.completionDate);
  centeredText(page, dateText, Math.min(cursorY, outerInset + 48), 11, font, muted);

  return doc.save();
}
