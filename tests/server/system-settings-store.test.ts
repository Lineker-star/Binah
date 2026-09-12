import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * A minimal fake of the chained supabase-js query builder covering exactly
 * what upsertSystemSettingsRow calls: .from().select().eq()[.eq()|.is()]
 * .maybeSingle(), then .update().eq() or .insert().
 */
function makeFakeSupabase(existingId: string | null) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const updatePayloads: unknown[] = [];
  const insertPayloads: unknown[] = [];

  const client = {
    from(table: string) {
      calls.push({ op: 'from', args: [table] });
      return {
        select: (...args: unknown[]) => {
          calls.push({ op: 'select', args });
          const builder = {
            eq: (...eqArgs: unknown[]) => {
              calls.push({ op: 'eq', args: eqArgs });
              return builder;
            },
            is: (...isArgs: unknown[]) => {
              calls.push({ op: 'is', args: isArgs });
              return builder;
            },
            maybeSingle: async () => ({
              data: existingId ? { id: existingId } : null,
              error: null,
            }),
          };
          return builder;
        },
        update: (payload: unknown) => {
          updatePayloads.push(payload);
          return {
            eq: async () => ({ error: null }),
          };
        },
        insert: async (payload: unknown) => {
          insertPayloads.push(payload);
          return { error: null };
        },
      };
    },
  };

  return { client, calls, updatePayloads, insertPayloads };
}

describe('upsertSystemSettingsRow', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('inserts when no existing row is found (global row: owner_id filtered with .is)', async () => {
    const { upsertSystemSettingsRow } = await import('@/lib/server/system-settings-store');
    const { client, calls, insertPayloads, updatePayloads } = makeFakeSupabase(null);

    const { error } = await upsertSystemSettingsRow(client as never, {
      section: 'tts',
      ownerId: null,
      providerId: 'azure-tts',
      apiKey: 'sk-1',
      updatedBy: 'admin-1',
    });

    expect(error).toBeNull();
    expect(insertPayloads).toHaveLength(1);
    expect(updatePayloads).toHaveLength(0);
    expect(insertPayloads[0]).toMatchObject({
      section: 'tts',
      owner_id: null,
      provider_id: 'azure-tts',
      api_key: 'sk-1',
    });
    // The lookup must use .is('owner_id', null), never .eq — an .eq with a
    // JS null/undefined would not match Postgres NULL semantics.
    expect(calls.some((c) => c.op === 'is' && c.args[0] === 'owner_id')).toBe(true);
    expect(calls.some((c) => c.op === 'eq' && c.args[0] === 'owner_id')).toBe(false);
  });

  it('inserts a personal row scoped by .eq(owner_id, <user>) when none exists', async () => {
    const { upsertSystemSettingsRow } = await import('@/lib/server/system-settings-store');
    const { client, calls, insertPayloads } = makeFakeSupabase(null);

    await upsertSystemSettingsRow(client as never, {
      section: 'image',
      ownerId: 'parent-1',
      providerId: 'seedream',
      apiKey: 'sk-parent',
      updatedBy: 'parent-1',
    });

    expect(insertPayloads[0]).toMatchObject({
      section: 'image',
      owner_id: 'parent-1',
      provider_id: 'seedream',
    });
    expect(calls.some((c) => c.op === 'eq' && c.args[0] === 'owner_id' && c.args[1] === 'parent-1')).toBe(
      true,
    );
  });

  it('updates the existing row by id instead of inserting when one is found', async () => {
    const { upsertSystemSettingsRow } = await import('@/lib/server/system-settings-store');
    const { client, insertPayloads, updatePayloads } = makeFakeSupabase('row-42');

    const { error } = await upsertSystemSettingsRow(client as never, {
      section: 'pdf',
      ownerId: 'parent-1',
      providerId: 'mineru-cloud',
      apiKey: 'sk-new',
      updatedBy: 'parent-1',
    });

    expect(error).toBeNull();
    expect(insertPayloads).toHaveLength(0);
    expect(updatePayloads).toHaveLength(1);
    expect(updatePayloads[0]).toMatchObject({ provider_id: 'mineru-cloud', api_key: 'sk-new' });
  });
});
