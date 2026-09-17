export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

export const errorBody = (code: string, message: string, requestId: string) => ({ error: { code, message, requestId } });
