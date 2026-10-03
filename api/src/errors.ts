export class AppError extends Error {
  /** `cause` is the underlying failure; it is logged on the server and never sent to the client. */
  constructor(public readonly status: number, public readonly code: string, message: string, options?: { cause?: unknown }) { super(message, options); }
}

export const errorBody = (code: string, message: string, requestId: string) => ({
  success: false,
  error: { code, message },
  request_id: requestId,
});
