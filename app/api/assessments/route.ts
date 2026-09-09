import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

const log = createLogger('AssessmentsAPI');

const ASSESSMENT_TYPES = ['quiz', 'pbl'] as const;
type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

interface AssessmentRequest {
  assessmentType: AssessmentType;
  sessionId?: string | null;
  sceneId?: string | null;
  score?: number | null;
  maxScore?: number | null;
  feedback?: string | null;
  strengths?: string[];
  areasToImprove?: string[];
  evaluatedBy: string;
}

/**
 * POST /api/assessments
 *
 * Records one assessment (quiz grading or PBL evaluation) and refreshes the
 * learner's `learning_metrics` row in the same request. Both writes go
 * through the service-role client server-side only:
 *
 * - The insert could go through the learner's own anon-key session — RLS
 *   (`assessments_insert_own`) already allows it — but doing both writes
 *   through one client keeps this one request atomic-ish instead of a
 *   client-driven insert-then-recompute that can drift if the second call
 *   never fires (network drop, tab closed).
 * - `recompute_learning_metrics` has no internal `auth.uid()` check — it
 *   trusts whatever `learner_id` it's given — so it must never be reachable
 *   from the browser with an arbitrary id. This route is the only caller,
 *   and it always passes the id from the caller's OWN authenticated
 *   session, never from the request body.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      // Anonymous / local-only courses have nothing to record against.
      // Fire-and-forget callers treat this the same as any other failure.
      return apiError('INVALID_REQUEST', 401, 'Not signed in');
    }

    const body = (await req.json()) as AssessmentRequest;
    if (!ASSESSMENT_TYPES.includes(body.assessmentType)) {
      return apiError('INVALID_REQUEST', 400, "assessmentType must be 'quiz' or 'pbl'");
    }
    if (!body.evaluatedBy || typeof body.evaluatedBy !== 'string') {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'evaluatedBy is required');
    }

    const admin = createServiceRoleClient();

    const { error: insertError } = await admin.from('assessments').insert({
      learner_id: user.id,
      session_id: body.sessionId ?? null,
      scene_id: body.sceneId ?? null,
      assessment_type: body.assessmentType,
      score: body.score ?? null,
      max_score: body.maxScore ?? null,
      feedback: body.feedback ?? null,
      strengths: body.strengths ?? null,
      areas_to_improve: body.areasToImprove ?? null,
      evaluated_by: body.evaluatedBy,
    });
    if (insertError) throw insertError;

    const { error: recomputeError } = await admin.rpc('recompute_learning_metrics', {
      p_learner_id: user.id,
    });
    if (recomputeError) {
      // The assessment itself is durably recorded; a stale metrics row is
      // recoverable (the next assessment recomputes it), so this doesn't
      // fail the request — but it must be visible in logs.
      log.error('Assessment recorded but metrics recompute failed:', recomputeError);
    }

    return apiSuccess({ recorded: true });
  } catch (error) {
    log.error('Failed to record assessment:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to record assessment',
    );
  }
}
