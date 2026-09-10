/**
 * POST /api/textbook/[id]/audio-overview — generate the optional "Audio
 * Overview": a short scripted teacher/classmate dialogue introducing the
 * book (see lib/server/textbook/audio-overview-script.ts for the
 * deterministic-alternation script generator), synthesized per-turn via
 * the existing TTS pipeline and stored in the learner-exports bucket
 * alongside course exports. Best-effort and separate from the main
 * ingestion call — a failure here leaves the rest of the Chapter Review
 * screen intact, it just means no audio card.
 *
 * GET on the same route returns freshly-signed playback URLs for any
 * already-synthesized turns — signed on demand rather than stored, since a
 * stored signed URL would eventually expire.
 */
import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { generateAudioOverviewScript } from '@/lib/server/textbook/audio-overview-script';
import { generateTTS } from '@/lib/audio/tts-providers';
import { getTTSVoices } from '@/lib/audio/constants';
import {
  isServerConfiguredProvider,
  resolveTTSApiKey,
  resolveTTSBaseUrl,
  resolveTTSModel,
} from '@/lib/server/provider-config';
import type { TTSProviderId } from '@/lib/audio/types';
import type { AudioOverviewTurn, TextbookChaptersData } from '@/lib/textbook/types';

const log = createLogger('AudioOverviewAPI');

const SIGNED_URL_TTL_SECONDS = 300;

interface RequestBody {
  ttsProviderId: TTSProviderId;
  ttsModelId?: string;
  ttsVoice: string;
  ttsSpeed?: number;
  ttsApiKey?: string;
  ttsBaseUrl?: string;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return apiError('INVALID_REQUEST', 401, 'Not signed in');
    }

    const { data: ingestion, error } = await supabase
      .from('textbook_ingestions')
      .select('chapters')
      .eq('id', id)
      .eq('learner_id', user.id)
      .maybeSingle();
    if (error) throw error;
    if (!ingestion) {
      return apiError('INVALID_REQUEST', 404, 'Ingestion not found');
    }
    const chaptersData = ingestion.chapters as TextbookChaptersData | null;
    const overview = chaptersData?.audioOverview ?? { status: 'pending' as const };
    if (overview.status !== 'ready' || !overview.turns?.length) {
      return apiSuccess({ status: overview.status, turns: [] });
    }

    const admin = createServiceRoleClient();
    const signed = await Promise.all(
      overview.turns.map(async (turn) => {
        if (!turn.storagePath) return { speaker: turn.speaker, text: turn.text, url: null };
        const { data, error: signError } = await admin.storage
          .from('learner-exports')
          .createSignedUrl(turn.storagePath, SIGNED_URL_TTL_SECONDS);
        if (signError) {
          log.warn(`Failed to sign audio overview turn URL (${turn.storagePath}):`, signError);
          return { speaker: turn.speaker, text: turn.text, url: null };
        }
        return { speaker: turn.speaker, text: turn.text, url: data?.signedUrl ?? null };
      }),
    );

    return apiSuccess({ status: 'ready', turns: signed });
  } catch (error) {
    log.error('Failed to sign audio overview URLs:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to load audio overview',
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return apiError('INVALID_REQUEST', 401, 'Not signed in');
    }

    const { data: ingestion, error } = await supabase
      .from('textbook_ingestions')
      .select('id, learner_id, original_filename, chapters')
      .eq('id', id)
      .eq('learner_id', user.id)
      .maybeSingle();
    if (error) throw error;
    if (!ingestion) {
      return apiError('INVALID_REQUEST', 404, 'Ingestion not found');
    }
    const chaptersData = ingestion.chapters as TextbookChaptersData | null;
    if (!chaptersData?.wholeBookSummary) {
      return apiError('INVALID_REQUEST', 400, 'Whole-book summary not ready yet');
    }

    const body = (await req.json()) as RequestBody;
    if (!body.ttsProviderId || !body.ttsVoice) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'ttsProviderId and ttsVoice are required');
    }
    if (body.ttsProviderId === 'browser-native-tts') {
      return apiError('INVALID_REQUEST', 400, 'browser-native-tts must be handled client-side');
    }

    const managed = isServerConfiguredProvider('tts', body.ttsProviderId);
    const apiKey = resolveTTSApiKey(body.ttsProviderId, managed ? undefined : body.ttsApiKey);
    const baseUrl = resolveTTSBaseUrl(body.ttsProviderId, managed ? undefined : body.ttsBaseUrl);
    const modelId = resolveTTSModel(body.ttsProviderId, body.ttsModelId, body.ttsVoice);

    // A second, distinct voice for the classmate persona when the provider
    // offers one; otherwise both personas share the learner's configured voice.
    const voices = getTTSVoices(body.ttsProviderId);
    const classmateVoice = voices.find((v) => v.id !== body.ttsVoice)?.id ?? body.ttsVoice;
    const voiceFor = (speaker: 'teacher' | 'classmate') =>
      speaker === 'teacher' ? body.ttsVoice : classmateVoice;

    const script = await generateAudioOverviewScript(
      req,
      ingestion.original_filename as string,
      chaptersData.wholeBookSummary,
    );
    if (script.length === 0) {
      throw new Error('Audio overview script generation produced no turns');
    }

    const admin = createServiceRoleClient();
    const turns: AudioOverviewTurn[] = [];
    for (let i = 0; i < script.length; i++) {
      const turn = script[i];
      try {
        const { audio, format } = await generateTTS(
          {
            providerId: body.ttsProviderId,
            modelId,
            voice: voiceFor(turn.speaker),
            speed: body.ttsSpeed ?? 1,
            apiKey,
            baseUrl,
          },
          turn.text,
        );
        const objectPath = `${user.id}/${id}/audio-overview/${i}.${format}`;
        const { error: uploadError } = await admin.storage
          .from('learner-exports')
          .upload(objectPath, audio, { contentType: `audio/${format}`, upsert: true });
        if (uploadError) throw uploadError;
        turns.push({ speaker: turn.speaker, text: turn.text, storagePath: objectPath, format });
      } catch (err) {
        log.error(`Failed to synthesize audio overview turn ${i} (continuing without it):`, err);
      }
    }

    if (turns.length === 0) {
      await admin
        .from('textbook_ingestions')
        .update({
          chapters: {
            ...chaptersData,
            audioOverview: { status: 'failed', errorMessage: 'TTS synthesis failed for every turn' },
          },
        })
        .eq('id', id);
      return apiError('GENERATION_FAILED', 500, 'Failed to synthesize any audio overview turns');
    }

    const updatedChapters: TextbookChaptersData = {
      ...chaptersData,
      audioOverview: { status: 'ready', turns },
    };
    const { error: updateError } = await admin
      .from('textbook_ingestions')
      .update({ chapters: updatedChapters })
      .eq('id', id);
    if (updateError) throw updateError;

    return apiSuccess({ ready: true, turnCount: turns.length });
  } catch (error) {
    log.error('Audio overview generation failed:', error);
    try {
      const admin = createServiceRoleClient();
      const { data: current } = await admin
        .from('textbook_ingestions')
        .select('chapters')
        .eq('id', id)
        .maybeSingle();
      const chaptersData = current?.chapters as TextbookChaptersData | undefined;
      if (chaptersData) {
        await admin
          .from('textbook_ingestions')
          .update({
            chapters: {
              ...chaptersData,
              audioOverview: {
                status: 'failed',
                errorMessage: error instanceof Error ? error.message : 'Audio overview generation failed',
              },
            },
          })
          .eq('id', id);
      }
    } catch (updateErr) {
      log.error('Failed to record audio overview error state:', updateErr);
    }
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to generate audio overview',
    );
  }
}
