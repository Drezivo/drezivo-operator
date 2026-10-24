import { z } from "zod";
import { AppError } from "../../../shared/http/errors.js";

export const uuid = z.string().uuid();
export const isoDate = z.string().datetime({ offset: true });
export const actorKinds = ['staff', 'operator', 'system'] as const;
export const outcomes = ['succeeded', 'rejected', 'failed'] as const;
export const token = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/);
const opaqueKey = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
const safeString = z.string().max(500).regex(/^[^\u0000-\u001f\u007f]*$/);

export const supportActivitySchema = z.object({
  event_id: uuid,
  tenant_id: uuid,
  occurred_at: isoDate,
  actor_kind: z.enum(actorKinds),
  actor_key: opaqueKey,
  action: token,
  entity_type: token,
  entity_id: uuid.nullable(),
  support_grant_id: uuid.nullable(),
  outcome: z.enum(outcomes),
  request_id: opaqueKey,
  redacted_summary: safeString.nullable(),
}).strict();
export type SupportActivity = z.infer<typeof supportActivitySchema>;
export type SupportActivityFilters = {
  tenant_id?: string; support_grant_id?: string; actor_kind?: (typeof actorKinds)[number];
  action?: string; entity_type?: string; outcome?: (typeof outcomes)[number];
  occurred_from?: string; occurred_to?: string;
};
export type SupportActivityCursor = { occurredAt: string; eventId: string };
export type SupportActivityPort = {
  listSupportActivity(input: { filters: SupportActivityFilters; limit: number; cursor: SupportActivityCursor | null; requestId: string }): Promise<{ items: SupportActivity[]; next_cursor: SupportActivityCursor | null }>;
};

export const unavailableSupportActivityPort: SupportActivityPort = {
  listSupportActivity: async () => { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The support activity read service is unavailable.'); },
};
