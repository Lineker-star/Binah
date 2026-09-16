/**
 * Skills-acquired synthesis for a course-completion certificate — a real
 * LLM call turning a course's lesson/chapter topics into a short list of
 * concrete, resume-worthy skills (not just a restated table of contents).
 * Mirrors lib/server/recommendations.ts's shape: injectable model via
 * resolveModelFromRequest, JSON-only response, never throws (a failure
 * here means no skills_acquired, not a failed certificate).
 */
import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { parseJsonResponse } from '@binah/generation';
import { createLogger } from '@/lib/logger';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';

const log = createLogger('CertificateSkillsGenerator');

interface GeneratedSkills {
  skills: string[];
}

function buildSkillsPrompt(
  courseTitle: string,
  topics: string[],
  description: string | null,
): { system: string; user: string } {
  const system = `You are writing the "skills acquired" line for a course-completion certificate. Given the course's lesson/chapter topics, write a short list of concrete skills the learner demonstrated — specific and resume-worthy, not a repeat of the topic titles themselves. Return ONLY valid JSON, no markdown or explanation.`;

  const parts = [`Course: "${courseTitle}"`];
  if (description) parts.push(`Course description: ${description}`);
  parts.push(`Topics covered:\n${topics.map((t) => `- ${t}`).join('\n')}`);

  const user = `${parts.join('\n\n')}

Write 3-6 short skill phrases (each under 8 words) this learner can list as skills acquired from this course.

Return a JSON object with this exact structure:
{
  "skills": ["string", "..."]
}`;

  return { system, user };
}

export async function generateSkillsAcquired(
  req: NextRequest,
  courseTitle: string,
  topics: string[],
  description: string | null,
): Promise<string[] | null> {
  try {
    if (topics.length === 0) return null;

    const {
      model: languageModel,
      thinkingConfig,
      fallbackModels,
    } = await resolveModelFromRequest(req, {}, 'certificate-skills');

    const prompt = buildSkillsPrompt(courseTitle, topics, description);
    const response = await callLLM(
      { model: languageModel, system: prompt.system, prompt: prompt.user },
      'certificate-skills',
      { fallbackModels },
      thinkingConfig,
    );

    const parsed = parseJsonResponse<GeneratedSkills>(response.text, { logger: log });
    if (!parsed || !Array.isArray(parsed.skills) || parsed.skills.length === 0) {
      log.error('Failed to parse skills response:', response.text.slice(0, 500));
      return null;
    }
    const skills = parsed.skills.filter((s) => typeof s === 'string' && s.trim().length > 0);
    return skills.length > 0 ? skills : null;
  } catch (err) {
    log.error('Failed to generate skills acquired (ignored):', err);
    return null;
  }
}
