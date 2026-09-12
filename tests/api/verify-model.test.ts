import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  resolveModel: vi.fn(),
  callLLM: vi.fn(),
  blockLearnerAccess: vi.fn(),
}));

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModel: mocks.resolveModel,
}));

vi.mock('@/lib/ai/llm', () => ({
  callLLM: mocks.callLLM,
}));

vi.mock('@/lib/server/require-not-learner', () => ({
  blockLearnerAccess: mocks.blockLearnerAccess,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

async function postVerifyModel(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/verify-model/route');
  const request = new Request('http://localhost/api/verify-model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(request as unknown as NextRequest);
}

describe('POST /api/verify-model', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.resolveModel.mockReset();
    mocks.callLLM.mockReset();
    mocks.blockLearnerAccess.mockReset();
    mocks.resolveModel.mockResolvedValue({ model: { id: 'language-model' } });
    mocks.callLLM.mockResolvedValue({ text: 'OK' });
    mocks.blockLearnerAccess.mockResolvedValue(null);
  });

  it('rejects requests without a model name', async () => {
    const res = await postVerifyModel({});
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toMatchObject({
      success: false,
      errorCode: 'MISSING_REQUIRED_FIELD',
    });
    expect(mocks.resolveModel).not.toHaveBeenCalled();
    expect(mocks.callLLM).not.toHaveBeenCalled();
  });

  it('uses the unified LLM wrapper with thinking disabled for connection checks', async () => {
    const res = await postVerifyModel({
      model: 'xiaomi:mimo-v2.5-pro',
      apiKey: 'tp-test',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      providerType: 'openai',
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      message: 'Connection successful',
      response: 'OK',
    });
    expect(mocks.resolveModel).toHaveBeenCalledWith({
      modelString: 'xiaomi:mimo-v2.5-pro',
      apiKey: 'tp-test',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      providerType: 'openai',
    });
    expect(mocks.callLLM).toHaveBeenCalledWith(
      {
        model: { id: 'language-model' },
        prompt: 'Say "OK" if you can hear me.',
        maxOutputTokens: 64,
      },
      'verify-model',
      undefined,
      { mode: 'disabled', enabled: false },
    );
  });

  it('defers to blockLearnerAccess and never reaches the LLM for a blocked caller', async () => {
    mocks.blockLearnerAccess.mockResolvedValue(
      new Response(JSON.stringify({ success: false, errorCode: 'ROLE_NOT_ALLOWED' }), {
        status: 403,
      }),
    );

    const res = await postVerifyModel({
      model: 'xiaomi:mimo-v2.5-pro',
      apiKey: 'tp-test',
      providerType: 'openai',
    });

    expect(res.status).toBe(403);
    expect(mocks.resolveModel).not.toHaveBeenCalled();
    expect(mocks.callLLM).not.toHaveBeenCalled();
  });
});
