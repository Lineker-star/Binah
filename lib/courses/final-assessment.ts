import { getCurrentModelConfig } from '@/lib/utils/model-config';

/**
 * Fire the course-final assessment synthesis (see
 * app/api/assessments/course-final/route.ts) once a course's last planned
 * lesson completes. Fire-and-forget from the caller — the actual insert and
 * learning_metrics recompute happen server-side; this just kicks it off
 * with the learner's configured model.
 */
export async function generateCourseFinalAssessment(courseId: string): Promise<void> {
  const modelConfig = getCurrentModelConfig();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-model': modelConfig.modelString,
    'x-api-key': modelConfig.apiKey,
  };
  if (modelConfig.baseUrl) headers['x-base-url'] = modelConfig.baseUrl;
  if (modelConfig.providerType) headers['x-provider-type'] = modelConfig.providerType;

  const res = await fetch('/api/assessments/course-final', {
    method: 'POST',
    headers,
    body: JSON.stringify({ courseId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
}
