import { getCurrentModelConfig } from '@/lib/utils/model-config';
import type { QuizQuestion } from '@/lib/types/stage';

export interface ContinuousAssessmentResult {
  questions: QuizQuestion[];
  chapterTitle: string;
  ingestionId: string;
}

/**
 * Generate a chapter's Continuous Assessment (20 fresh questions pooled
 * from the chapter's own raw text — see app/api/assessments/continuous
 * /route.ts). Nothing is recorded server-side by this call; the caller
 * records the assessment once the learner actually finishes answering
 * (recordAssessment with assessmentType: 'continuous_assessment').
 */
export async function generateContinuousAssessment(
  chapterId: string,
): Promise<ContinuousAssessmentResult> {
  const modelConfig = getCurrentModelConfig();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-model': modelConfig.modelString,
    'x-api-key': modelConfig.apiKey,
  };
  if (modelConfig.baseUrl) headers['x-base-url'] = modelConfig.baseUrl;
  if (modelConfig.providerType) headers['x-provider-type'] = modelConfig.providerType;

  const res = await fetch('/api/assessments/continuous', {
    method: 'POST',
    headers,
    body: JSON.stringify({ chapterId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as ContinuousAssessmentResult;
  return data;
}
