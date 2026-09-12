import type { SceneOutline } from '@/lib/types/generation';

export type RecapLevel = 'lesson' | 'chapter' | 'module';

const RECAP_HEADING: Record<RecapLevel, string> = {
  lesson: 'Quick Recap',
  chapter: 'Chapter Recap',
  module: 'Module Recap',
};

const RECAP_SCOPE: Record<RecapLevel, string> = {
  lesson: 'the previous lesson',
  chapter: 'the previous chapter',
  module: 'the previous module',
};

/**
 * A deterministic, non-LLM-authored outline for a brief "welcome back"
 * recap scene — reuses the DSL's existing 'slide' type rather than a new
 * scene type (there is no dedicated recap/summary type, and the DSL's
 * SceneType union is closed/exhaustiveness-checked — a recap is
 * structurally just a short slide). Prepended to a lesson's outline array
 * once fresh outlines land (see app/generation-preview/page.tsx) so it
 * flows through the exact same content-generation path as any other slide
 * scene — generateSlideContent still does the actual LLM call, turning
 * these keyPoints into natural short prose, not a raw bullet dump.
 *
 * `points` is the ONLY grounding: prior lesson's own scene titles for
 * 'lesson', the preceding chapter's own summary for 'chapter', that
 * module's chapters' summaries for 'module' — never invented content.
 * Returns null when there's nothing real to ground it in, rather than
 * inserting a content-free recap.
 */
export function buildRecapOutline(level: RecapLevel, points: string[]): SceneOutline | null {
  const cleaned = points.map((p) => p.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;

  return {
    id: 'recap',
    type: 'slide',
    title: RECAP_HEADING[level],
    description: `A brief recap of what ${RECAP_SCOPE[level]} covered — 2-3 short sentences or bullet points, not a full re-teach — before moving on to new material.`,
    keyPoints: cleaned,
    order: 0,
  };
}
