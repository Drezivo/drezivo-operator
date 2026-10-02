import { createClerkClient } from '@clerk/express';

/** Display profile of a business staff member, read from the business (not operator) Clerk instance. */
export type BusinessUserProfile = {
  email: string | null;
  name: string | null;
  last_sign_in_at: string | null;
  banned: boolean;
  locked: boolean;
};

export type BusinessUserDirectory = {
  /** Never throws: an unavailable directory returns an empty map so lists still render by user ID. */
  lookup(clerkUserIds: readonly string[]): Promise<Map<string, BusinessUserProfile>>;
};

export const emptyBusinessUserDirectory: BusinessUserDirectory = { lookup: async () => new Map() };

type ClerkUserLike = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  primaryEmailAddressId: string | null;
  emailAddresses: Array<{ id: string; emailAddress: string }>;
  lastSignInAt: number | null;
  banned: boolean;
  locked: boolean;
};
type ListUsers = (params: { userId: string[]; limit: number }) => Promise<{ data: ClerkUserLike[] }>;

const BATCH = 100;
const LOOKUP_TIMEOUT_MS = 4_000;

export function toProfile(user: ClerkUserLike): BusinessUserProfile {
  const primary = user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId) ?? user.emailAddresses[0];
  const name = [user.firstName, user.lastName].filter((part) => part && part.trim()).join(' ').trim();
  return {
    email: primary?.emailAddress ?? null,
    name: name || null,
    last_sign_in_at: user.lastSignInAt ? new Date(user.lastSignInAt).toISOString() : null,
    banned: user.banned,
    locked: user.locked,
  };
}

const PROFILE_CACHE_MS = 60_000;
const PROFILE_CACHE_MAX_ENTRIES = 20_000;
const PARALLEL_BATCHES = 4;

/**
 * `listUsers` is injectable for tests; production passes the business Clerk secret key.
 *
 * Profiles are display data (name, email, sign-in time, banned/locked flags), so a profile is
 * reused for PROFILE_CACHE_MS and missing ones are fetched in parallel batches. A slow or failed
 * batch only leaves those people without a profile; the list still renders by user ID.
 */
export function createBusinessUserDirectory(
  options: ({ secretKey: string } | { listUsers: ListUsers }) & { now?: () => number },
): BusinessUserDirectory {
  let listUsers: ListUsers;
  if ('listUsers' in options) {
    listUsers = options.listUsers;
  } else {
    const clerk = createClerkClient({ secretKey: options.secretKey });
    listUsers = (params) => clerk.users.getUserList(params) as unknown as Promise<{ data: ClerkUserLike[] }>;
  }
  const now = options.now ?? Date.now;
  const cache = new Map<string, { expiresAt: number; profile: BusinessUserProfile }>();

  async function fetchBatch(batch: string[]): Promise<ClerkUserLike[]> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), LOOKUP_TIMEOUT_MS); });
      return (await Promise.race([listUsers({ userId: batch, limit: BATCH }), timeout])).data;
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async lookup(clerkUserIds) {
      const ids = [...new Set(clerkUserIds.filter((id) => /^user_[A-Za-z0-9]+$/.test(id)))];
      const profiles = new Map<string, BusinessUserProfile>();
      const missing: string[] = [];
      const at = now();
      for (const id of ids) {
        const hit = cache.get(id);
        if (hit && hit.expiresAt > at) profiles.set(id, hit.profile);
        else missing.push(id);
      }

      const batches: string[][] = [];
      for (let index = 0; index < missing.length; index += BATCH) batches.push(missing.slice(index, index + BATCH));
      for (let index = 0; index < batches.length; index += PARALLEL_BATCHES) {
        const results = await Promise.all(batches.slice(index, index + PARALLEL_BATCHES).map(fetchBatch));
        for (const user of results.flat()) {
          const profile = toProfile(user);
          profiles.set(user.id, profile);
          if (cache.size >= PROFILE_CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
          cache.set(user.id, { expiresAt: now() + PROFILE_CACHE_MS, profile });
        }
      }
      return profiles;
    },
  };
}
