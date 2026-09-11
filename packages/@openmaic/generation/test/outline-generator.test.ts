// Behavior-parity port of lib/generation/outline-generator.ts assertions from
// tests/generation/media-prompt-wiring.test.ts and procedural-skill-content-gates.test.ts.
import { describe, expect, test, vi } from 'vitest';
import {
  DEFAULT_LANGUAGE_DIRECTIVE,
  applyOutlineFallbacks,
  ensureTrailingQuizOutline,
  enforceMinimumQuizQuestions,
  generateSceneOutlinesFromRequirements,
  sanitizeProceduralSkillOutline,
  type AICallFn,
  type GenerationLogger,
  type SceneOutline,
  type UserRequirements,
} from '@openmaic/generation';

const baseOutline: SceneOutline = {
  id: 'scene_1',
  type: 'slide',
  title: 'Photosynthesis',
  description: 'How plants make food',
  keyPoints: ['light', 'water', 'carbon dioxide'],
  order: 99,
};

describe('generateSceneOutlinesFromRequirements', () => {
  test('returns enriched outlines from a valid wrapped response', async () => {
    const aiCall: AICallFn = vi.fn(async () =>
      JSON.stringify({
        languageDirective: 'Teach in English.',
        courseTitle: 'Photosynthesis Basics',
        outlines: [{ ...baseOutline, id: '', order: 42 }],
      }),
    );

    const result = await generateSceneOutlinesFromRequirements(
      { requirement: 'Teach photosynthesis' },
      undefined,
      undefined,
      aiCall,
    );

    expect(result.success).toBe(true);
    expect(result.data?.languageDirective).toBe('Teach in English.');
    expect(result.data?.courseTitle).toBe('Photosynthesis Basics');
    expect(result.data?.outlines[0]?.id).toBeTruthy();
    expect(result.data?.outlines[0]?.order).toBe(1);
  });

  test('integrates repairable JSON parsing', async () => {
    const response = `{
      "languageDirective": "Teach in English.",
      "courseTitle": "Repair",
      "outlines": [{
        "id": "scene_1",
        "type": "slide",
        "title": "Repairable",
        "description": "A repaired response",
        "keyPoints": ["one"],
        "order: 7"
      }]
    }`;
    const result = await generateSceneOutlinesFromRequirements(
      { requirement: 'Test repair' },
      undefined,
      undefined,
      async () => response,
    );

    expect(result.success).toBe(true);
    expect(result.data?.outlines).toMatchObject([{ title: 'Repairable', order: 1 }]);
  });

  test('supports the legacy flat-array response with a default language directive', async () => {
    const result = await generateSceneOutlinesFromRequirements(
      { requirement: 'Teach photosynthesis' },
      undefined,
      undefined,
      async () => JSON.stringify([baseOutline]),
    );

    expect(result.success).toBe(true);
    expect(result.data?.languageDirective).toBe(DEFAULT_LANGUAGE_DIRECTIVE);
  });

  test('passes media enable flags into prompt conditionals', async () => {
    let capturedPrompt = '';
    const aiCall: AICallFn = async (system, user) => {
      capturedPrompt = `${system}\n${user}`;
      return JSON.stringify({
        languageDirective: 'Teach in English.',
        courseTitle: 'Evaporation',
        outlines: [],
      });
    };
    const requirements: UserRequirements = {
      requirement: 'Teach evaporation with an animation',
    };

    const result = await generateSceneOutlinesFromRequirements(
      requirements,
      undefined,
      undefined,
      aiCall,
      { imageGenerationEnabled: false, videoGenerationEnabled: true },
    );

    expect(result.success).toBe(true);
    expect(capturedPrompt).toContain('gen_vid_1');
    expect(capturedPrompt).not.toContain('gen_img_');
    expect(capturedPrompt).not.toContain('suggestedImageIds');
    expect(capturedPrompt).not.toContain('{{');
  });

  const requirements: UserRequirements = { requirement: 'Teach photosynthesis' };
  async function runWith(raw: unknown) {
    return generateSceneOutlinesFromRequirements(requirements, undefined, undefined, async () =>
      JSON.stringify(raw),
    );
  }

  test('trims and caps a string courseTitle', async () => {
    const result = await runWith({
      languageDirective: 'Teach in English.',
      courseTitle: `  ${'A '.repeat(80)}  `,
      outlines: [],
    });
    expect(result.data?.courseTitle?.length).toBeLessThanOrEqual(120);
    expect(result.data?.courseTitle?.startsWith(' ')).toBe(false);
  });

  test.each([
    [{ languageDirective: 'Teach in English.', outlines: [] }],
    [{ languageDirective: 'Teach in English.', courseTitle: '   ', outlines: [] }],
    [{ languageDirective: 'Teach in English.', courseTitle: 123, outlines: [] }],
  ])('omits a missing, empty, or non-string courseTitle', async (raw) => {
    const result = await runWith(raw);
    expect(result.success).toBe(true);
    expect(result.data?.courseTitle).toBeUndefined();
  });
});

describe('outline fallbacks', () => {
  test('downgrades incomplete interactive and PBL outlines', () => {
    expect(applyOutlineFallbacks({ ...baseOutline, type: 'interactive' }, true).type).toBe('slide');
    expect(applyOutlineFallbacks({ ...baseOutline, type: 'pbl' }, true).type).toBe('slide');
    expect(
      applyOutlineFallbacks(
        {
          ...baseOutline,
          type: 'pbl',
          pblConfig: { projectTopic: 'Garden', projectDescription: 'Grow it', targetSkills: [] },
        },
        false,
      ).type,
    ).toBe('slide');
  });

  test('keeps configured interactive and PBL outlines when a language model is present', () => {
    const interactive = {
      ...baseOutline,
      type: 'interactive' as const,
      widgetType: 'diagram' as const,
      widgetOutline: { concept: 'Cycle' },
    };
    const pbl = {
      ...baseOutline,
      type: 'pbl' as const,
      pblConfig: { projectTopic: 'Garden', projectDescription: 'Grow it', targetSkills: [] },
    };
    expect(applyOutlineFallbacks(interactive, true)).toBe(interactive);
    expect(applyOutlineFallbacks(pbl, true)).toBe(pbl);
  });

  test('logs a fallback through the injected structural logger', () => {
    const warn = vi.fn();
    const logger: GenerationLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
    };
    applyOutlineFallbacks({ ...baseOutline, type: 'interactive' }, true, { logger });
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('ensureTrailingQuizOutline', () => {
  const slide = { ...baseOutline, id: 'scene_1', order: 1 };

  test('appends a synthetic quiz when the outline has none', () => {
    const result = ensureTrailingQuizOutline([slide]);
    expect(result).toHaveLength(2);
    expect(result[1].type).toBe('quiz');
    expect(result[1].quizConfig?.questionCount).toBe(3);
  });

  test('is a no-op when the outline already ends with a quiz', () => {
    const quiz: SceneOutline = {
      ...baseOutline,
      id: 'scene_2',
      type: 'quiz',
      order: 2,
      quizConfig: { questionCount: 5, difficulty: 'hard', questionTypes: ['single'] },
    };
    const outlines = [slide, quiz];
    expect(ensureTrailingQuizOutline(outlines)).toBe(outlines);
  });

  test('leaves a mid-lesson quiz alone when the trailing scene is not a quiz', () => {
    const midQuiz: SceneOutline = {
      ...baseOutline,
      id: 'scene_mid',
      type: 'quiz',
      order: 1,
      quizConfig: { questionCount: 2, difficulty: 'easy', questionTypes: ['single'] },
    };
    const result = ensureTrailingQuizOutline([midQuiz, slide]);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(midQuiz);
    expect(result[0].quizConfig?.questionCount).toBe(2);
    expect(result[2].type).toBe('quiz');
  });
});

describe('enforceMinimumQuizQuestions', () => {
  const slide = { ...baseOutline, id: 'scene_1', order: 1 };

  test('raises a low trailing question count to the minimum', () => {
    const quiz: SceneOutline = {
      ...baseOutline,
      id: 'scene_2',
      type: 'quiz',
      order: 2,
      quizConfig: { questionCount: 3, difficulty: 'medium', questionTypes: ['single'] },
    };
    const result = enforceMinimumQuizQuestions([slide, quiz], 10);
    expect(result[1].quizConfig).toMatchObject({
      questionCount: 10,
      difficulty: 'medium',
      questionTypes: ['single'],
    });
  });

  test('never lowers a quiz that already meets or exceeds the minimum', () => {
    const quiz: SceneOutline = {
      ...baseOutline,
      id: 'scene_2',
      type: 'quiz',
      order: 2,
      quizConfig: { questionCount: 15, difficulty: 'hard', questionTypes: ['multiple'] },
    };
    const outlines = [slide, quiz];
    expect(enforceMinimumQuizQuestions(outlines, 10)).toBe(outlines);
  });

  test('is a no-op when the trailing scene is not a quiz at all', () => {
    const outlines = [slide];
    expect(enforceMinimumQuizQuestions(outlines, 10)).toBe(outlines);
  });

  test('fills in default difficulty/questionTypes when the quiz has no quizConfig', () => {
    const quiz: SceneOutline = { ...baseOutline, id: 'scene_2', type: 'quiz', order: 2 };
    const result = enforceMinimumQuizQuestions([slide, quiz], 10);
    expect(result[1].quizConfig).toEqual({
      questionCount: 10,
      difficulty: 'medium',
      questionTypes: ['single', 'multiple'],
    });
  });

  test('only touches the trailing quiz, leaving an earlier mid-lesson quiz untouched', () => {
    const midQuiz: SceneOutline = {
      ...baseOutline,
      id: 'scene_mid',
      type: 'quiz',
      order: 1,
      quizConfig: { questionCount: 2, difficulty: 'easy', questionTypes: ['single'] },
    };
    const trailingQuiz: SceneOutline = {
      ...baseOutline,
      id: 'scene_3',
      type: 'quiz',
      order: 3,
      quizConfig: { questionCount: 3, difficulty: 'medium', questionTypes: ['single'] },
    };
    const result = enforceMinimumQuizQuestions([midQuiz, slide, trailingQuiz], 10);
    expect(result[0].quizConfig?.questionCount).toBe(2);
    expect(result[2].quizConfig?.questionCount).toBe(10);
  });
});

describe('sanitizeProceduralSkillOutline', () => {
  const procedural: SceneOutline = {
    ...baseOutline,
    type: 'interactive',
    widgetType: 'procedural-skill',
    widgetOutline: {
      concept: 'calibration procedure',
      procedureType: 'operation',
      task: 'Calibrate a device',
      tools: ['meter'],
      steps: ['inspect'],
      successCriteria: ['within range'],
      errorConsequences: ['stop'],
      interactions: ['inspect details'],
    },
  };

  test('strips every task-engine field and preserves unrelated widget fields', () => {
    const safe = sanitizeProceduralSkillOutline(procedural);
    expect(safe.widgetType).toBe('diagram');
    expect(safe.widgetOutline).toEqual({
      concept: 'calibration procedure',
      interactions: ['inspect details'],
    });
    expect(safe.description).toContain('Present this as a process or structure diagram.');
  });

  test('uses the fallback description when the source description is empty', () => {
    expect(sanitizeProceduralSkillOutline({ ...procedural, description: '' }).description).toBe(
      'Present this topic as a process or structure diagram.',
    );
  });

  test('retains procedural-skill only when explicitly allowed', () => {
    expect(applyOutlineFallbacks(procedural, true, { allowProceduralSkill: true }).widgetType).toBe(
      'procedural-skill',
    );
  });
});
