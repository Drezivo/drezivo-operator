import { createHash } from 'node:crypto';
import pg from 'pg';
import { AppError } from '../../errors.js';
import {
  MAX_ACTIVE_PLATFORM_PAYMENT_METHODS,
  type PlatformPaymentCommandContext,
  type PlatformPaymentCommandResult,
  type PlatformPaymentMethod,
  type PlatformPaymentMethodFields,
  type PlatformPaymentsPort,
  type QrImage,
  type QrMime,
} from '../../operator-platform-payments/index.js';

/**
 * Writes Drezivo's own payment methods in the business database (tables from business migration
 * 0063_pilot_billing), connecting as drezivo_app like the tenant-admin adapter (ADR 0025).
 *
 * Duplicate safety: every write takes one transaction-scoped advisory lock (writes are rare), then
 * looks for its (operator, idempotency key) in platform_payment_method_change. A retry of the same
 * intent replays the current state; the same key with a different body is refused. The unique
 * constraint on that pair is the backstop. The same lock serializes the active-method limit.
 */
type MethodRow = {
  id: string; label: string; account_name: string | null; account_number: string | null; instructions: string | null;
  has_qr: boolean; active: boolean; sort_order: number; version: number; updated_at: Date;
};
type Action = 'created' | 'updated' | 'activated' | 'deactivated';

const COLUMNS = `id, label, account_name, account_number, instructions, (qr_image IS NOT NULL) AS has_qr,
  active, sort_order, version, updated_at`;
const WRITE_LOCK = 'platform_payment_method_write';

const conflict = (message: string) => new AppError(409, 'STATE_CONFLICT', message);
const notFound = () => new AppError(404, 'NOT_FOUND', 'The payment method was not found.');
const toMethod = (row: MethodRow): PlatformPaymentMethod => ({ ...row, updated_at: row.updated_at.toISOString() });

/** Stable fingerprint of one intent; the QR is represented by its hash so the bytes are never stored twice. */
function payloadHash(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
const qrFingerprint = (qr: QrImage | null | undefined) =>
  qr === undefined ? 'keep' : qr === null ? 'none' : createHash('sha256').update(qr.bytes).digest('hex');

export type PlatformPaymentsDbOptions = { connectionString: string; caCertificate?: string };

export function createPlatformPaymentsDbAdapter(options: PlatformPaymentsDbOptions): PlatformPaymentsPort & { close(): Promise<void> } {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...(options.caCertificate ? { ssl: { ca: options.caCertificate, rejectUnauthorized: true } } : {}),
  });

  async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Business migration 0064 lets drezivo_app write Drezivo's payment methods only in an
      // explicit operator context; without it every create and update is refused by RLS.
      await client.query(
        `SELECT set_config('statement_timeout', '5s', true), set_config('lock_timeout', '3s', true),
                set_config('app.actor_kind', 'operator', true), set_config('app.tenant_id', '', true)`,
      );
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function methodOf(client: pg.PoolClient, id: string, forUpdate = false): Promise<MethodRow | null> {
    const result = await client.query<MethodRow>(`SELECT ${COLUMNS} FROM platform_payment_method WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
    return result.rows[0] ?? null;
  }

  async function assertRoomForActive(client: pg.PoolClient): Promise<void> {
    const active = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM platform_payment_method WHERE active');
    if ((active.rows[0]?.n ?? 0) >= MAX_ACTIVE_PLATFORM_PAYMENT_METHODS) {
      throw new AppError(409, 'PAYMENT_METHOD_LIMIT', `At most ${MAX_ACTIVE_PLATFORM_PAYMENT_METHODS} payment methods can be active. Turn one off first.`);
    }
  }

  /**
   * Runs one write exactly once per (operator, key). `apply` returns the method id it changed and
   * whether anything changed; it runs only for a new intent.
   */
  async function command(
    ctx: PlatformPaymentCommandContext,
    action: Action,
    targetId: string | null,
    payload: Record<string, unknown>,
    apply: (client: pg.PoolClient) => Promise<{ id: string; changed: boolean }>,
  ): Promise<PlatformPaymentCommandResult> {
    const hash = payloadHash({ action, targetId, ...payload });
    return transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [WRITE_LOCK]);
      const previous = await client.query<{ platform_payment_method_id: string; action: Action; hash: string | null }>(
        `SELECT platform_payment_method_id, action, redacted_summary ->> 'payload_hash' AS hash
           FROM platform_payment_method_change WHERE operator_subject = $1 AND intent_key = $2`,
        [ctx.operatorSubject, ctx.idempotencyKey],
      );
      const prior = previous.rows[0];
      if (prior) {
        if (prior.hash !== hash) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different change.');
        const current = await methodOf(client, prior.platform_payment_method_id);
        if (!current) throw notFound();
        return { method: toMethod(current), changed: false, replayed: true };
      }

      const applied = await apply(client);
      await client.query(
        `INSERT INTO platform_payment_method_change
           (platform_payment_method_id, operator_subject, action, intent_key, reason, redacted_summary, request_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [applied.id, ctx.operatorSubject, action, ctx.idempotencyKey, ctx.reason,
          JSON.stringify({ payload_hash: hash, changed: applied.changed }), ctx.requestId],
      );
      const current = await methodOf(client, applied.id);
      if (!current) throw notFound();
      return { method: toMethod(current), changed: applied.changed, replayed: false };
    });
  }

  /** Locks the row and checks the version the operator edited. */
  async function lockedAtVersion(client: pg.PoolClient, id: string, version: number): Promise<MethodRow> {
    const row = await methodOf(client, id, true);
    if (!row) throw notFound();
    if (row.version !== version) throw conflict('This payment method changed since you opened it. Refresh and try again.');
    return row;
  }

  return {
    async list() {
      return transaction(async (client) => (await client.query<MethodRow>(
        `SELECT ${COLUMNS} FROM platform_payment_method ORDER BY active DESC, sort_order, created_at, id`,
      )).rows.map(toMethod));
    },

    async readQr(id) {
      return transaction(async (client) => {
        const result = await client.query<{ qr_image: Buffer | null; qr_mime: QrMime | null }>(
          'SELECT qr_image, qr_mime FROM platform_payment_method WHERE id = $1',
          [id],
        );
        const row = result.rows[0];
        return row?.qr_image && row.qr_mime ? { bytes: row.qr_image, mime: row.qr_mime } : null;
      });
    },

    async create(fields: PlatformPaymentMethodFields, qr: QrImage | null, ctx) {
      return command(ctx, 'created', null, { ...fields, qr: qrFingerprint(qr) }, async (client) => {
        await assertRoomForActive(client);
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO platform_payment_method (label, account_name, account_number, instructions, qr_image, qr_mime, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [fields.label, fields.account_name, fields.account_number, fields.instructions, qr?.bytes ?? null, qr?.mime ?? null, fields.sort_order],
        );
        const id = inserted.rows[0]?.id;
        if (!id) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The payment method could not be saved.');
        return { id, changed: true };
      });
    },

    async update(id, version, fields, qr, ctx) {
      return command(ctx, 'updated', id, { version, ...fields, qr: qrFingerprint(qr) }, async (client) => {
        await lockedAtVersion(client, id, version);
        const keepQr = qr === undefined;
        await client.query(
          `UPDATE platform_payment_method
              SET label = $2, account_name = $3, account_number = $4, instructions = $5, sort_order = $6,
                  qr_image = CASE WHEN $7 THEN qr_image ELSE $8 END,
                  qr_mime = CASE WHEN $7 THEN qr_mime ELSE $9 END,
                  version = version + 1, updated_at = now()
            WHERE id = $1`,
          [id, fields.label, fields.account_name, fields.account_number, fields.instructions, fields.sort_order,
            keepQr, keepQr ? null : qr?.bytes ?? null, keepQr ? null : qr?.mime ?? null],
        );
        return { id, changed: true };
      });
    },

    async setActive(id, version, active, ctx) {
      return command(ctx, active ? 'activated' : 'deactivated', id, { version, active }, async (client) => {
        const row = await lockedAtVersion(client, id, version);
        if (row.active === active) return { id, changed: false };
        if (active) await assertRoomForActive(client);
        await client.query('UPDATE platform_payment_method SET active = $2, version = version + 1, updated_at = now() WHERE id = $1', [id, active]);
        return { id, changed: true };
      });
    },

    close: () => pool.end(),
  };
}
