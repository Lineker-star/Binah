/**
 * Audio Overview script generation — a short (~6-turn, 2-3 minute)
 * scripted dialogue between a teacher and a classmate persona introducing
 * a book, grounded in its whole-book summary.
 *
 * Deliberately bypasses `lib/orchestration/director-graph.ts`: that graph
 * caps at one director->agent cycle per invocation (a live client drives
 * further turns), and past turn 0 its turn-taking goes through an LLM
 * "director" node whose prompt assumes a live, human-present classroom —
 * neither fits "generate exactly N alternating turns and stop" for a
 * standalone script with no session/scene. This builds the alternation in
 * code instead, calling `callLLM` directly per turn — the same primitive
 * every other one-shot generation in this app already uses.
 */
import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { createLogger } from '@/lib/logger';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';

const log = createLogger('AudioOverviewScript');

export type OverviewSpeaker = 'teacher' | 'classmate';

export interface OverviewScriptTurn {
  speaker: OverviewSpeaker;
  text: string;
}

/** Classmate opens and closes; six turns keeps this to roughly 2-3 minutes spoken aloud. */
const SPEAKER_ORDER: OverviewSpeaker[] = [
  'classmate',
  'teacher',
  'classmate',
  'teacher',
  'classmate',
  'teacher',
];

const TEACHER_SYSTEM = `You are a warm, knowledgeable teacher recording a short podcast-style audio overview that introduces a textbook to a new student. Answer the classmate's question and share what's genuinely useful or interesting about the book. Speak naturally, as you would out loud -- 2-3 sentences, no markdown, no stage directions, no headers.`;

const CLASSMATE_SYSTEM = `You are a curious, friendly classmate recording a short podcast-style audio overview that introduces a textbook to a new student. Ask genuine, engaged questions and react naturally to what the teacher says. Speak naturally, as you would out loud -- 2-3 sentences, no markdown, no stage directions, no headers.`;

function formatTranscript(turns: OverviewScriptTurn[]): string {
  return turns
    .map((t) => `${t.speaker === 'teacher' ? 'Teacher' : 'Classmate'}: ${t.text}`)
    .join('\n');
}

function buildTurnPrompt(
  bookTitle: string,
  wholeBookSummary: string,
  turns: OverviewScriptTurn[],
  turnIndex: number,
  totalTurns: number,
): string {
  const isFirst = turnIndex === 0;
  const isLast = turnIndex === totalTurns - 1;
  const grounding = `Book: "${bookTitle}"\nWhat this book covers: ${wholeBookSummary}`;

  if (isFirst) {
    return `${grounding}\n\nOpen a short audio overview introducing this book. Ask the teacher an inviting opening question about what it covers or who it's for.`;
  }

  const transcript = formatTranscript(turns);
  const closing = isLast
    ? ' This is the final turn of the conversation -- wrap up warmly and invite the listener to dive in.'
    : '';
  return `${grounding}\n\nConversation so far:\n${transcript}\n\nRespond naturally to what was just said, staying grounded in the book summary above.${closing}`;
}

/**
 * Generate the fixed-length alternating script. Each turn is its own
 * `callLLM` call with the running transcript as context -- deterministic
 * speaker order, no director/graph involved.
 */
export async function generateAudioOverviewScript(
  req: NextRequest,
  bookTitle: string,
  wholeBookSummary: string,
): Promise<OverviewScriptTurn[]> {
  const turns: OverviewScriptTurn[] = [];

  for (let i = 0; i < SPEAKER_ORDER.length; i++) {
    const speaker = SPEAKER_ORDER[i];
    const system = speaker === 'teacher' ? TEACHER_SYSTEM : CLASSMATE_SYSTEM;
    const user = buildTurnPrompt(bookTitle, wholeBookSummary, turns, i, SPEAKER_ORDER.length);

    const {
      model: languageModel,
      thinkingConfig,
      fallbackModels,
    } = await resolveModelFromRequest(req, {}, 'audio-overview-script');
    const response = await callLLM(
      { model: languageModel, system, prompt: user },
      'audio-overview-script',
      { fallbackModels },
      thinkingConfig,
    );

    const text = response.text.trim();
    if (!text) {
      log.warn(`Empty response for audio overview turn ${i} (${speaker}); stopping script early.`);
      break;
    }
    turns.push({ speaker, text });
  }

  return turns;
}
