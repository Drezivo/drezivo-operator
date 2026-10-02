import { describe, expect, it } from 'vitest';
import { createBusinessUserDirectory, toProfile } from '../src/integrations/business-user-directory/index.js';

const user = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, firstName: 'Maria', lastName: 'Santos', primaryEmailAddressId: 'em_2',
  emailAddresses: [{ id: 'em_1', emailAddress: 'old@example.com' }, { id: 'em_2', emailAddress: 'maria@example.com' }],
  lastSignInAt: Date.parse('2026-09-27T01:00:00Z'), banned: false, locked: false, ...overrides,
});

describe('business user directory', () => {
  it('maps a Clerk user to a display profile using the primary email', () => {
    expect(toProfile(user('user_a'))).toEqual({ email: 'maria@example.com', name: 'Maria Santos', last_sign_in_at: '2026-09-27T01:00:00.000Z', banned: false, locked: false });
    expect(toProfile(user('user_b', { firstName: null, lastName: null, lastSignInAt: null })).name).toBeNull();
  });

  it('looks up unique, well-formed ids in batches of 100 and ignores junk ids', async () => {
    const calls: string[][] = [];
    const ids = Array.from({ length: 150 }, (_, index) => `user_${index}`);
    const directory = createBusinessUserDirectory({ listUsers: async ({ userId }) => { calls.push(userId); return { data: userId.map((id) => user(id)) }; } });
    const profiles = await directory.lookup([...ids, 'user_1', 'not-a-clerk-id', "user_x'; drop"]);
    expect(calls.map((batch) => batch.length)).toEqual([100, 50]);
    expect(profiles.size).toBe(150);
  });

  it('never throws: a failing provider returns what it has so lists still render', async () => {
    const directory = createBusinessUserDirectory({ listUsers: async () => { throw new Error('Clerk down'); } });
    await expect(directory.lookup(['user_a'])).resolves.toEqual(new Map());
  });

  it('reuses profiles for a minute and only fetches the ones it does not have', async () => {
    let now = 0;
    const calls: string[][] = [];
    const directory = createBusinessUserDirectory({ now: () => now, listUsers: async ({ userId }) => { calls.push(userId); return { data: userId.map((id) => user(id)) }; } });
    await directory.lookup(['user_a', 'user_b']);
    expect((await directory.lookup(['user_a', 'user_b', 'user_c'])).size).toBe(3);
    expect(calls).toEqual([['user_a', 'user_b'], ['user_c']]);
    now = 60_001;
    await directory.lookup(['user_a']);
    expect(calls.at(-1)).toEqual(['user_a']);
  });

  it('fetches batches in parallel, and one failed batch leaves only its people unresolved', async () => {
    let inFlight = 0;
    let peak = 0;
    const ids = Array.from({ length: 450 }, (_, index) => `user_${index}`);
    const directory = createBusinessUserDirectory({
      listUsers: async ({ userId }) => {
        inFlight += 1; peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        if (userId[0] === 'user_100') throw new Error('one batch failed');
        return { data: userId.map((id) => user(id)) };
      },
    });
    const profiles = await directory.lookup(ids);
    expect(peak).toBe(4);
    expect(profiles.size).toBe(350);
    expect(profiles.has('user_150')).toBe(false);
  });
});
