/**
 * POST /api/artifacts/lecture-notes — synthesizes a lesson's key points
 * (via LLM, from the same narration text the existing Script export
 * already collects client-side) into a short PDF, using `pdf-lib` (already
 * a dependency; there is no other PDF-generation tooling in this app).
 *
 * Not just the full slide export: the LLM condenses the narration into an
 * overview + key points rather than reproducing it verbatim.
 */
import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { parseJsonResponse } from '@openmaic/generation';
import { createLogger } from '@/lib/logger';
import { apiError } from '@/lib/server/api-response';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import { buildLectureNotesPdf } from '@/lib/artifacts/lecture-notes-pdf';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

const log = createLogger('LectureNotesAPI');

interface RequestBody {
  title?: string;
  lessonText: string;
  sessionId?: string | null;
  courseId?: string | null;
  /** Set for a chapter-level export (multiple lessons' narration bundled
   *  into one lessonText) instead of sessionId — see
   *  lib/export/lesson-chapter-export.ts. */
  chapterId?: string | null;
}

interface SynthesizedNotes {
  overview: string;
  keyPoints: string[];
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RequestBody;
    if (!body.lessonText || typeof body.lessonText !== 'string') {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'lessonText is required');
    }
    const title = body.title?.trim() || 'Lecture Notes';

    const {
      model: languageModel,
      thinkingConfig,
      fallbackModels,
    } = await resolveModelFromRequest(req, body, 'lecture-notes');

    const system = `You are a teaching assistant creating lecture notes from a lesson's narration script. Produce a concise, well-organized summary of the lesson's key points -- not a verbatim copy of the narration. Return ONLY valid JSON, no markdown or explanation.`;
    const user = `Lesson: "${title}"

Narration script:
${body.lessonText}

Summarize this into lecture notes covering the lesson's actual content.

Return a JSON object with this exact structure:
{
  "overview": "string (2-4 sentences)",
  "keyPoints": ["string", "..."]
}`;

    const response = await callLLM(
      { model: languageModel, system, prompt: user },
      'lecture-notes',
      { fallbackModels },
      thinkingConfig,
    );

    const parsed = parseJsonResponse<SynthesizedNotes>(response.text, { logger: log });
    if (!parsed || typeof parsed.overview !== 'string' || !Array.isArray(parsed.keyPoints)) {
      log.error('Failed to parse lecture notes response:', response.text.slice(0, 500));
      return apiError('PARSE_FAILED', 500, 'Failed to synthesize lecture notes');
    }

    const pdfBytes = await buildLectureNotesPdf({
      title,
      overview: parsed.overview,
      keyPoints: parsed.keyPoints,
    });

    // Best-effort permanent record. A signed-out visitor still gets the PDF
    // back below — there's just no learner to attach a generated_artifacts
    // row to, same as every other export format.
    const supabase = await createServerClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (authUser) {
      try {
        const admin = createServiceRoleClient();
        const objectPath = `${authUser.id}/${crypto.randomUUID()}.pdf`;
        const { error: uploadError } = await admin.storage
          .from('learner-exports')
          .upload(objectPath, pdfBytes, { contentType: 'application/pdf' });
        if (uploadError) throw uploadError;
        const { error: insertError } = await admin.from('generated_artifacts').insert({
          learner_id: authUser.id,
          session_id: body.sessionId ?? null,
          course_id: body.courseId ?? null,
          chapter_id: body.chapterId ?? null,
          artifact_type: 'lecture_notes_pdf',
          storage_path: objectPath,
          file_size_bytes: pdfBytes.byteLength,
        });
        if (insertError) throw insertError;
      } catch (err) {
        log.error('Lecture notes generated but failed to record artifact (ignored):', err);
      }
    }

    return new Response(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${title.replace(/[^\w.-]+/g, '_')}.pdf"`,
      },
    });
  } catch (error) {
    log.error('Failed to generate lecture notes:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to generate lecture notes',
    );
  }
}
