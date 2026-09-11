/** Shared shape of `public.textbook_ingestions.chapters` (jsonb). */

export type ChapterKind = 'chapter' | 'front_matter' | 'back_matter';
export type ChapterDetectionMethod = 'native_outline' | 'ai_fallback';

export interface IngestedChapter {
  title: string;
  /** 1-based, inclusive page range. */
  startPage: number;
  endPage: number;
  detectionMethod: ChapterDetectionMethod;
  kind: ChapterKind;
  /** 1-2 sentences, grounded in this chapter's own extracted text. Empty for front/back matter. */
  summary: string;
  /**
   * This chapter's own extracted text (see lib/pdf/textbook-outline.ts) —
   * kept on the ingestion row so lesson generation for chapter 2, 3, ... N
   * (each created lazily as the learner reaches it, per the structured-
   * course lifecycle) can ground itself in the right chapter's source
   * material without re-uploading or re-parsing the original PDF.
   */
  text: string;
  /** Learner-controlled: whether this section should become a lesson when the course is built. */
  includeAsLesson: boolean;
  /**
   * Q.1 structuring plan (lib/textbook/structure-plan.ts): how many lessons
   * this chapter splits into. `null` for front/back matter (never turned
   * into a lesson, so the formula was never run on it). Absent (not just
   * `null`) on ingestions written before this field existed.
   */
  plannedLessonCount?: number | null;
  /**
   * Which module (1-based) this chapter belongs to, if the book qualifies
   * for module structuring (lib/textbook/structure-plan.ts#needsModuleLayer).
   * `null` when the book has no module layer. Absent on ingestions written
   * before this field existed.
   */
  moduleNumber?: number | null;
}

export type AudioOverviewSpeaker = 'teacher' | 'classmate';

export interface AudioOverviewTurn {
  speaker: AudioOverviewSpeaker;
  text: string;
  /** Object path in the `learner-exports` Storage bucket. Absent until synthesized. */
  storagePath?: string;
  format?: string;
}

export interface AudioOverviewData {
  status: 'pending' | 'ready' | 'failed';
  turns?: AudioOverviewTurn[];
  errorMessage?: string;
}

export interface TextbookChaptersData {
  /** 2-4 sentences, "what this book covers." Empty if generation failed. */
  wholeBookSummary: string;
  items: IngestedChapter[];
  audioOverview: AudioOverviewData;
}
