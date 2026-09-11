import { getCurrentModelConfig } from '@/lib/utils/model-config';

/**
 * Fire the course-final assessment synthesis (see
 * app/api/assessments/course-final/route.ts) once a learning experience
 * reaches its completion screen. Fire-and-forget from the caller — the
 * actual insert and learning_metrics recompute happen server-side; this
 * just kicks it off with the learner's configured model.
 *
 * Two shapes: `courseId` for a Structured Course (aggregates every lesson's
 * quiz scores once the last planned lesson completes); `sessionId` for an
 * ad-hoc single-prompt session, which has no `courses` row to aggregate
 * across — that one session is treated as both the first and final lesson.
 */
export async function generateCourseFinalAssessment(
  target: { courseId: string } | { sessionId: string },
): Promise<void> {
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
    body: JSON.stringify(target),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
}
