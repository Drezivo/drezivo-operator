export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

export const errorBody = (code: string, message: string, requestId: string) => ({
  success: false,
  error: { code, message },
  request_id: requestId,
});
