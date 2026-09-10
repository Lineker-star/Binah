'use client';

/**
 * `useExportLectureNotes` — generate a PDF summary of the lesson's key
 * points (LLM-synthesized from the same narration text the Script export
 * already collects, not a re-export of the full deck) and download it.
 *
 * Unlike the other export formats, this one is not purely client-side: the
 * synthesis + PDF layout happen server-side (see
 * app/api/artifacts/lecture-notes/route.ts), which also records the result
 * to the learner's permanent Downloads list when signed in.
 */
import { useCallback, useRef, useState } from 'react';
import { saveAs } from 'file-saver';
import { toast } from 'sonner';

import { useStageStore } from '@/lib/store';
import { useI18n } from '@/lib/hooks/use-i18n';
import { createLogger } from '@/lib/logger';
import { collectSceneScripts, buildMarkdown } from './use-export-script';
import { getLearningSession } from '@/lib/classroom/learning-session-signal';
import { getCurrentModelConfig } from '@/lib/utils/model-config';

const log = createLogger('ExportLectureNotes');

export function useExportLectureNotes() {
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const { t } = useI18n();

  const scenes = useStageStore((s) => s.scenes);
  const stage = useStageStore((s) => s.stage);

  const exportLectureNotes = useCallback(() => {
    if (exportingRef.current) return;

    const scripts = collectSceneScripts(scenes, (order) => `Slide ${order + 1}`);
    if (scripts.length === 0) {
      toast.warning(t('export.noNarration'));
      return;
    }

    exportingRef.current = true;
    setExporting(true);
    (async () => {
      try {
        const title = stage?.name || 'Lecture Notes';
        const lessonText = buildMarkdown(title, scripts);
        const session = stage?.id ? getLearningSession(stage.id) : null;

        const modelConfig = getCurrentModelConfig();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'x-model': modelConfig.modelString,
          'x-api-key': modelConfig.apiKey,
        };
        if (modelConfig.baseUrl) headers['x-base-url'] = modelConfig.baseUrl;
        if (modelConfig.providerType) headers['x-provider-type'] = modelConfig.providerType;

        const res = await fetch('/api/artifacts/lecture-notes', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            title,
            lessonText,
            sessionId: session?.id ?? null,
            courseId: session?.course_id ?? null,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
        }
        const blob = await res.blob();
        saveAs(blob, `${title}.pdf`);
        toast.success(t('export.exportSuccess'));
      } catch (err) {
        log.error('Lecture notes export failed:', err);
        toast.error(t('export.exportFailed'));
      } finally {
        exportingRef.current = false;
        setExporting(false);
      }
    })();
  }, [scenes, stage, t]);

  return { exporting, exportLectureNotes };
}
