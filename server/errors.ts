import type { ApiErrorBody, ErrorCode } from '../shared/types.ts';

export interface AppErrorOptions {
  hint?: string;
  retryAfterSeconds?: number;
  details?: string[];
}

/** An error whose message is safe to show to the person using the app. */
export class AppError extends Error {
  code: ErrorCode;
  status: number;
  hint: string | undefined;
  retryAfterSeconds: number | undefined;
  details: string[] | undefined;

  constructor(code: ErrorCode, message: string, status: number, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.hint = options.hint;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.details = options.details;
  }

  toBody(): ApiErrorBody {
    const body: ApiErrorBody = { code: this.code, message: this.message };
    if (this.hint) body.hint = this.hint;
    if (this.retryAfterSeconds !== undefined) body.retryAfterSeconds = this.retryAfterSeconds;
    if (this.details && this.details.length > 0) body.details = this.details;
    return body;
  }
}

/** Anything that is not an AppError becomes a generic error. The raw message is never exposed. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  return new AppError('internal', 'Unexpected server error. Check the server logs and retry.', 500);
}
