/**
 * Whole-book and per-chapter summary generation for the textbook-ingestion
 * "book overview" step. Whole-book summary is one cheap LLM call over
 * chapter titles + a short excerpt of each chapter (not full chapter
 * text); each chapter summary is its own call grounded in that chapter's
 * own extracted text specifically.
 */
import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { parseJsonResponse } from '@openmaic/generation';
import { createLogger } from '@/lib/logger';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';

const log = createLogger('TextbookSummaries');

/** Per-chapter excerpt length fed into the whole-book summary call. */
const BOOK_SUMMARY_EXCERPT_CHARS = 500;
/** Per-chapter text cap fed into that chapter's own summary call — generous
 *  relative to the old whole-document 50,000-char ceiling, since each
 *  chapter now gets its own independent budget instead of competing for
 *  one shared window. */
const CHAPTER_SUMMARY_TEXT_CHARS = 20_000;

export async function generateWholeBookSummary(
  req: NextRequest,
  bookTitle: string,
  chapters: Array<{ title: string; text: string }>,
): Promise<string> {
  const system = `You are a teaching assistant writing a short "what this book covers" summary from its chapter titles and brief excerpts. Return ONLY valid JSON, no markdown or explanation.`;

  const chapterList = chapters
    .map((c, i) => {
      const excerpt = c.text.slice(0, BOOK_SUMMARY_EXCERPT_CHARS).trim();
      return `${i + 1}. ${c.title}${excerpt ? `\n   Excerpt: ${excerpt}` : ''}`;
    })
    .join('\n');

  const user = `Book: "${bookTitle}"

Chapters:
${chapterList}

Write a 2-4 sentence summary of what this book covers overall — its scope, approach, and who it's likely written for.

Return a JSON object with this exact structure:
{
  "summary": "string"
}`;

  const { model: languageModel, thinkingConfig } = await resolveModelFromRequest(
    req,
    {},
    'textbook-book-summary',
  );
  const response = await callLLM(
    { model: languageModel, system, prompt: user },
    'textbook-book-summary',
    undefined,
    thinkingConfig,
  );

  const parsed = parseJsonResponse<{ summary: string }>(response.text, { logger: log });
  if (!parsed || typeof parsed.summary !== 'string') {
    log.error('Failed to parse whole-book summary response:', response.text.slice(0, 500));
    return '';
  }
  return parsed.summary.trim();
}

export async function generateChapterSummary(
  req: NextRequest,
  bookTitle: string,
  chapterTitle: string,
  chapterText: string,
): Promise<string> {
  const system = `You are a teaching assistant writing a very short summary of one book chapter, grounded specifically in that chapter's own text. Return ONLY valid JSON, no markdown or explanation.`;

  const truncated = chapterText.slice(0, CHAPTER_SUMMARY_TEXT_CHARS);
  const user = `Book: "${bookTitle}"
Chapter: "${chapterTitle}"

Chapter text:
${truncated}

Write a 1-2 sentence summary of what THIS chapter specifically covers.

Return a JSON object with this exact structure:
{
  "summary": "string"
}`;

  const { model: languageModel, thinkingConfig } = await resolveModelFromRequest(
    req,
    {},
    'textbook-chapter-summary',
  );
  const response = await callLLM(
    { model: languageModel, system, prompt: user },
    'textbook-chapter-summary',
    undefined,
    thinkingConfig,
  );

  const parsed = parseJsonResponse<{ summary: string }>(response.text, { logger: log });
  if (!parsed || typeof parsed.summary !== 'string') {
    log.error(`Failed to parse chapter summary response for "${chapterTitle}":`, response.text.slice(0, 500));
    return '';
  }
  return parsed.summary.trim();
}
