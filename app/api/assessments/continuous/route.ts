/**
 * POST /api/assessments/continuous — generate a Continuous Assessment: 20
 * fresh quiz questions covering a whole book chapter, fired once a learner
 * finishes that chapter's last lesson (see the chapter-completion
 * detection in components/edit/PlaybackChromeRoot.tsx). Book-chapter-course
 * only by design -- there is no equivalent content source for a non-book
 * ad-hoc/Structured Course session (see lib/textbook/chapter-completion.ts).
 *
 * Unlike course-final (which aggregates already-recorded per-lesson quiz
 * scores into a report), this generates NEW questions the learner actually
 * answers — the same shape as a regular in-lesson quiz's content generation
 * (generateSceneContent for a `type: 'quiz'` outline), just fed the
 * chapter's own pooled raw extracted text (textbook_ingestions.chapters
 * .items[i].text) instead of one scene's keyPoints, since per-lesson
 * generated scene content lives only in the learner's browser (IndexedDB)
 * and isn't reachable from a server route. This is genuinely untested
 * (raw chapter text in, quiz out, rather than distilled keyPoints) --
 * question quality should be reviewed once this is live.
 *
 * Returns the generated questions to the caller; nothing is written to
 * `assessments` here — that happens once the learner actually finishes
 * answering (see app/assessment/continuous/[chapterId]/page.tsx ->
 * recordAssessment), same as every other quiz in this app.
 */
import { NextRequest } from 'next/server';
import { generateSceneContent, type GeneratedQuizContent } from '@openmaic/generation';
import type { SceneOutline } from '@/lib/types/generation';
import { callLLM } from '@/lib/ai/llm';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import { createClient as createServerClient } from '@/lib/supabase/server';
import type { TextbookChaptersData } from '@/lib/textbook/types';

const log = createLogger('ContinuousAssessmentAPI');

const CONTINUOUS_ASSESSMENT_QUESTION_COUNT = 20;

interface RequestBody {
  chapterId: string;
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
    if (!body.chapterId || typeof body.chapterId !== 'string') {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'chapterId is required');
    }

    // RLS (book_chapters_owner) already scopes this to the caller's own
    // ingestion, but a clear 404 beats a confusing empty result.
    const { data: chapter, error: chapterError } = await supabase
      .from('book_chapters')
      .select('id, ingestion_id, chapter_number, title')
      .eq('id', body.chapterId)
      .maybeSingle();
    if (chapterError) throw chapterError;
    if (!chapter) {
      return apiError('INVALID_REQUEST', 404, 'Chapter not found');
    }

    const { data: ingestion, error: ingestionError } = await supabase
      .from('textbook_ingestions')
      .select('chapters')
      .eq('id', chapter.ingestion_id as string)
      .eq('learner_id', user.id)
      .maybeSingle();
    if (ingestionError) throw ingestionError;
    if (!ingestion) {
      return apiError('INVALID_REQUEST', 404, 'Source ingestion not found');
    }

    const chaptersData = ingestion.chapters as TextbookChaptersData | null;
    const chapterNumber = chapter.chapter_number as number;
    const item = chaptersData?.items?.[chapterNumber - 1];
    if (!item?.text?.trim()) {
      return apiError('INVALID_REQUEST', 400, "This chapter's source text is unavailable.");
    }

    const { model: languageModel, modelInfo, thinkingConfig } = await resolveModelFromRequest(
      req,
      body,
      'continuous-assessment',
    );

    const aiCall = async (systemPrompt: string, userPrompt: string): Promise<string> => {
      const result = await callLLM(
        {
          model: languageModel,
          system: systemPrompt,
          prompt: userPrompt,
          maxOutputTokens: modelInfo?.outputWindow,
          maxRetries: 0,
        },
        'continuous-assessment',
        undefined,
        thinkingConfig,
      );
      return result.text;
    };

    const outline: SceneOutline = {
      id: 'continuous-assessment',
      type: 'quiz',
      title: (chapter.title as string) || item.title,
      description: `Chapter review assessment covering the full chapter "${item.title}".`,
      keyPoints: [item.text],
      order: 1,
      quizConfig: {
        questionCount: CONTINUOUS_ASSESSMENT_QUESTION_COUNT,
        difficulty: 'medium',
        questionTypes: ['single', 'multiple'],
      },
    };

    const content = (await generateSceneContent(outline, aiCall, {
      userRequirements: { requirement: '', courseMode: true },
    })) as GeneratedQuizContent | null;

    if (!content?.questions?.length) {
      return apiError('GENERATION_FAILED', 500, 'Failed to generate the continuous assessment');
    }

    return apiSuccess({
      questions: content.questions,
      chapterTitle: outline.title,
      ingestionId: chapter.ingestion_id as string,
    });
  } catch (error) {
    log.error('Failed to generate continuous assessment:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to generate continuous assessment',
    );
  }
}
