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

/** `listUsers` is injectable for tests; production passes the business Clerk secret key. */
export function createBusinessUserDirectory(options: { secretKey: string } | { listUsers: ListUsers }): BusinessUserDirectory {
  let listUsers: ListUsers;
  if ('listUsers' in options) {
    listUsers = options.listUsers;
  } else {
    const clerk = createClerkClient({ secretKey: options.secretKey });
    listUsers = (params) => clerk.users.getUserList(params) as unknown as Promise<{ data: ClerkUserLike[] }>;
  }

  return {
    async lookup(clerkUserIds) {
      const ids = [...new Set(clerkUserIds.filter((id) => /^user_[A-Za-z0-9]+$/.test(id)))];
      const profiles = new Map<string, BusinessUserProfile>();
      for (let index = 0; index < ids.length; index += BATCH) {
        const batch = ids.slice(index, index + BATCH);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), LOOKUP_TIMEOUT_MS); });
          const result = await Promise.race([listUsers({ userId: batch, limit: BATCH }), timeout]);
          for (const user of result.data) profiles.set(user.id, toProfile(user));
        } catch {
          return profiles;
        } finally {
          clearTimeout(timer);
        }
      }
      return profiles;
    },
  };
}
