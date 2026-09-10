/**
 * POST /api/textbook/ingest — the "book overview" step: upload a PDF
 * textbook, detect its chapters (native outline first, heuristic+LLM
 * fallback otherwise), extract each chapter's own text, and generate the
 * whole-book + per-chapter summaries. Stores everything on the
 * pre-provisioned `textbook_ingestions` row so the Chapter Review screen
 * has something to fetch. Audio Overview generation is a separate,
 * subsequent call (see [id]/audio-overview/route.ts) — this route returns
 * as soon as the text summaries are ready.
 */
import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { MAX_EXTRACT_DOCUMENT_FILE_SIZE_BYTES } from '@/lib/constants/generation';
import { extractTextbookOutline, extractChapterText, type DetectedChapter } from '@/lib/pdf/textbook-outline';
import { detectHeadingCandidates } from '@/lib/pdf/heading-heuristic';
import { detectChaptersViaFallback } from '@/lib/server/textbook/chapter-fallback';
import { generateChapterSummary, generateWholeBookSummary } from '@/lib/server/textbook/summaries';
import type { IngestedChapter, TextbookChaptersData } from '@/lib/textbook/types';

const log = createLogger('TextbookIngestAPI');

/** Bound how many chapters get their own summary LLM call for one upload. */
const MAX_SUMMARIZED_CHAPTERS = 60;

export async function POST(req: NextRequest) {
  let ingestionId: string | undefined;
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return apiError('INVALID_REQUEST', 401, 'Not signed in');
    }

    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return apiError('INVALID_REQUEST', 400, 'Expected multipart/form-data');
    }
    const formData = await req.formData();
    const file = formData.get('pdf');
    if (!(file instanceof File)) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'No PDF file provided');
    }
    if (file.size > MAX_EXTRACT_DOCUMENT_FILE_SIZE_BYTES) {
      return apiError(
        'INVALID_REQUEST',
        400,
        `File too large: max ${Math.round(MAX_EXTRACT_DOCUMENT_FILE_SIZE_BYTES / 1024 / 1024)}MB`,
      );
    }

    const admin = createServiceRoleClient();
    const { data: inserted, error: insertError } = await admin
      .from('textbook_ingestions')
      .insert({
        learner_id: user.id,
        original_filename: file.name,
        status: 'processing',
      })
      .select('id')
      .single();
    if (insertError) throw insertError;
    ingestionId = inserted.id as string;

    const buffer = Buffer.from(await file.arrayBuffer());

    const { totalPages, chapters: nativeChapters, pageTexts } = await extractTextbookOutline(buffer);

    let chapters: DetectedChapter[] = nativeChapters;
    if (chapters.length === 0) {
      log.info(`No native outline for ingestion ${ingestionId}; running heuristic fallback.`);
      const candidates = await detectHeadingCandidates(buffer);
      chapters = await detectChaptersViaFallback(req, candidates, totalPages);
    }

    if (chapters.length === 0) {
      await admin
        .from('textbook_ingestions')
        .update({
          status: 'error',
          error_message: 'No chapters could be detected in this PDF.',
          total_pages: totalPages,
        })
        .eq('id', ingestionId);
      return apiError('PARSE_FAILED', 422, 'No chapters could be detected in this PDF.');
    }

    // Text extraction is cheap (string slicing from the already-parsed
    // per-page array, no LLM cost) so every chapter gets its own text —
    // later lessons (chapter 2, 3, ...) need it too. Only the up-front
    // summary call is capped, since that costs an LLM call per chapter.
    const chapterTexts = chapters.map((c) => extractChapterText(pageTexts, c.startPage, c.endPage));
    const summarizable = chapters.slice(0, MAX_SUMMARIZED_CHAPTERS);

    const chapterSummaries = await Promise.all(
      summarizable.map((c, i) =>
        c.kind === 'chapter'
          ? generateChapterSummary(req, file.name, c.title, chapterTexts[i]).catch((err) => {
              log.warn(`Failed to summarize chapter "${c.title}" (continuing without it):`, err);
              return '';
            })
          : Promise.resolve(''),
      ),
    );

    const bookTitle = file.name.replace(/\.pdf$/i, '');
    const summaryInputChapters = summarizable
      .map((c, i) => ({ title: c.title, text: chapterTexts[i] }))
      .filter((_, i) => summarizable[i].kind === 'chapter');
    const wholeBookSummary = await generateWholeBookSummary(req, bookTitle, summaryInputChapters).catch(
      (err) => {
        log.warn(`Failed to generate whole-book summary for ingestion ${ingestionId} (continuing without it):`, err);
        return '';
      },
    );

    const items: IngestedChapter[] = chapters.map((c, i) => ({
      title: c.title,
      startPage: c.startPage,
      endPage: c.endPage,
      detectionMethod: c.detectionMethod,
      kind: c.kind,
      summary: i < summarizable.length ? chapterSummaries[i] : '',
      text: chapterTexts[i],
      includeAsLesson: c.kind === 'chapter',
    }));

    const chaptersData: TextbookChaptersData = {
      wholeBookSummary,
      items,
      audioOverview: { status: 'pending' },
    };

    const { error: updateError } = await admin
      .from('textbook_ingestions')
      .update({
        status: 'ready',
        total_pages: totalPages,
        chapters: chaptersData,
      })
      .eq('id', ingestionId);
    if (updateError) throw updateError;

    return apiSuccess({ id: ingestionId });
  } catch (error) {
    log.error('Textbook ingestion failed:', error);
    if (ingestionId) {
      try {
        const admin = createServiceRoleClient();
        await admin
          .from('textbook_ingestions')
          .update({
            status: 'error',
            error_message: error instanceof Error ? error.message : 'Ingestion failed',
          })
          .eq('id', ingestionId);
      } catch (updateErr) {
        log.error('Failed to record ingestion error state:', updateErr);
      }
    }
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to ingest textbook',
    );
  }
}
