import { createClient } from './client';

/** Row shape of `public.generated_artifacts`. */
export interface GeneratedArtifact {
  id: string;
  learner_id: string;
  session_id: string | null;
  course_id: string | null;
  artifact_type: string;
  storage_path: string | null;
  file_size_bytes: number | null;
  generated_at: string;
}

/** List the signed-in learner's own generated artifacts, most recent first. */
export async function listGeneratedArtifacts(): Promise<GeneratedArtifact[]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('generated_artifacts')
    .select('*')
    .eq('learner_id', user.id)
    .order('generated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as GeneratedArtifact[];
}

/** Get a short-lived signed download URL for one of the learner's own artifacts. */
export async function getArtifactDownloadUrl(artifactId: string): Promise<string> {
  const res = await fetch(`/api/artifacts/${artifactId}/download`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as { url: string };
  return data.url;
}
