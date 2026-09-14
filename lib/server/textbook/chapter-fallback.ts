/**
 * Fallback chapter detection for PDFs with no native outline/bookmarks —
 * step 2 of the hybrid pipeline. Step 1 (lib/pdf/heading-heuristic.ts)
 * produces cheap font-size-based candidates; this makes ONE LLM call over
 * that candidate list (not the full document text) to discard false
 * positives (running headers, figure captions) and return the real
 * chapter-level headings in reading order. One call total, not one per
 * page — the candidate list is what's sent, never the raw page text.
 */
import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { parseJsonResponse } from '@openmaic/generation';
import { createLogger } from '@/lib/logger';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import type { HeadingCandidate } from '@/lib/pdf/heading-heuristic';
import { classifyChapterKind, type DetectedChapter } from '@/lib/pdf/textbook-outline';

const log = createLogger('ChapterFallback');

interface CleanedHeading {
  page: number;
  title: string;
}

interface FallbackResponse {
  headings: CleanedHeading[];
}

/** Cap the candidate list sent to the LLM — a pathological PDF can produce thousands. */
const MAX_CANDIDATES = 400;

export async function detectChaptersViaFallback(
  req: NextRequest,
  candidates: HeadingCandidate[],
  totalPages: number,
): Promise<DetectedChapter[]> {
  if (candidates.length === 0) return [];

  const trimmed = candidates.slice(0, MAX_CANDIDATES);
  const system = `You are analyzing font-size-based heading candidates extracted from a PDF textbook that has no built-in table of contents. Some candidates are real chapter headings; others are false positives (running headers, footnote markers, figure/table captions, pull quotes). Identify only the actual chapter-level headings, in reading order. Return ONLY valid JSON, no markdown or explanation.`;

  const candidateList = trimmed.map((c) => `p.${c.page}: "${c.text}" (font size ${c.fontSize.toFixed(1)})`).join('\n');
  const user = `Candidates (page, text, font size):
${candidateList}

Total pages in the document: ${totalPages}

Return a JSON object with this exact structure:
{
  "headings": [
    { "page": <number>, "title": "<string>" }
  ]
}

Only include genuine chapter-level headings. Skip running headers/footers, captions, and anything that repeats on many pages.`;

  const {
    model: languageModel,
    thinkingConfig,
    fallbackModels,
  } = await resolveModelFromRequest(req, {}, 'textbook-chapter-fallback');
  const response = await callLLM(
    { model: languageModel, system, prompt: user },
    'textbook-chapter-fallback',
    { fallbackModels },
    thinkingConfig,
  );

  const parsed = parseJsonResponse<FallbackResponse>(response.text, { logger: log });
  if (!parsed || !Array.isArray(parsed.headings)) {
    log.error('Failed to parse fallback chapter response:', response.text.slice(0, 500));
    return [];
  }

  const headings = parsed.headings
    .filter((h) => typeof h.page === 'number' && typeof h.title === 'string' && h.title.trim())
    .sort((a, b) => a.page - b.page);

  const chapters: DetectedChapter[] = [];
  for (let i = 0; i < headings.length; i++) {
    const startPage = Math.max(1, Math.min(headings[i].page, totalPages));
    const nextStart = i + 1 < headings.length ? headings[i + 1].page : totalPages + 1;
    const endPage = Math.max(startPage, Math.min(nextStart - 1, totalPages));
    chapters.push({
      title: headings[i].title.trim(),
      startPage,
      endPage,
      detectionMethod: 'ai_fallback',
      kind: classifyChapterKind(headings[i].title),
    });
  }
  return chapters;
}
