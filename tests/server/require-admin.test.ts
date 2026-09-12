import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
  }),
}));

describe('requireAdmin', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getUser.mockReset();
    mocks.rpc.mockReset();
  });

  it('returns a 401 when there is no signed-in user', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const { requireAdmin } = await import('@/lib/server/require-admin');

    const res = await requireAdmin();
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    const json = await res!.json();
    expect(json.errorCode).toBe('UNAUTHENTICATED');
  });

  it('returns a 403 when is_admin() reports false', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const { requireAdmin } = await import('@/lib/server/require-admin');

    const res = await requireAdmin();
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const json = await res!.json();
    expect(json.errorCode).toBe('ROLE_NOT_ALLOWED');
  });

  it('returns a 403 when the is_admin() RPC itself errors', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u2' } } });
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('rpc failed') });
    const { requireAdmin } = await import('@/lib/server/require-admin');

    const res = await requireAdmin();
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('lets an admin caller through', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u3' } } });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const { requireAdmin } = await import('@/lib/server/require-admin');

    expect(await requireAdmin()).toBeNull();
  });
});
