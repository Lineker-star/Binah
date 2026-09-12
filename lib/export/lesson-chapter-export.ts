'use client';

/**
 * Export narration script + lecture notes for a lesson the learner is NOT
 * currently viewing (single lesson, from outside the player) or for a
 * whole chapter's worth of completed lessons bundled into one file.
 *
 * Deliberately reuses the existing pure builders unchanged
 * (collectSceneScripts/buildMarkdown/buildDocxBlob from use-export-script.ts,
 * and the same /api/artifacts/lecture-notes route the live in-player
 * export already posts to) rather than duplicating them — the only new
 * piece is sourcing scene data via lib/utils/stage-storage.ts's
 * loadStageData(stageId), which reads any stage's IndexedDB-persisted
 * scenes directly, independent of what's currently mounted in
 * useStageStore. pptx/resource-pack are NOT extended here — their media-
 * resolution machinery is a separate, larger piece of work.
 */
import { saveAs } from 'file-saver';
import { loadStageData } from '@/lib/utils/stage-storage';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import {
  collectSceneScripts,
  buildMarkdown,
  buildDocxBlob,
  buildMultiSectionMarkdown,
  buildMultiSectionDocxBlob,
  buildScriptFileName,
  SCRIPT_MIME_TYPES,
  type ScriptFormat,
  type ScriptSection,
} from './use-export-script';

export interface LessonRef {
  stageId: string;
  title: string;
}

const slideFallback = (order: number) => `Slide ${order + 1}`;

function saveScriptBlob(blob: Blob, format: ScriptFormat, fileTitle: string) {
  const mime = SCRIPT_MIME_TYPES[format];
  const normalized = blob.type === mime ? blob : new Blob([blob], { type: mime });
  saveAs(normalized, buildScriptFileName(fileTitle, format));
}

/** Download one not-currently-mounted lesson's narration script. */
export async function exportLessonScript(
  stageId: string,
  format: ScriptFormat,
): Promise<{ exported: boolean }> {
  const data = await loadStageData(stageId);
  if (!data) throw new Error('Lesson not found');
  const scripts = collectSceneScripts(data.scenes, slideFallback);
  if (scripts.length === 0) return { exported: false };

  const title = data.stage?.name || 'lesson';
  const blob =
    format === 'md'
      ? new Blob([buildMarkdown(title, scripts)], { type: SCRIPT_MIME_TYPES.md })
      : await buildDocxBlob(title, scripts);
  saveScriptBlob(blob, format, title);
  return { exported: true };
}

/** Download a whole chapter's narration scripts, one section per completed lesson. */
export async function exportChapterScript(
  chapterTitle: string,
  lessons: LessonRef[],
  format: ScriptFormat,
): Promise<{ exported: boolean }> {
  const sections: ScriptSection[] = [];
  for (const lesson of lessons) {
    const data = await loadStageData(lesson.stageId);
    if (!data) continue;
    const scripts = collectSceneScripts(data.scenes, slideFallback);
    if (scripts.length === 0) continue;
    sections.push({ heading: lesson.title, scripts });
  }
  if (sections.length === 0) return { exported: false };

  const blob =
    format === 'md'
      ? new Blob([buildMultiSectionMarkdown(chapterTitle, sections)], {
          type: SCRIPT_MIME_TYPES.md,
        })
      : await buildMultiSectionDocxBlob(chapterTitle, sections);
  saveScriptBlob(blob, format, chapterTitle);
  return { exported: true };
}

function lectureNotesHeaders(): Record<string, string> {
  const modelConfig = getCurrentModelConfig();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-model': modelConfig.modelString,
    'x-api-key': modelConfig.apiKey,
  };
  if (modelConfig.baseUrl) headers['x-base-url'] = modelConfig.baseUrl;
  if (modelConfig.providerType) headers['x-provider-type'] = modelConfig.providerType;
  return headers;
}

async function postLectureNotes(body: {
  title: string;
  lessonText: string;
  sessionId?: string | null;
  courseId?: string | null;
  chapterId?: string | null;
}): Promise<Blob> {
  const res = await fetch('/api/artifacts/lecture-notes', {
    method: 'POST',
    headers: lectureNotesHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.blob();
}

/** Generate + download lecture notes for one not-currently-mounted lesson. */
export async function exportLessonNotes(
  stageId: string,
  sessionId: string | null,
  courseId: string | null,
): Promise<{ exported: boolean }> {
  const data = await loadStageData(stageId);
  if (!data) throw new Error('Lesson not found');
  const scripts = collectSceneScripts(data.scenes, slideFallback);
  if (scripts.length === 0) return { exported: false };

  const title = data.stage?.name || 'Lecture Notes';
  const lessonText = buildMarkdown(title, scripts);
  const blob = await postLectureNotes({ title, lessonText, sessionId, courseId });
  saveAs(blob, `${title}.pdf`);
  return { exported: true };
}

/** Generate + download lecture notes bundling a whole chapter's completed lessons. */
export async function exportChapterNotes(
  chapterTitle: string,
  lessons: LessonRef[],
  chapterId: string,
  courseId: string | null,
): Promise<{ exported: boolean }> {
  const sections: ScriptSection[] = [];
  for (const lesson of lessons) {
    const data = await loadStageData(lesson.stageId);
    if (!data) continue;
    const scripts = collectSceneScripts(data.scenes, slideFallback);
    if (scripts.length === 0) continue;
    sections.push({ heading: lesson.title, scripts });
  }
  if (sections.length === 0) return { exported: false };

  const lessonText = buildMultiSectionMarkdown(chapterTitle, sections);
  const blob = await postLectureNotes({ title: chapterTitle, lessonText, chapterId, courseId });
  saveAs(blob, `${chapterTitle}.pdf`);
  return { exported: true };
}
