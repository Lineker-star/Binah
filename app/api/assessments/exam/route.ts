/**
 * POST /api/assessments/exam — generate an Exam: 50 fresh quiz questions
 * spanning a whole module's chapters (or, for a book with no module layer,
 * the whole book's chapters), fired once a learner finishes the last
 * chapter in that group — see the module-completion detection in
 * lib/supabase/module-completion.ts and its trigger wiring in
 * components/edit/PlaybackChromeRoot.tsx. Book-chapter-course only by
 * design, same scoping as Continuous Assessment — there's no equivalent
 * content source for a non-book ad-hoc/Structured Course session.
 *
 * Same generation path as Continuous Assessment one tier down: pools every
 * covered chapter's own raw extracted text (textbook_ingestions.chapters)
 * and feeds it through generateSceneContent's quiz path as this outline's
 * keyPoints. Pooling across several chapters (or a whole book) is a much
 * larger prompt than Continuous Assessment's single chapter — if this hits
 * provider context-window limits on large modules/books, a chunked or
 * summarized variant would be the fix; untested at this scale.
 *
 * Returns the generated questions to the caller; nothing is written to
 * `assessments` here — that happens once the learner actually finishes
 * answering (see app/assessment/exam/[kind]/[id]/page.tsx ->
 * recordAssessment), same as every other quiz in this app.
 */
import { NextRequest } from 'next/server';
import { generateSceneContent, type GeneratedQuizContent } from '@binah/generation';
import type { SceneOutline } from '@/lib/types/generation';
import { callLLM } from '@/lib/ai/llm';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import { createClient as createServerClient } from '@/lib/supabase/server';
import type { TextbookChaptersData } from '@/lib/textbook/types';

const log = createLogger('ExamAPI');

const EXAM_QUESTION_COUNT = 50;

interface RequestBody {
  kind: 'module' | 'book';
  id: string;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return apiError('INVALID_REQUEST', 401, 'Not signed in');
    }

    const body = (await req.json()) as RequestBody;
    if (body.kind !== 'module' && body.kind !== 'book') {
      return apiError('MISSING_REQUIRED_FIELD', 400, "kind must be 'module' or 'book'");
    }
    if (!body.id || typeof body.id !== 'string') {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'id is required');
    }

    let ingestionId: string;
    let examTitle = '';
    let moduleId: string | null = null;

    if (body.kind === 'module') {
      const { data: moduleRow, error: moduleError } = await supabase
        .from('book_modules')
        .select('id, title, ingestion_id')
        .eq('id', body.id)
        .maybeSingle();
      if (moduleError) throw moduleError;
      if (!moduleRow) {
        return apiError('INVALID_REQUEST', 404, 'Module not found');
      }
      moduleId = moduleRow.id as string;
      ingestionId = moduleRow.ingestion_id as string;
      examTitle = moduleRow.title as string;
    } else {
      ingestionId = body.id;
    }

    // RLS (book_chapters_owner / textbook_ingestions) already scopes reads
    // to the caller's own ingestion, but a clear 404 beats a confusing
    // empty result.
    const { data: ingestion, error: ingestionError } = await supabase
      .from('textbook_ingestions')
      .select('chapters, course_id, original_filename')
      .eq('id', ingestionId)
      .eq('learner_id', user.id)
      .maybeSingle();
    if (ingestionError) throw ingestionError;
    if (!ingestion) {
      return apiError('INVALID_REQUEST', 404, 'Source ingestion not found');
    }
    if (!examTitle) {
      examTitle = (ingestion.original_filename as string).replace(/\.pdf$/i, '');
    }

    let chaptersQuery = supabase
      .from('book_chapters')
      .select('chapter_number')
      .eq('ingestion_id', ingestionId)
      .eq('is_front_or_back_matter', false)
      .order('chapter_number', { ascending: true });
    chaptersQuery = moduleId
      ? chaptersQuery.eq('module_id', moduleId)
      : chaptersQuery.is('module_id', null);
    const { data: chapterRows, error: chapterRowsError } = await chaptersQuery;
    if (chapterRowsError) throw chapterRowsError;
    if (!chapterRows?.length) {
      return apiError('INVALID_REQUEST', 400, 'No chapters found for this exam scope.');
    }

    const chaptersData = ingestion.chapters as TextbookChaptersData | null;
    const pooledText = chapterRows
      .map((c) => chaptersData?.items?.[(c.chapter_number as number) - 1]?.text?.trim())
      .filter((text): text is string => !!text)
      .join('\n\n');
    if (!pooledText) {
      return apiError('INVALID_REQUEST', 400, "This exam's source text is unavailable.");
    }

    const {
      model: languageModel,
      modelInfo,
      thinkingConfig,
      fallbackModels,
    } = await resolveModelFromRequest(req, body, 'exam');

    const aiCall = async (systemPrompt: string, userPrompt: string): Promise<string> => {
      const result = await callLLM(
        {
          model: languageModel,
          system: systemPrompt,
          prompt: userPrompt,
          maxOutputTokens: modelInfo?.outputWindow,
          maxRetries: 0,
        },
        'exam',
        { fallbackModels },
        thinkingConfig,
      );
      return result.text;
    };

    const outline: SceneOutline = {
      id: 'exam',
      type: 'quiz',
      title: examTitle,
      description: `Exam covering everything in "${examTitle}".`,
      keyPoints: [pooledText],
      order: 1,
      quizConfig: {
        questionCount: EXAM_QUESTION_COUNT,
        difficulty: 'medium',
        questionTypes: ['single', 'multiple'],
      },
    };

    const content = (await generateSceneContent(outline, aiCall, {
      userRequirements: { requirement: '', courseMode: true },
    })) as GeneratedQuizContent | null;

    if (!content?.questions?.length) {
      return apiError('GENERATION_FAILED', 500, 'Failed to generate the exam');
    }

    return apiSuccess({
      questions: content.questions,
      examTitle,
      ingestionId,
      moduleId,
      courseId: (ingestion.course_id as string | null) ?? null,
    });
  } catch (error) {
    log.error('Failed to generate exam:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to generate exam',
    );
  }
}
