import { createClient } from './client';

/** System-wide activity counts, summed across every account. */
export interface AdminActivityTotals {
  sessionsCreated: number;
  sessionsCompleted: number;
  assessmentsTaken: number;
  certificatesIssued: number;
  exportsCreated: number;
  downloadsRecorded: number;
  videoExportsCreated: number;
  videoExportsDownloaded: number;
}

/** One account's row in the activity breakdown table. */
export interface AdminActivityRow {
  learnerId: string;
  displayName: string | null;
  sessionsCreated: number;
  sessionsCompleted: number;
  assessmentsTaken: number;
  /** Raw average `assessments.score` (not normalized to max_score) — same convention as the per-learner admin detail page. */
  avgAssessmentScore: number | null;
  certificatesIssued: number;
  exportsCreated: number;
  downloadsRecorded: number;
}

const CERTIFICATE_ARTIFACT_TYPES = new Set(['certificate', 'certificate_excellence']);

/**
 * System-wide activity report: sessions, assessments, certificates, and
 * exports/downloads across every account. Entirely plain reads merged in
 * JS (same convention as fetchAllLearnerProfiles/fetchLearnerDetail) — every
 * table involved already has an `*_admin_all` RLS policy gated on
 * `is_admin()`, so no service-role client or new SQL view is needed.
 *
 * Sessions/assessment-count rollups reuse `learning_metrics` (already
 * maintained by `recompute_learning_metrics`) rather than re-deriving from
 * `learning_sessions`. Certificates/exports come from `generated_artifacts`,
 * split by `artifact_type`. Downloads and video exports come from the two
 * new tables added alongside this feature — `artifact_downloads` and
 * `video_export_events` — since neither had any DB footprint before.
 */
export async function fetchAdminActivity(): Promise<{
  totals: AdminActivityTotals;
  rows: AdminActivityRow[];
}> {
  const supabase = createClient();

  const [
    { data: profiles, error: profilesError },
    { data: metrics, error: metricsError },
    { data: assessmentRows, error: assessmentsError },
    { data: artifactRows, error: artifactsError },
    { data: downloadRows, error: downloadsError },
    { data: videoEventRows, error: videoEventsError },
  ] = await Promise.all([
    supabase.from('profiles').select('id, display_name'),
    supabase.from('learning_metrics').select('learner_id, total_sessions, sessions_completed'),
    supabase.from('assessments').select('learner_id, score'),
    supabase.from('generated_artifacts').select('learner_id, artifact_type'),
    supabase.from('artifact_downloads').select('learner_id'),
    supabase.from('video_export_events').select('learner_id, event'),
  ]);
  if (profilesError) throw profilesError;
  if (metricsError) throw metricsError;
  if (assessmentsError) throw assessmentsError;
  if (artifactsError) throw artifactsError;
  if (downloadsError) throw downloadsError;
  if (videoEventsError) throw videoEventsError;

  const metricsById = new Map(
    (metrics ?? []).map((m) => [
      m.learner_id as string,
      { total: m.total_sessions as number, completed: m.sessions_completed as number },
    ]),
  );

  const assessmentsById = new Map<string, { count: number; scoreSum: number; scoreCount: number }>();
  for (const a of assessmentRows ?? []) {
    const id = a.learner_id as string;
    const entry = assessmentsById.get(id) ?? { count: 0, scoreSum: 0, scoreCount: 0 };
    entry.count += 1;
    if (a.score != null) {
      entry.scoreSum += a.score as number;
      entry.scoreCount += 1;
    }
    assessmentsById.set(id, entry);
  }

  const certificatesById = new Map<string, number>();
  const exportsById = new Map<string, number>();
  for (const artifact of artifactRows ?? []) {
    const id = artifact.learner_id as string;
    const type = artifact.artifact_type as string;
    const target = CERTIFICATE_ARTIFACT_TYPES.has(type) ? certificatesById : exportsById;
    target.set(id, (target.get(id) ?? 0) + 1);
  }

  const downloadsById = new Map<string, number>();
  for (const d of downloadRows ?? []) {
    const id = d.learner_id as string;
    downloadsById.set(id, (downloadsById.get(id) ?? 0) + 1);
  }

  let videoExportsCreated = 0;
  let videoExportsDownloaded = 0;
  for (const v of videoEventRows ?? []) {
    if (v.event === 'created') videoExportsCreated += 1;
    else if (v.event === 'downloaded') videoExportsDownloaded += 1;
  }

  const rows: AdminActivityRow[] = (profiles ?? []).map((p) => {
    const id = p.id as string;
    const m = metricsById.get(id);
    const a = assessmentsById.get(id);
    return {
      learnerId: id,
      displayName: p.display_name as string | null,
      sessionsCreated: m?.total ?? 0,
      sessionsCompleted: m?.completed ?? 0,
      assessmentsTaken: a?.count ?? 0,
      avgAssessmentScore: a && a.scoreCount > 0 ? a.scoreSum / a.scoreCount : null,
      certificatesIssued: certificatesById.get(id) ?? 0,
      exportsCreated: exportsById.get(id) ?? 0,
      downloadsRecorded: downloadsById.get(id) ?? 0,
    };
  });

  rows.sort(
    (a, b) =>
      b.sessionsCreated +
      b.assessmentsTaken +
      b.certificatesIssued +
      b.exportsCreated -
      (a.sessionsCreated + a.assessmentsTaken + a.certificatesIssued + a.exportsCreated),
  );

  const totals = rows.reduce<AdminActivityTotals>(
    (acc, r) => {
      acc.sessionsCreated += r.sessionsCreated;
      acc.sessionsCompleted += r.sessionsCompleted;
      acc.assessmentsTaken += r.assessmentsTaken;
      acc.certificatesIssued += r.certificatesIssued;
      acc.exportsCreated += r.exportsCreated;
      acc.downloadsRecorded += r.downloadsRecorded;
      return acc;
    },
    {
      sessionsCreated: 0,
      sessionsCompleted: 0,
      assessmentsTaken: 0,
      certificatesIssued: 0,
      exportsCreated: 0,
      downloadsRecorded: 0,
      videoExportsCreated,
      videoExportsDownloaded,
    },
  );

  return { totals, rows };
}
