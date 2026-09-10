'use client';

import { getLearningSession } from '@/lib/classroom/learning-session-signal';

export type ArtifactType = 'pptx' | 'resource_pack' | 'classroom_zip' | 'mp4' | 'lecture_notes_pdf';

/**
 * Best-effort: upload a just-generated export Blob to durable storage and
 * record it in `generated_artifacts`, so it becomes part of the learner's
 * permanent record instead of only a one-time browser download. Every
 * export format already downloads via `saveAs` before this is ever called
 * — this rides alongside that, never gates it. No-ops server-side (not
 * here) for a signed-out visitor; this always POSTs, the route decides.
 */
export async function recordGeneratedArtifact(params: {
  blob: Blob;
  fileName: string;
  artifactType: ArtifactType;
  stageId?: string | null;
}): Promise<void> {
  const session = params.stageId ? getLearningSession(params.stageId) : null;

  const form = new FormData();
  form.append('file', params.blob, params.fileName);
  form.append('artifactType', params.artifactType);
  if (session?.id) form.append('sessionId', session.id);
  if (session?.course_id) form.append('courseId', session.course_id);

  const res = await fetch('/api/artifacts/record', { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
}
