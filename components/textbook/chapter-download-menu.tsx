'use client';

/**
 * Download action for one chapter row in the Chapter Review screen. With
 * exactly one completed lesson, this downloads that lesson alone (notes-
 * pdf scoped by session_id, matching the existing live in-player export's
 * scoping); with more than one, it bundles every completed lesson in the
 * chapter into one file (notes-pdf scoped by chapter_id instead). pptx/
 * resource-pack are intentionally not offered here yet — see
 * lib/export/lesson-chapter-export.ts's header comment.
 */
import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ChapterExportLesson } from '@/lib/supabase/learning-session';
import {
  exportChapterNotes,
  exportChapterScript,
  exportLessonNotes,
  exportLessonScript,
  type LessonRef,
} from '@/lib/export/lesson-chapter-export';

interface ChapterDownloadMenuProps {
  title: string;
  lessons: ChapterExportLesson[];
  /** book_chapters.id — required to scope a >1-lesson bundle's
   *  generated_artifacts.chapter_id. Missing is a safe no-op (the menu just
   *  doesn't render), not a crash — every real chapter should have one. */
  chapterId: string | null;
}

export function ChapterDownloadMenu({ title, lessons, chapterId }: ChapterDownloadMenuProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  if (lessons.length === 0) return null;
  const isSingleLesson = lessons.length === 1;
  if (!isSingleLesson && !chapterId) return null;

  const lessonRefs: LessonRef[] = lessons.map((l) => ({ stageId: l.stage_id, title: l.title }));

  const run = async (action: () => Promise<{ exported: boolean }>) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await action();
      if (!result.exported) {
        toast.warning(t('export.nothingToExport'));
        return;
      }
      toast.success(t('export.exportSuccess'));
    } catch {
      toast.error(t('export.exportFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleNotes = () =>
    run(() =>
      isSingleLesson
        ? exportLessonNotes(lessons[0].stage_id, lessons[0].id, lessons[0].course_id)
        : exportChapterNotes(title, lessonRefs, chapterId as string, lessons[0].course_id),
    );
  const handleScriptMd = () =>
    run(() =>
      isSingleLesson
        ? exportLessonScript(lessons[0].stage_id, 'md')
        : exportChapterScript(title, lessonRefs, 'md'),
    );
  const handleScriptDocx = () =>
    run(() =>
      isSingleLesson
        ? exportLessonScript(lessons[0].stage_id, 'docx')
        : exportChapterScript(title, lessonRefs, 'docx'),
    );

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border/60 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50 cursor-pointer shrink-0"
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
          {isSingleLesson ? t('textbook.downloadLesson') : t('textbook.downloadChapter')}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-[170px]">
        <DropdownMenuItem onSelect={handleNotes} className="cursor-pointer">
          {t('export.lectureNotes')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleScriptMd} className="cursor-pointer">
          {t('export.scriptMd')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleScriptDocx} className="cursor-pointer">
          {t('export.scriptDocx')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
