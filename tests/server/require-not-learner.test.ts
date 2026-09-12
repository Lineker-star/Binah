import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  single: vi.fn(),
}));

// server-only's real implementation unconditionally throws outside Next's own
// bundler (it relies on Next's client/server conditional package resolution,
// which plain vitest doesn't apply) — neutralize it so the real
// require-not-learner module can load for this test.
vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: mocks.single,
        }),
      }),
    }),
  }),
}));

describe('blockLearnerAccess', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getUser.mockReset();
    mocks.single.mockReset();
  });

  it('returns a 401 when there is no signed-in user', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const { blockLearnerAccess } = await import('@/lib/server/require-not-learner');

    const res = await blockLearnerAccess();
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    const json = await res!.json();
    expect(json.errorCode).toBe('UNAUTHENTICATED');
  });

  it('returns a 403 for a learner-role caller', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.single.mockResolvedValue({ data: { role: 'learner' } });
    const { blockLearnerAccess } = await import('@/lib/server/require-not-learner');

    const res = await blockLearnerAccess();
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const json = await res!.json();
    expect(json.errorCode).toBe('ROLE_NOT_ALLOWED');
  });

  it('lets a parent-role caller through', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u2' } } });
    mocks.single.mockResolvedValue({ data: { role: 'parent' } });
    const { blockLearnerAccess } = await import('@/lib/server/require-not-learner');

    expect(await blockLearnerAccess()).toBeNull();
  });

  it('lets an admin-role caller through', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u3' } } });
    mocks.single.mockResolvedValue({ data: { role: 'admin' } });
    const { blockLearnerAccess } = await import('@/lib/server/require-not-learner');

    expect(await blockLearnerAccess()).toBeNull();
  });
});
