import { getCurrentModelConfig } from '@/lib/utils/model-config';
import type { QuizQuestion } from '@/lib/types/stage';

export interface ExamResult {
  questions: QuizQuestion[];
  examTitle: string;
  ingestionId: string;
  moduleId: string | null;
  courseId: string | null;
}

/**
 * Generate an Exam (50 fresh questions pooled across a module's chapters,
 * or a whole book's chapters when it has no module layer — see
 * app/api/assessments/exam/route.ts). Nothing is recorded server-side by
 * this call; the caller records the assessment once the learner actually
 * finishes answering (recordAssessment with assessmentType: 'exam').
 */
export async function generateExam(kind: 'module' | 'book', id: string): Promise<ExamResult> {
  const modelConfig = getCurrentModelConfig();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-model': modelConfig.modelString,
    'x-api-key': modelConfig.apiKey,
  };
  if (modelConfig.baseUrl) headers['x-base-url'] = modelConfig.baseUrl;
  if (modelConfig.providerType) headers['x-provider-type'] = modelConfig.providerType;

  const res = await fetch('/api/assessments/exam', {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind, id }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as ExamResult;
  return data;
}
