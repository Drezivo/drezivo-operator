import { createClerkClient } from '@clerk/express';
import { AppError } from '../../errors.js';
import type { OperatorDirectoryPort, OperatorDirectoryItem } from '../../operator-directory/index.js';
const roles: Record<string, OperatorDirectoryItem['role']> = { 'org:admin': 'platform_owner', 'org:platform_owner': 'platform_owner' };
export function createOperatorDirectory(secretKey: string, organizationId: string): OperatorDirectoryPort {
    const clerk = createClerkClient({ secretKey });
    return { async listOperators({ filters, limit, cursor }) {
            // Clerk is the authority for active organization membership. Do not infer membership from logs.
            const all: OperatorDirectoryItem[] = [];
            let offset = 0;
            for (;;) {
                const page = await clerk.organizations.getOrganizationMembershipList({ organizationId, limit: 100, offset });
                for (const member of page.data) {
                    const role = roles[member.role];
                    const id = member.publicUserData?.userId;
                    if (!role || !id)
                        continue;
                    all.push({ operator_id: id, display_name: `Operator ${id.slice(-8)}`, role, status: 'active', last_activity_at: null, assigned_tenant_count: null });
                }
                offset += page.data.length;
                if (offset >= page.totalCount)
                    break;
                if (page.data.length === 0 || offset > 1000)
                    throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The operator directory is too large to read safely.');
            }
            const rows = all.filter(x => (!filters.role || x.role === filters.role) && (!filters.status || x.status === filters.status)).sort((a, b) => a.operator_id.localeCompare(b.operator_id)).filter(x => !cursor || x.operator_id > cursor.operatorId);
            const items = rows.slice(0, limit), last = items.at(-1);
            return { items, next_cursor: rows.length > limit && last ? { lastActivityAt: null, operatorId: last.operator_id } : null };
        } };
}
