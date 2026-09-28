import { ApiError } from "./api";

export const CLERK_TOKEN_TIMEOUT_MS = 10_000;

export async function getTokenWithTimeout(
  getToken: () => Promise<string | null>,
  signal?: AbortSignal,
): Promise<string | null> {
  if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new ApiError(
      "Operator sign-in did not respond in time. Try again.",
      "network",
      undefined,
      "AUTH_TOKEN_TIMEOUT",
    )), CLERK_TOKEN_TIMEOUT_MS);
    abortHandler = () => reject(new DOMException("Request aborted", "AbortError"));
    signal?.addEventListener("abort", abortHandler, { once: true });
  });
  try {
    return await Promise.race([getToken(), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (abortHandler) signal?.removeEventListener("abort", abortHandler);
  }
}
