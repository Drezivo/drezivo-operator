export type ApiEnvelope<T> = {
  success: true;
  data: T;
  request_id: string;
} | {
  success: false;
  error: { code: string; message: string };
  request_id: string;
};

export type ApiFailureKind = "unauthorized" | "forbidden" | "unavailable" | "http" | "network" | "invalid_response";
const API_REQUEST_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: ApiFailureKind,
    readonly status?: number,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type ApiOptions = {
  token?: string | null;
  signal?: AbortSignal;
  method?: "GET" | "POST";
  body?: unknown;
  idempotencyKey?: string;
};

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "::1") return true;
  const octets = normalized.split(".");
  return octets.length === 4 && octets[0] === "127"
    && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

function apiBase(): string {
  const configured = process.env.NEXT_PUBLIC_DREZIVO_API_BASE_URL?.trim();
  if (!configured) throw new ApiError("Set NEXT_PUBLIC_DREZIVO_API_BASE_URL to the operator API base URL, including /api/v1.", "unavailable", undefined, "API_BASE_NOT_CONFIGURED");
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new ApiError("NEXT_PUBLIC_DREZIVO_API_BASE_URL must be a valid HTTP or HTTPS URL.", "unavailable", undefined, "API_BASE_INVALID");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ApiError("NEXT_PUBLIC_DREZIVO_API_BASE_URL must be a valid HTTP or HTTPS URL.", "unavailable", undefined, "API_BASE_INVALID");
  }
  const allowsLoopbackHttp = (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test")
    && isLoopbackHostname(parsed.hostname);
  if (parsed.protocol === "http:" && !allowsLoopbackHttp) {
    throw new ApiError("NEXT_PUBLIC_DREZIVO_API_BASE_URL must use HTTPS, except for loopback HTTP during development.", "unavailable", undefined, "API_BASE_INSECURE");
  }
  return configured.replace(/\/$/, "");
}

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<{ data: T; requestId: string }> {
  if (!path.startsWith("/") || path.startsWith("//")) throw new ApiError("The requested resource path is invalid.", "invalid_response");
  if (typeof options.token !== "string" || options.token.trim().length === 0) {
    throw new ApiError("Authentication is required.", "unauthorized", 401, "AUTHENTICATION_REQUIRED");
  }
  const base = apiBase();
  const headers = new Headers({ Accept: "application/json" });
  headers.set("Authorization", `Bearer ${options.token}`);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, API_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${base}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: controller.signal,
    });

    let envelope: ApiEnvelope<T>;
    try {
      envelope = await response.json() as ApiEnvelope<T>;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ApiError("The operator API returned a response this console could not read.", "invalid_response", response.status);
    }
    const requestId = typeof envelope?.request_id === "string" ? envelope.request_id : undefined;
    if (!response.ok || envelope?.success !== true) {
      const code = envelope && !envelope.success ? envelope.error?.code : undefined;
      const serverMessage = envelope && !envelope.success ? envelope.error?.message : undefined;
      const kind: ApiFailureKind = response.status === 401 ? "unauthorized"
        : response.status === 403 ? "forbidden"
          : response.status === 503 || code === "SERVICE_UNAVAILABLE" ? "unavailable" : "http";
      throw new ApiError(serverMessage || `The request failed with status ${response.status}.`, kind, response.status, code, requestId);
    }
    if (!requestId || !("data" in envelope)) throw new ApiError("The operator API response is missing required fields.", "invalid_response", response.status);
    return { data: envelope.data, requestId };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) throw new ApiError("The operator API took too long to respond. Try again.", "network", undefined, "API_REQUEST_TIMEOUT");
    if (options.signal?.aborted) throw new DOMException("Request aborted", "AbortError");
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("The operator API could not be reached. Check the API address and try again.", "network");
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export type Overview = {
  as_of: string;
  businesses: { total: number; by_status: Array<{ status: "active" | "restricted" | "cancelled"; count: number }> };
  subscriptions: {
    active: number;
    trial: number;
    grace: number;
    past_due: number;
    restricted: number;
    cancelled: number;
    missing: number;
    lifecycle: {
      expired_trials: number;
      expired_grace: number;
      incomplete_trials: number;
      incomplete_grace: number;
    };
  };
  attention: { failed_jobs: number; failed_notifications: number; active_support_grants: number };
  recent_businesses: Array<{ id: string; name: string; slug: string; status: "active" | "restricted" | "cancelled"; created_at: string }>;
};

export type PageData = { items: Array<Record<string, unknown>>; next_cursor?: string | null };

export function withCursor(path: string, cursor: string | null): string {
  if (!cursor) return path;
  return `${path}${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`;
}

export type ResourceResponseMap = {
  overview: Overview;
  businesses: PageData | Record<string, unknown>;
  subscriptions: PageData;
  entitlements: { capabilities: Array<{ capability: string; enabled: boolean; limit_value: number | null }> };
  audit: PageData;
  operators: PageData;
  jobs: PageData;
  notifications: PageData;
  analytics: import("./analytics").AnalyticsResponse;
};

export const resourcePaths = {
  overview: "/overview",
  businesses: "/businesses?limit=25",
  subscriptions: "/subscriptions?limit=25",
  entitlements: "/businesses",
  audit: "/audit-events?limit=25",
  operators: "/operators?limit=25",
  jobs: "/jobs?limit=25",
  notifications: "/notifications?limit=25",
  analytics: "/analytics?months=48",
} as const;

export function resourceRequest<K extends keyof ResourceResponseMap>(resource: K, path: string, options: ApiOptions = {}) {
  return apiRequest<ResourceResponseMap[K]>(path, options);
}
