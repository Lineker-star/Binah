import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  mergeSystemProviderDefault: vi.fn(),
  currentClient: null as unknown,
}));

vi.mock('@/lib/server/provider-config', () => ({
  mergeSystemProviderDefault: mocks.mergeSystemProviderDefault,
}));

vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: () => mocks.currentClient,
}));

interface SeedRow {
  section: string;
  owner_id: string | null;
  provider_id: string;
  model_id: string | null;
  api_key: string | null;
  base_url: string | null;
  extra_config: Record<string, unknown> | null;
}

/**
 * Minimal fake of the chained supabase-js query builder covering exactly
 * what hydrateSystemProviderDefaults calls:
 * `.from('system_settings').select(...).is('owner_id', null)`, awaited
 * directly — the production code never calls `.then()`/`.maybeSingle()`
 * itself, it just `await`s the builder, so this fake's terminal value must
 * be a thenable.
 *
 * Filters rows ONLY when `.is('owner_id', null)` is actually chained,
 * mirroring real Postgres semantics — a bare `SELECT` with no `WHERE`
 * returns every row. That's deliberate: if a future edit ever drops the
 * `.is()` call from the production query, this fake returns every row here
 * too, exactly like the real DB would, so the regression this test exists
 * to catch stays catchable rather than being masked by an always-filtering
 * mock.
 */
function makeFakeSupabase(rows: SeedRow[]) {
  return {
    from: (table: string) => {
      if (table !== 'system_settings') throw new Error(`unexpected table: ${table}`);
      return {
        select: (_columns: string) => {
          let result = rows;
          const builder = {
            is: (column: string, value: null) => {
              if (column === 'owner_id' && value === null) {
                result = result.filter((r) => r.owner_id === null);
              }
              return builder;
            },
            then: (onFulfilled: (value: { data: SeedRow[]; error: null }) => unknown) =>
              Promise.resolve(onFulfilled({ data: result, error: null })),
          };
          return builder;
        },
      };
    },
  };
}

function seedRow(overrides: Partial<SeedRow> & Pick<SeedRow, 'section' | 'owner_id' | 'provider_id'>): SeedRow {
  return {
    model_id: null,
    api_key: null,
    base_url: null,
    extra_config: null,
    ...overrides,
  };
}

describe('hydrateSystemProviderDefaults — owner-scoped rows never reach the global cache', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.mergeSystemProviderDefault.mockClear();
    mocks.currentClient = null;
  });

  it('merges only the global row when a global and an owner-scoped row exist for the same section', async () => {
    mocks.currentClient = makeFakeSupabase([
      seedRow({
        section: 'tts',
        owner_id: null,
        provider_id: 'azure-tts-global',
        base_url: 'https://global.example/tts',
      }),
      seedRow({
        section: 'tts',
        owner_id: 'parent-1',
        provider_id: 'azure-tts-personal',
        base_url: 'https://personal.example/tts',
      }),
    ]);

    const { hydrateSystemProviderDefaults } = await import('@/lib/server/system-provider-defaults');
    await hydrateSystemProviderDefaults();

    const ttsCalls = mocks.mergeSystemProviderDefault.mock.calls.filter(([section]) => section === 'tts');
    expect(ttsCalls).toHaveLength(1);
    expect(ttsCalls[0][1]).toMatchObject({
      providerId: 'azure-tts-global',
      baseUrl: 'https://global.example/tts',
    });

    // The owner-scoped row's data must never reach the merge call, for any section.
    const allCalls = mocks.mergeSystemProviderDefault.mock.calls;
    expect(allCalls.some(([, entry]) => entry?.providerId === 'azure-tts-personal')).toBe(false);
  });

  it('clears the section (does not adopt the personal row) when only an owner-scoped row exists', async () => {
    mocks.currentClient = makeFakeSupabase([
      seedRow({ section: 'image', owner_id: 'parent-1', provider_id: 'seedream-personal' }),
    ]);

    const { hydrateSystemProviderDefaults } = await import('@/lib/server/system-provider-defaults');
    await hydrateSystemProviderDefaults();

    const imageCalls = mocks.mergeSystemProviderDefault.mock.calls.filter(
      ([section]) => section === 'image',
    );
    expect(imageCalls).toHaveLength(1);
    // No global row exists, so the section is cleared (null) — never
    // silently backfilled with the personal row, which would make one
    // account's personal choice the de facto system-wide default.
    expect(imageCalls[0][1]).toBeNull();
  });

  it('merges the global row for every configured section, including webSearch', async () => {
    mocks.currentClient = makeFakeSupabase([
      seedRow({ section: 'webSearch', owner_id: null, provider_id: 'tavily-global' }),
    ]);

    const { hydrateSystemProviderDefaults } = await import('@/lib/server/system-provider-defaults');
    await hydrateSystemProviderDefaults();

    const webSearchCalls = mocks.mergeSystemProviderDefault.mock.calls.filter(
      ([section]) => section === 'webSearch',
    );
    expect(webSearchCalls).toHaveLength(1);
    expect(webSearchCalls[0][1]).toMatchObject({ providerId: 'tavily-global' });
  });
});
