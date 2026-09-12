/**
 * Heuristic (non-LLM) scan of a learner's free-text course prompt for a
 * requested lesson count — e.g. "teach me X in 10 lessons" or "as many
 * lessons and presentations as possible". Used to pre-fill the Structured
 * Course lesson-count field the moment the mode toggles on, so a stated
 * depth preference actually does something instead of being silently
 * ignored (the field previously had no connection to the prompt text at
 * all — see app/page.tsx).
 *
 * Client-side and instant by design, not an LLM call: the target is a
 * single already-visible, already-editable number input (2-30, see
 * COURSE_LESSON_COUNT_RANGE in app/page.tsx), not a decision that needs
 * natural-language nuance beyond "a number" or "a maximize phrase".
 * Returns null when no signal is found — the caller leaves the field at
 * its current value in that case.
 */

/** The suggested lesson count for a "as many as possible" style request
 *  with no explicit number — generous relative to the 8-lesson default,
 *  but well short of the field's own 30-lesson ceiling, which stays a
 *  learner-chosen upper bound rather than an automatic one. */
export const MAXIMIZE_DEPTH_SUGGESTION = 15;

const LESSON_UNIT = '(?:lessons?|sessions?|classes|modules|presentations?|parts?|chapters?)';

/** "10 lessons", "in 5 sessions", "12-lesson course", "8 presentations" */
const EXPLICIT_NUMBER_PATTERN = new RegExp(`\\b(\\d{1,3})(?:\\s*-)?\\s*${LESSON_UNIT}\\b`, 'i');

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
};

const EXPLICIT_NUMBER_WORD_PATTERN = new RegExp(
  `\\b(${Object.keys(NUMBER_WORDS).join('|')})\\s+${LESSON_UNIT}\\b`,
  'i',
);

const MAXIMIZE_PATTERNS: RegExp[] = [
  // Non-greedy middle so "as many lessons AND presentations as possible"
  // (multiple units joined by "and"/commas) still matches, not just a
  // single optional unit word.
  /as many\b.{0,40}?\bas possible/i,
  /as (?:much|comprehensive|thorough|in-?depth|detailed) as possible/i,
  /\bcover(?:ing)?\s+everything\b/i,
  /\bcomprehensive(?:ly)?\b/i,
  /\bin[- ]depth\b/i,
  /\bmaximum depth\b/i,
  /\bas (?:in-?depth|thorough) as (?:you can|possible)\b/i,
];

/** A requested lesson count parsed from free text, or null if no signal is found. */
export function parseDepthSignal(promptText: string): number | null {
  const text = promptText.trim();
  if (!text) return null;

  const numberMatch = text.match(EXPLICIT_NUMBER_PATTERN);
  if (numberMatch) {
    const n = parseInt(numberMatch[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const wordMatch = text.match(EXPLICIT_NUMBER_WORD_PATTERN);
  if (wordMatch) {
    const n = NUMBER_WORDS[wordMatch[1].toLowerCase()];
    if (n) return n;
  }

  if (MAXIMIZE_PATTERNS.some((pattern) => pattern.test(text))) {
    return MAXIMIZE_DEPTH_SUGGESTION;
  }

  return null;
}
