import { AppError } from './errors.js';

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const dependencyError = () => new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business service is unavailable.');
const invalidResponseError = () => new AppError(503, 'DEPENDENCY_INVALID_RESPONSE', 'The business service returned an invalid response.');
const authError = () => new AppError(503, 'OPERATOR_AUTH_UNAVAILABLE', 'Internal service authentication is unavailable.');

export type ServiceAuth = (requestId: string) => string | Promise<string>;
export type InternalServiceClientOptions = {
  baseUrl: string;
  serviceAuth: ServiceAuth;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  allowInsecureTransport?: boolean;
  maxResponseBytes?: number;
};
export type RequestJsonOptions = { requestId: string; method?: string; body?: unknown; headers?: Record<string, string> };
export type JsonResponse<T> = { status: number; data: T | null };

function timeout(value: number | undefined): number {
  const actual = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(actual) || actual < 250 || actual > 30_000) throw new Error('invalid timeout');
  return actual;
}
function base(value: string, insecure: boolean): URL {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('invalid base URL'); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || !parsed.pathname.endsWith('/')) throw new Error('invalid base URL');
  if (parsed.protocol !== 'https:' && !(insecure && parsed.protocol === 'http:')) throw new Error('insecure transport');
  return parsed;
}
function relativeUrl(baseUrl: URL, path: unknown): URL {
  if (typeof path !== 'string' || !path.startsWith('/internal/') || path.startsWith('//') || path.includes('\\')) throw dependencyError();
  let parsed: URL;
  try { parsed = new URL(path, baseUrl); } catch { throw dependencyError(); }
  if (parsed.origin !== baseUrl.origin || !parsed.pathname.startsWith('/internal/')) throw dependencyError();
  return parsed;
}
async function readBounded(response: Response, max: number): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > max)) {
    if (response.body) await response.body.cancel();
    throw dependencyError();
  }
  if (!response.body) return '';
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > max) { await reader.cancel(); throw dependencyError(); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

export class InternalServiceClient {
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly maxResponseBytes: number;
  constructor(private readonly options: InternalServiceClientOptions) {
    try { this.baseUrl = base(options.baseUrl, options.allowInsecureTransport === true); this.timeoutMs = timeout(options.timeoutMs); } catch { throw dependencyError(); }
    this.fetchImpl = options.fetchImpl ?? fetch; this.maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
    if (!Number.isInteger(this.maxResponseBytes) || this.maxResponseBytes < 1 || this.maxResponseBytes > MAX_RESPONSE_BYTES) throw dependencyError();
  }
  async requestJsonResponse<T>(path: string, request: RequestJsonOptions, acceptedStatuses: readonly number[] = [200, 404]): Promise<JsonResponse<T>> {
    if (!Array.isArray(acceptedStatuses) || acceptedStatuses.length === 0 || acceptedStatuses.some((status) => !Number.isInteger(status) || status < 100 || status > 599)) throw dependencyError();
    const url = relativeUrl(this.baseUrl, path);
    if (!request || typeof request !== 'object') throw dependencyError();
    if (typeof request.requestId !== 'string' || !requestIdPattern.test(request.requestId)) throw dependencyError();
    const method = typeof request.method === 'undefined' ? 'GET' : typeof request.method === 'string' ? request.method.toUpperCase() : '';
    if (!allowedMethods.has(method)) throw dependencyError();
    let auth: string;
    try { auth = await this.options.serviceAuth(request.requestId); } catch { throw authError(); }
    if (typeof auth !== 'string' || auth.trim() === '' || /[\r\n]/.test(auth)) throw authError();
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: 'application/json', 'X-Request-ID': request.requestId, Authorization: auth };
      if (request.headers && Object.entries(request.headers).some(([key, value]) => !/^[A-Za-z0-9-]+$/.test(key) || typeof value !== 'string' || value.trim() === '' || /[\r\n]/.test(value))) throw dependencyError();
      Object.assign(headers, request.headers);
      if (request.body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await this.fetchImpl(url, { method, headers, body: request.body === undefined ? undefined : JSON.stringify(request.body), redirect: 'error', signal: controller.signal });
      const text = await readBounded(response, this.maxResponseBytes);
      if (!acceptedStatuses.includes(response.status)) throw dependencyError();
      if (response.status === 404) return { status: response.status, data: null };
      if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw invalidResponseError();
      try { return { status: response.status, data: JSON.parse(text) as T }; } catch { throw invalidResponseError(); }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw dependencyError();
    } finally { clearTimeout(timer); }
  }
  async requestJson<T>(path: string, request: RequestJsonOptions): Promise<T> {
    const result = await this.requestJsonResponse<T>(path, request, [200]);
    if (result.data === null) throw dependencyError();
    return result.data;
  }
}

export function createInternalServiceClient(options: InternalServiceClientOptions): InternalServiceClient { return new InternalServiceClient(options); }
export async function requestJson<T>(client: InternalServiceClient, path: string, options: RequestJsonOptions): Promise<T> { return client.requestJson<T>(path, options); }
