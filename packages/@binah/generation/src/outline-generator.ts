/**
 * Stage 1: Generate scene outlines from user requirements.
 * Also contains outline fallback logic.
 */

import { nanoid } from 'nanoid';
import { MAX_PDF_CONTENT_CHARS, MAX_VISION_IMAGES } from './constants.js';
import { parseJsonResponse } from './json-repair.js';
import { noopGenerationLogger, type GenerationLogger } from './logger.js';
import {
  formatImageDescription,
  formatImagePlaceholder,
  sortDocumentImagesForVision,
} from './outline-formatters.js';
import { uniquifyMediaElementIds } from './outline-media.js';
import type { ImageMapping, PdfImage, SceneOutline, UserRequirements } from './outline-types.js';
import type { AICallFn, GenerationResult } from './pipeline-types.js';
import { buildPrompt, PROMPT_IDS } from './prompts/index.js';

export const DEFAULT_LANGUAGE_DIRECTIVE =
  'Teach in the language that matches the user requirement.';

export interface OutlinePromptContext {
  pdfText?: string;
  pdfImages?: PdfImage[];
  visionEnabled?: boolean;
  imageMapping?: ImageMapping;
  imageGenerationEnabled?: boolean;
  videoGenerationEnabled?: boolean;
  researchContext?: string;
  teacherContext?: string;
  /** True for a structured-course lesson — strengthens the template's quiz
   *  instruction so a capstone quiz scene is far more likely up front. Does
   *  NOT itself guarantee one; the caller still applies a code-level
   *  fallback after generation (see ensureTrailingQuizOutline). */
  courseMode?: boolean;
}

export interface OutlineGenerationOptions extends Omit<
  OutlinePromptContext,
  'pdfText' | 'pdfImages'
> {
  logger?: GenerationLogger;
}

export interface OutlineFallbackOptions {
  allowProceduralSkill?: boolean;
  logger?: GenerationLogger;
}

function buildAvailableImages(
  pdfImages: PdfImage[] | undefined,
  context: OutlinePromptContext,
): { availableImagesText: string; visionImages?: Array<{ id: string; src: string }> } {
  let availableImagesText = 'No images available';
  let visionImages: Array<{ id: string; src: string }> | undefined;

  if (pdfImages && pdfImages.length > 0) {
    if (context.visionEnabled && context.imageMapping) {
      const sortedImages = sortDocumentImagesForVision(pdfImages);
      const allWithSrc = sortedImages.filter((image) => context.imageMapping![image.id]);
      const visionSlice = allWithSrc.slice(0, MAX_VISION_IMAGES);
      const textOnlySlice = allWithSrc.slice(MAX_VISION_IMAGES);
      const noSrcImages = sortedImages.filter((image) => !context.imageMapping![image.id]);

      const visionDescriptions = visionSlice.map((image) => formatImagePlaceholder(image));
      const textDescriptions = [...textOnlySlice, ...noSrcImages].map((image) =>
        formatImageDescription(image),
      );
      availableImagesText = [...visionDescriptions, ...textDescriptions].join('\n');

      visionImages = visionSlice.map((image) => ({
        id: image.id,
        src: context.imageMapping![image.id],
        width: image.width,
        height: image.height,
      }));
    } else {
      availableImagesText = pdfImages.map((image) => formatImageDescription(image)).join('\n');
    }
  }

  return { availableImagesText, visionImages };
}

/** Build the byte-stable system and user prompts for outline generation. */
export function buildOutlinePrompt(
  requirements: UserRequirements,
  context: OutlinePromptContext = {},
): { system: string; user: string } {
  const { pdfText, pdfImages } = context;
  const { availableImagesText } = buildAvailableImages(pdfImages, context);

  const userProfileText =
    requirements.userNickname || requirements.userBio
      ? `## Student Profile\n\nStudent: ${requirements.userNickname || 'Unknown'}${requirements.userBio ? ` — ${requirements.userBio}` : ''}\n\nConsider this student's background when designing the course. Adapt difficulty, examples, and teaching approach accordingly.\n\n---`
      : '';

  const imageEnabled = context.imageGenerationEnabled ?? false;
  const videoEnabled = context.videoGenerationEnabled ?? false;
  const mediaEnabled = imageEnabled || videoEnabled;
  const hasSourceImages = (pdfImages?.length ?? 0) > 0;

  const prompts = buildPrompt(PROMPT_IDS.REQUIREMENTS_TO_OUTLINES, {
    requirement: requirements.requirement,
    pdfContent: pdfText ? pdfText.substring(0, MAX_PDF_CONTENT_CHARS) : 'None',
    availableImages: availableImagesText,
    userProfile: userProfileText,
    hasSourceImages,
    imageEnabled,
    videoEnabled,
    mediaEnabled,
    researchContext: context.researchContext || 'None',
    teacherContext: context.teacherContext || '',
    courseMode: context.courseMode ?? false,
  });

  if (!prompts) {
    throw new Error('Prompt template not found');
  }

  return prompts;
}

/** Generate scene outlines from user requirements. */
export async function generateSceneOutlinesFromRequirements(
  requirements: UserRequirements,
  pdfText: string | undefined,
  pdfImages: PdfImage[] | undefined,
  aiCall: AICallFn,
  options?: OutlineGenerationOptions,
): Promise<
  GenerationResult<{ languageDirective: string; courseTitle?: string; outlines: SceneOutline[] }>
> {
  const logger = options?.logger ?? noopGenerationLogger;
  const context: OutlinePromptContext = { ...options, pdfText, pdfImages };
  let prompts: { system: string; user: string };

  try {
    prompts = buildOutlinePrompt(requirements, context);
  } catch (error) {
    if (error instanceof Error && error.message === 'Prompt template not found') {
      return { success: false, error: 'Prompt template not found' };
    }
    throw error;
  }

  const { visionImages } = buildAvailableImages(pdfImages, context);

  try {
    const response = await aiCall(prompts.system, prompts.user, visionImages);
    const parsed = parseJsonResponse<
      { languageDirective: string; courseTitle?: string; outlines: SceneOutline[] } | SceneOutline[]
    >(response, { logger });

    let languageDirective: string;
    let courseTitle: string | undefined;
    let rawOutlines: SceneOutline[];

    if (Array.isArray(parsed)) {
      languageDirective = DEFAULT_LANGUAGE_DIRECTIVE;
      rawOutlines = parsed;
    } else if (parsed && parsed.outlines) {
      languageDirective = parsed.languageDirective || DEFAULT_LANGUAGE_DIRECTIVE;
      const rawTitle = parsed.courseTitle;
      courseTitle =
        typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim().slice(0, 120) : undefined;
      rawOutlines = parsed.outlines;
    } else {
      return { success: false, error: 'Failed to parse scene outlines response' };
    }

    if (!Array.isArray(rawOutlines)) {
      return { success: false, error: 'Failed to parse scene outlines response' };
    }

    const enriched = rawOutlines.map((outline, index) => ({
      ...outline,
      id: outline.id || nanoid(),
      order: index + 1,
    }));

    const result = uniquifyMediaElementIds(enriched);

    return { success: true, data: { languageDirective, courseTitle, outlines: result } };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export function sanitizeProceduralSkillOutline(outline: SceneOutline): SceneOutline {
  const widgetOutline = { ...(outline.widgetOutline ?? {}) };
  delete widgetOutline.procedureType;
  delete widgetOutline.task;
  delete widgetOutline.tools;
  delete widgetOutline.steps;
  delete widgetOutline.successCriteria;
  delete widgetOutline.errorConsequences;

  return {
    ...outline,
    type: 'interactive',
    widgetType: 'diagram',
    description: outline.description
      ? `${outline.description} Present this as a process or structure diagram.`
      : 'Present this topic as a process or structure diagram.',
    widgetOutline,
  };
}

export function applyOutlineFallbacks(
  outline: SceneOutline,
  hasLanguageModel: boolean,
  options: OutlineFallbackOptions = {},
): SceneOutline {
  const logger = options.logger ?? noopGenerationLogger;
  const hasWidgetConfig = outline.widgetType && outline.widgetOutline;

  if (outline.widgetType === 'procedural-skill' && !options.allowProceduralSkill) {
    logger.warn(
      `Procedural-skill outline "${outline.title}" is not enabled, falling back to diagram`,
    );
    return sanitizeProceduralSkillOutline(outline);
  }

  if (outline.type === 'interactive' && !outline.interactiveConfig && !hasWidgetConfig) {
    logger.warn(
      `Interactive outline "${outline.title}" missing interactiveConfig and widget config, falling back to slide`,
    );
    return { ...outline, type: 'slide' };
  }
  if (outline.type === 'pbl' && (!outline.pblConfig || !hasLanguageModel)) {
    logger.warn(
      `PBL outline "${outline.title}" missing pblConfig or languageModel, falling back to slide`,
    );
    return { ...outline, type: 'slide' };
  }
  return outline;
}

/** Default number of key points to seed a synthetic capstone quiz from —
 *  bounded so the quiz-content generation prompt this outline eventually
 *  feeds stays reasonably sized even for a long, many-scene lesson. */
const FALLBACK_QUIZ_KEY_POINT_LIMIT = 6;

/**
 * Guarantee a lesson ends with a quiz scene — any lesson, course-mode or
 * ad-hoc single-prompt alike.
 *
 * The requirements-to-outlines template's `courseMode` rule ASKS the model
 * for this when generating a structured-course lesson, but the model's
 * compliance is never guaranteed even then — and an ad-hoc lesson gets no
 * such prompt-level nudge at all. This is the actual guarantee, applied
 * after generation regardless of mode. A no-op when the outlines already
 * end with a quiz scene; otherwise appends one synthetic capstone quiz,
 * seeded with key points pooled from the other scenes so the later
 * quiz-content generation step has real material to write questions from
 * rather than nothing. Never reorders or removes anything the model
 * produced — a quiz scene elsewhere in the lesson (mid-lesson formative
 * check) is left exactly where the model put it.
 */
export function ensureTrailingQuizOutline(outlines: SceneOutline[]): SceneOutline[] {
  if (outlines.length === 0) return outlines;
  const last = outlines[outlines.length - 1];
  if (last.type === 'quiz') return outlines;

  const seedKeyPoints = outlines
    .flatMap((outline) => outline.keyPoints ?? [])
    .slice(0, FALLBACK_QUIZ_KEY_POINT_LIMIT);

  const fallbackQuiz: SceneOutline = {
    id: nanoid(),
    type: 'quiz',
    title: 'Knowledge Check',
    description: "Check your understanding of what this lesson covered.",
    keyPoints: seedKeyPoints,
    order: outlines.length + 1,
    quizConfig: {
      questionCount: 3,
      difficulty: 'medium',
      questionTypes: ['single', 'multiple'],
    },
  };

  return [...outlines, fallbackQuiz];
}

/**
 * Raise the trailing quiz scene's question count to at least `minimum`,
 * leaving it untouched if it already meets or exceeds that — never trims a
 * richer model-generated (or already-boosted) quiz down. No-op when the
 * last scene isn't a quiz; pair with `ensureTrailingQuizOutline` first if
 * one must always exist. Only the trailing scene is touched — a mid-lesson
 * formative-check quiz elsewhere in the outline is intentionally left at
 * whatever size the model gave it, since inflating a quick check-in isn't
 * what this guarantee is for.
 */
export function enforceMinimumQuizQuestions(
  outlines: SceneOutline[],
  minimum: number,
): SceneOutline[] {
  if (outlines.length === 0) return outlines;
  const lastIndex = outlines.length - 1;
  const last = outlines[lastIndex];
  if (last.type !== 'quiz') return outlines;
  if ((last.quizConfig?.questionCount ?? 0) >= minimum) return outlines;

  const next = [...outlines];
  next[lastIndex] = {
    ...last,
    quizConfig: {
      difficulty: 'medium',
      questionTypes: ['single', 'multiple'],
      ...last.quizConfig,
      questionCount: minimum,
    },
  };
  return next;
}
