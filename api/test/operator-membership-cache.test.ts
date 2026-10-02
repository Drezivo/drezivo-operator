import { describe, expect, it, vi } from 'vitest';
import { cachedActiveMemberships } from '../src/operator-authorization.js';
import type { ClerkOperatorMembershipResult } from '../src/clerk-operator-membership.js';

const active: ClerkOperatorMembershipResult = { active: true, roles: ['org:platform_owner'] };

describe('cachedActiveMemberships', () => {
  it('reuses an active membership until it expires', async () => {
    let now = 0;
    const read = vi.fn(async () => active);
    const cached = cachedActiveMemberships(read, 30_000, () => now);
    await cached('user_a');
    await cached('user_a');
    expect(read).toHaveBeenCalledTimes(1);
    now = 30_001;
    await cached('user_a');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('never caches a denial or a provider error, so access stays fail-closed', async () => {
    const results: ClerkOperatorMembershipResult[] = [
      { active: false, reason: 'not_a_member' },
      { active: false, reason: 'provider_unavailable' },
      active,
    ];
    const read = vi.fn(async () => results.shift()!);
    const cached = cachedActiveMemberships(read, 30_000, () => 0);
    expect((await cached('user_b')).active).toBe(false);
    expect((await cached('user_b')).active).toBe(false);
    expect((await cached('user_b')).active).toBe(true);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('shares one lookup between concurrent requests for the same user', async () => {
    let release!: (value: ClerkOperatorMembershipResult) => void;
    const read = vi.fn(() => new Promise<ClerkOperatorMembershipResult>((resolve) => { release = resolve; }));
    const cached = cachedActiveMemberships(read, 30_000, () => 0);
    const both = Promise.all([cached('user_c'), cached('user_c')]);
    release(active);
    expect(await both).toEqual([active, active]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('keeps users separate', async () => {
    const read = vi.fn(async (id: string) => (id === 'user_ok' ? active : { active: false as const, reason: 'not_a_member' as const }));
    const cached = cachedActiveMemberships(read, 30_000, () => 0);
    expect((await cached('user_ok')).active).toBe(true);
    expect((await cached('user_other')).active).toBe(false);
  });
});
