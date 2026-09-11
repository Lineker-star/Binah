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
import { getEnabledProvidersWithVoices, resolveDeterministicFallbackVoice } from '@/lib/audio/voice-resolver';
import type { TTSEnablementConfig } from '@/lib/audio/provider-enablement';
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
  /**
   * Every provider's config, not just the selected one -- needed to compute
   * a fallback candidate list when the selected provider fails (see the
   * per-turn retry below). Audio Overview has no course-level narrator
   * agent to check first (it runs before any course/lessons exist), so
   * unlike lesson narration it can't lean on a voice binding; this is the
   * layer that still applies without one.
   */
  ttsProvidersConfig?: Record<string, TTSEnablementConfig & { modelId?: string }>;
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

    const synthesize = (
      providerId: TTSProviderId,
      voice: string,
      voiceModelId: string | undefined,
      voiceApiKey: string | undefined,
      voiceBaseUrl: string | undefined,
      text: string,
    ) =>
      generateTTS(
        {
          providerId,
          modelId: voiceModelId,
          voice,
          speed: body.ttsSpeed ?? 1,
          apiKey: voiceApiKey,
          baseUrl: voiceBaseUrl,
        },
        text,
      );

    const admin = createServiceRoleClient();
    const turns: AudioOverviewTurn[] = [];
    for (let i = 0; i < script.length; i++) {
      const turn = script[i];
      try {
        let synthesized: Awaited<ReturnType<typeof generateTTS>>;
        try {
          synthesized = await synthesize(
            body.ttsProviderId,
            voiceFor(turn.speaker),
            modelId,
            apiKey,
            baseUrl,
            turn.text,
          );
        } catch (primaryErr) {
          // Audio Overview has no course-level narrator binding to lean on
          // (it runs before any course/lessons exist, unlike lesson
          // narration -- see lib/hooks/use-scene-generator.ts) -- this is
          // the layer that substitutes for it: one reactive retry against a
          // different enabled provider, excluding whichever one just
          // failed, rather than just recording the turn as failed. No
          // change to provider ordering/preference beyond this.
          const fallback = resolveDeterministicFallbackVoice(
            getEnabledProvidersWithVoices(body.ttsProvidersConfig ?? {}).filter(
              (p) => p.providerId !== body.ttsProviderId,
            ),
            0,
          );
          if (!fallback) throw primaryErr;

          log.warn(
            `Turn ${i} failed on ${body.ttsProviderId}, retrying once with ${fallback.providerId}:`,
            primaryErr,
          );
          const fallbackManaged = isServerConfiguredProvider('tts', fallback.providerId);
          const fallbackConfig = body.ttsProvidersConfig?.[fallback.providerId];
          const fallbackApiKey = resolveTTSApiKey(
            fallback.providerId,
            fallbackManaged ? undefined : fallbackConfig?.apiKey,
          );
          const fallbackBaseUrl = resolveTTSBaseUrl(
            fallback.providerId,
            fallbackManaged ? undefined : fallbackConfig?.baseUrl,
          );
          const fallbackModelId = resolveTTSModel(
            fallback.providerId,
            fallback.modelId,
            fallback.voiceId,
          );
          const fallbackVoices = getTTSVoices(fallback.providerId);
          const fallbackClassmateVoice =
            fallbackVoices.find((v) => v.id !== fallback.voiceId)?.id ?? fallback.voiceId;
          const fallbackVoiceFor = (speaker: 'teacher' | 'classmate') =>
            speaker === 'teacher' ? fallback.voiceId : fallbackClassmateVoice;

          synthesized = await synthesize(
            fallback.providerId,
            fallbackVoiceFor(turn.speaker),
            fallbackModelId,
            fallbackApiKey,
            fallbackBaseUrl,
            turn.text,
          );
        }

        const { audio, format } = synthesized;
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
