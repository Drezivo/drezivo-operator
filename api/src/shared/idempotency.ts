import { createHash } from 'node:crypto';

function stableJson(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item) ?? 'null').join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key]) ?? 'null'}`).join(',')}}`;
}

/** Hash a command body after normalizing its optional, schema-trimmed audit reason. */
export function commandRequestFingerprint(body: unknown, reasonText?: string): string {
  let normalizedBody = body;
  if (body !== null && typeof body === 'object' && !Array.isArray(body) && Object.hasOwn(body, 'reason')) {
    const normalizedRecord = { ...(body as Record<string, unknown>) };
    if (reasonText === undefined) delete normalizedRecord.reason;
    else normalizedRecord.reason = reasonText;
    normalizedBody = normalizedRecord;
  }

  return createHash('sha256').update(stableJson(normalizedBody) ?? 'null').digest('hex');
}
