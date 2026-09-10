import { createClient } from './client';
import { getCurrentTTSConfig } from '@/lib/audio/tts-client-config';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import type { TextbookChaptersData } from '@/lib/textbook/types';

/** Same x-model/x-api-key/x-base-url/x-provider-type headers every other
 *  LLM-backed feature sends (course-final assessment, recommendations,
 *  lecture-notes) — resolveModelFromRequest on the server only ever reads
 *  these from headers, never from the request body. */
function modelConfigHeaders(): Record<string, string> {
  const modelConfig = getCurrentModelConfig();
  const headers: Record<string, string> = {
    'x-model': modelConfig.modelString,
    'x-api-key': modelConfig.apiKey,
  };
  if (modelConfig.baseUrl) headers['x-base-url'] = modelConfig.baseUrl;
  if (modelConfig.providerType) headers['x-provider-type'] = modelConfig.providerType;
  return headers;
}

export type IngestionStatus = 'uploaded' | 'processing' | 'ready' | 'error';

/** Row shape of `public.textbook_ingestions`. */
export interface TextbookIngestion {
  id: string;
  learner_id: string;
  course_id: string | null;
  original_filename: string;
  total_pages: number | null;
  chapters: TextbookChaptersData | null;
  status: IngestionStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/** Upload a PDF and kick off chapter detection + extraction + summaries. Returns the new ingestion id. */
export async function ingestTextbook(file: File): Promise<string> {
  const form = new FormData();
  form.append('pdf', file);
  // No 'Content-Type' header here — the browser must set the multipart
  // boundary itself for a FormData body.
  const res = await fetch('/api/textbook/ingest', {
    method: 'POST',
    headers: modelConfigHeaders(),
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

/** Fetch one ingestion by id, for the signed-in learner's own upload (RLS-scoped). */
export async function fetchIngestion(id: string): Promise<TextbookIngestion | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('textbook_ingestions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as TextbookIngestion | null) ?? null;
}

/** Persist the learner's chapter selection (which sections become lessons) before building the course. */
export async function updateIngestionChapters(
  id: string,
  chapters: TextbookChaptersData,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('textbook_ingestions').update({ chapters }).eq('id', id);
  if (error) throw error;
}

/** Link an ingestion to the course built from it. */
export async function setIngestionCourseId(id: string, courseId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('textbook_ingestions')
    .update({ course_id: courseId })
    .eq('id', id);
  if (error) throw error;
}

export interface SignedAudioOverviewTurn {
  speaker: 'teacher' | 'classmate';
  text: string;
  url: string | null;
}

/** Best-effort: kick off Audio Overview generation using the learner's configured TTS voice. */
export async function generateAudioOverview(ingestionId: string): Promise<void> {
  const ttsConfig = await getCurrentTTSConfig();
  const res = await fetch(`/api/textbook/${ingestionId}/audio-overview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...modelConfigHeaders() },
    body: JSON.stringify({
      ttsProviderId: ttsConfig.providerId,
      ttsModelId: ttsConfig.modelId,
      ttsVoice: ttsConfig.voice,
      ttsSpeed: ttsConfig.speed,
      ttsApiKey: ttsConfig.apiKey,
      ttsBaseUrl: ttsConfig.baseUrl,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
}

/** Fetch freshly-signed playback URLs for an already-generated Audio Overview. */
export async function fetchAudioOverview(
  ingestionId: string,
): Promise<{ status: 'pending' | 'ready' | 'failed'; turns: SignedAudioOverviewTurn[] }> {
  const res = await fetch(`/api/textbook/${ingestionId}/audio-overview`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json();
}
