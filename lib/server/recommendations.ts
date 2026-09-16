/**
 * Recommendation generation — a real LLM call analyzing one already-scored
 * assessment's actual recorded results (score, feedback, strengths, areas to
 * improve — whatever the assessment row captured at scoring time) into a
 * short recommendation + suggested focus areas, stored on `recommendations`.
 *
 * Shared by both trigger points: the course-final assessment route, and the
 * per-lesson quiz assessment route. Never throws — a failure here means no
 * recommendation gets created, but must never fail the assessment write it
 * rides on top of.
 */
import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { parseJsonResponse } from '@binah/generation';
import { createLogger } from '@/lib/logger';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

const log = createLogger('RecommendationGenerator');

interface GeneratedRecommendation {
  recommendationText: string;
  suggestedFocusAreas: string[];
}

function buildRecommendationPrompt(assessment: {
  assessmentType: string;
  score: number;
  maxScore: number;
  feedback: string | null;
  strengths: string[] | null;
  areasToImprove: string[] | null;
}): { system: string; user: string } {
  const system = `You are a learning coach. You are given the results of one scored assessment. Write a short, specific, actionable recommendation for what the learner should focus on next — grounded in the actual score and feedback given, not generic study advice. Return ONLY valid JSON, no markdown or explanation.`;

  const pct = Math.round((assessment.score / Math.max(assessment.maxScore, 1)) * 100);
  const parts = [
    `Assessment type: ${assessment.assessmentType}`,
    `Score: ${assessment.score}/${assessment.maxScore} (${pct}%)`,
  ];
  if (assessment.feedback) parts.push(`Feedback given at scoring time: ${assessment.feedback}`);
  if (assessment.strengths?.length) parts.push(`Recorded strengths: ${assessment.strengths.join(', ')}`);
  if (assessment.areasToImprove?.length)
    parts.push(`Recorded areas to improve: ${assessment.areasToImprove.join(', ')}`);

  const user = `${parts.join('\n')}

Based on these actual results, write one recommendation for what the learner should focus on next.

Return a JSON object with this exact structure:
{
  "recommendationText": "string (1-3 sentences, specific to these results)",
  "suggestedFocusAreas": ["string", "..."]
}`;

  return { system, user };
}

/**
 * Generate and store one recommendation from an already-scored assessment
 * owned by `learnerId`. Fire-and-forget from the caller's perspective —
 * every failure is logged and swallowed here rather than thrown, so callers
 * never need their own try/catch around this.
 */
export async function generateRecommendationForAssessment(
  req: NextRequest,
  assessmentId: string,
  learnerId: string,
): Promise<void> {
  try {
    const admin = createServiceRoleClient();
    const { data: assessment, error } = await admin
      .from('assessments')
      .select('id, learner_id, course_id, assessment_type, score, max_score, feedback, strengths, areas_to_improve')
      .eq('id', assessmentId)
      .eq('learner_id', learnerId)
      .maybeSingle();
    if (error) throw error;
    if (!assessment || typeof assessment.score !== 'number' || typeof assessment.max_score !== 'number') {
      // Nothing scored to analyze — not an error, just genuinely no basis
      // for a recommendation (e.g. an ungraded assessment row).
      return;
    }

    const {
      model: languageModel,
      thinkingConfig,
      fallbackModels,
    } = await resolveModelFromRequest(req, {}, 'assessment-recommendation');

    const prompt = buildRecommendationPrompt({
      assessmentType: assessment.assessment_type as string,
      score: assessment.score,
      maxScore: assessment.max_score,
      feedback: assessment.feedback as string | null,
      strengths: assessment.strengths as string[] | null,
      areasToImprove: assessment.areas_to_improve as string[] | null,
    });
    const response = await callLLM(
      { model: languageModel, system: prompt.system, prompt: prompt.user },
      'assessment-recommendation',
      { fallbackModels },
      thinkingConfig,
    );

    const parsed = parseJsonResponse<GeneratedRecommendation>(response.text, { logger: log });
    if (!parsed || typeof parsed.recommendationText !== 'string') {
      log.error('Failed to parse recommendation response:', response.text.slice(0, 500));
      return;
    }

    const { error: insertError } = await admin.from('recommendations').insert({
      learner_id: learnerId,
      course_id: assessment.course_id ?? null,
      source_assessment_id: assessmentId,
      recommendation_text: parsed.recommendationText,
      suggested_focus_areas: Array.isArray(parsed.suggestedFocusAreas)
        ? parsed.suggestedFocusAreas
        : null,
      dismissed: false,
    });
    if (insertError) throw insertError;
  } catch (err) {
    log.error('Failed to generate recommendation (ignored):', err);
  }
}
