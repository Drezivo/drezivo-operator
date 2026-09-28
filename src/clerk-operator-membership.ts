export const CLERK_OPERATOR_ROLES = [
  'org:platform_owner',
  'org:platform_operator',
  'org:support_operator',
  'org:billing_operator',
  'org:read_only_operator',
] as const;

export type ClerkOperatorRole = (typeof CLERK_OPERATOR_ROLES)[number];

export type ClerkMembershipListInput = { organizationId: string; userId: [string]; limit: 2 };
export type ClerkMembershipList = (input: ClerkMembershipListInput) => Promise<unknown>;
export type ClerkOperatorMembershipResult =
  | { active: true; roles: [ClerkOperatorRole] }
  | { active: false; reason: 'not_a_member' | 'invalid_membership' | 'provider_unavailable' };

export function createClerkOperatorMembershipReader(input: {
  listMemberships: ClerkMembershipList;
  organizationId: string;
  timeoutMs?: number;
}): (clerkUserId: string) => Promise<ClerkOperatorMembershipResult> {
  const timeoutMs = input.timeoutMs ?? 2_000;
  return async (clerkUserId): Promise<ClerkOperatorMembershipResult> => {
    if (!isNonEmptyString(input.organizationId) || !isNonEmptyString(clerkUserId) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { active: false, reason: 'invalid_membership' };
    }
    try {
      const response = await withTimeout(input.listMemberships({ organizationId: input.organizationId, userId: [clerkUserId], limit: 2 }), timeoutMs);
      const rows = extractRows(response);
      if (!rows || rows.length === 0) return { active: false, reason: 'not_a_member' };
      if (rows.length !== 1) return { active: false, reason: 'invalid_membership' };
      const row = rows[0];
      if (!isRecord(row)) return { active: false, reason: 'invalid_membership' };
      const rowOrganizationId = extractIdentity(row, ['organizationId', 'organization_id']) ?? nestedIdentity(row, ['organization'], ['id']);
      const role = typeof row.role === 'string' ? row.role : undefined;
      const rowUserId = nestedIdentity(row, ['publicUserData', 'public_user_data'], ['userId', 'user_id', 'id']);
      if (rowOrganizationId !== input.organizationId || rowUserId !== clerkUserId || !role || !roleSet.has(role)) {
        return { active: false, reason: 'invalid_membership' };
      }
      return { active: true, roles: [role as ClerkOperatorRole] };
    } catch {
      return { active: false, reason: 'provider_unavailable' };
    }
  };
}

const roleSet = new Set<string>(CLERK_OPERATOR_ROLES);

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('membership lookup timed out')), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

function extractRows(response: unknown): unknown[] | undefined {
  if (Array.isArray(response)) return response;
  if (!isRecord(response)) return undefined;
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.memberships)) return response.memberships;
  return undefined;
}

function extractIdentity(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) if (typeof row[key] === 'string') return row[key];
  return undefined;
}

function nestedIdentity(row: Record<string, unknown>, containers: string[], identityKeys: string[]): string | undefined {
  for (const key of containers) {
    const nested = row[key];
    if (isRecord(nested)) {
      const identity = extractIdentity(nested, identityKeys);
      if (identity) return identity;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
