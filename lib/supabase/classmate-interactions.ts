import { createClient } from './server';
import type { CollaborationSignal } from '@/lib/orchestration/types';
import { createLogger } from '@/lib/logger';

const log = createLogger('ClassmateInteractions');

/**
 * Log one AI-classmate ('student'-role agent) turn into
 * `ai_classmate_interactions`, for later analysis of whether the AI
 * classmates are actually behaving collaboratively over time.
 *
 * Server-only: uses the request's cookie-based Supabase session so the
 * insert passes `ai_interactions_owner` RLS (`auth.uid() = learner_id`) —
 * the caller must already have resolved `learnerId` from that same session,
 * never from client input.
 *
 * Callers invoke this fire-and-forget (`void logClassmateInteraction(...)`)
 * so it never delays or fails the turn being streamed to the learner. A
 * failure is still surfaced via `log.error` here, since nothing else awaits
 * this promise to notice it otherwise.
 */
export async function logClassmateInteraction(input: {
  sessionId: string;
  learnerId: string;
  classmatePersona: string;
  messageSummary: string;
  collaborationSignal: CollaborationSignal;
}): Promise<void> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from('ai_classmate_interactions').insert({
      session_id: input.sessionId,
      learner_id: input.learnerId,
      classmate_persona: input.classmatePersona,
      turn_role: 'ai_classmate',
      message_summary: input.messageSummary,
      collaboration_signal: input.collaborationSignal,
    });
    if (error) throw error;
  } catch (err) {
    log.error('Failed to log classmate interaction:', err);
  }
}
