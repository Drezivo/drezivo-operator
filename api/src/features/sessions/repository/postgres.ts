import { createHash } from 'node:crypto';
import type { SessionAuditPort } from '../index.js';
import type { ConsoleDbContext } from '../../../infrastructure/db/console-context.js';

export function createSessionAuditDbAdapter(db: ConsoleDbContext): SessionAuditPort {
  return {
    async record({ subject, sessionId, event, requestId, occurredAt }) {
      return db.transaction(subject, true, async (client) => {
        const result = await client.query(
          "INSERT INTO global_audit_event(actor_kind,actor_key,action,entity_type,entity_id,outcome,redacted_summary,request_id,created_at) VALUES('operator',$1,$2,'operator_session',$3,'succeeded','{}',$4,coalesce($5::timestamptz,now())) ON CONFLICT DO NOTHING RETURNING id",
          [`operator:${subject}`, `operator.session.${event}`, sessionEntityId(sessionId), requestId, occurredAt ?? null],
        );
        return { recorded: result.rowCount === 1 };
      });
    },
    async recordDecision({ subject, permission, allowed, requestId }) {
      await db.transaction(subject, true, async (client) => {
        await client.query(
          "INSERT INTO global_audit_event(actor_kind,actor_key,action,entity_type,outcome,redacted_summary,request_id) VALUES('operator',$1,$2,'operator_access',$3,$4::jsonb,$5)",
          [`operator:${subject}`, allowed ? 'operator.permission.allowed' : 'operator.permission.denied', allowed ? 'succeeded' : 'rejected', JSON.stringify({ permission }), requestId],
        );
      });
    },
    async isKnown(subject, sessionId) {
      return db.transaction(subject, false, async (client) => (
        await client.query(
          "SELECT 1 FROM global_audit_event WHERE actor_key=$1 AND entity_id=$2 AND entity_type='operator_session' AND action='operator.session.started'",
          [`operator:${subject}`, sessionEntityId(sessionId)],
        )
      ).rowCount !== 0);
    },
    async isEnded(subject, sessionId) {
      return db.transaction(subject, false, async (client) => (
        await client.query(
          "SELECT 1 FROM global_audit_event WHERE actor_key=$1 AND entity_id=$2 AND entity_type='operator_session' AND action IN ('operator.session.ended','operator.session.revoked','operator.session.removed') LIMIT 1",
          [`operator:${subject}`, sessionEntityId(sessionId)],
        )
      ).rowCount !== 0);
    },
  };
}

function sessionEntityId(sessionId: string): string {
  const hash = createHash('sha256').update('operator-session:').update(sessionId).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
