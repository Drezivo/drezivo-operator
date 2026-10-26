import pg from 'pg';
import { AppError } from '../../shared/http/errors.js';
import type { TenantAdminDbOptions } from '../../features/clients/repository/admin.js';

export type ConsoleDbContext = {
  transaction<T>(subject: string, write: boolean, fn: (client: pg.PoolClient) => Promise<T>): Promise<T>;
  projection(resource: string, input: object): Promise<unknown>;
  page<T>(resource: string, filters: object, limit: number, at: string | null | undefined, id: string | undefined, parse: (value: unknown) => T): Promise<{ items: T[]; more: boolean }>;
  command(kind: string, subject: string, key: string, requestId: string, body: object): Promise<unknown>;
  close(): Promise<void>;
};

/** Shared transaction and transport primitives for the local console projections. */
export function createConsoleDbContext(options: TenantAdminDbOptions): ConsoleDbContext {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: 4,
    connectionTimeoutMillis: 5000,
    ...(options.caCertificate ? { ssl: { ca: options.caCertificate, rejectUnauthorized: true } } : {}),
  });

  async function transaction<T>(subject: string, write: boolean, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      const role = (await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user',
      )).rows[0];
      if (!role || role.rolsuper || role.rolbypassrls) {
        throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The operator database role is invalid.');
      }

      await client.query(write ? 'BEGIN' : 'BEGIN READ ONLY');
      await client.query(
        "SELECT set_config('app.actor_kind','operator',true),set_config('app.tenant_id','',true),set_config('app.principal_id',$1,true),set_config('statement_timeout','5s',true),set_config('lock_timeout','3s',true)",
        [`operator:${subject}`],
      );
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const code = (error as { code?: string }).code;
      if (code === '42501') throw new AppError(403, 'FORBIDDEN', 'The operator database action is not permitted.');
      if (code === '23503') throw new AppError(409, 'STATE_CONFLICT', 'This record has linked data. Refresh and review its current state before continuing.');
      if (code === '23514' || code === '23502' || code === '22P02') throw new AppError(400, 'VALIDATION_FAILED', 'The operator command contains invalid data.');
      if (code === '23505') throw new AppError(409, 'STATE_CONFLICT', 'This intent or resource state has changed. Refresh before trying again.');
      if (code === 'P0002') throw new AppError(404, 'NOT_FOUND', 'The resource was not found.');
      if (code === '22023') throw new AppError(400, 'VALIDATION_FAILED', 'The operator command is invalid.');
      throw error;
    } finally {
      client.release();
    }
  }

  async function projection(resource: string, input: object): Promise<unknown> {
    return transaction('projection', false, async (client) => (
      await client.query<{ data: unknown }>(
        'SELECT operator_console_projection($1,$2::jsonb) AS data',
        [resource, JSON.stringify(input)],
      )
    ).rows[0]?.data);
  }

  async function page<T>(
    resource: string,
    filters: object,
    limit: number,
    at: string | null | undefined,
    id: string | undefined,
    parse: (value: unknown) => T,
  ): Promise<{ items: T[]; more: boolean }> {
    const rows = await projection(resource, { ...filters, limit: limit + 1, ...(id ? { at, id } : {}) });
    if (!Array.isArray(rows)) throw new AppError(503, 'DEPENDENCY_INVALID_RESPONSE', 'The operator projection is invalid.');
    return { items: rows.slice(0, limit).map(parse), more: rows.length > limit };
  }

  async function command(kind: string, subject: string, key: string, requestId: string, body: object): Promise<unknown> {
    return transaction(subject, true, async (client) => (
      await client.query<{ data: unknown }>(
        'SELECT operator_console_command($1,$2,$3,$4,$5::jsonb) AS data',
        [kind, subject, key, requestId, JSON.stringify(body)],
      )
    ).rows[0]?.data);
  }

  return { transaction, projection, page, command, close: () => pool.end() };
}
