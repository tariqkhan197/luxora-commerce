/**
 * Application error model.
 *
 * Every failure that crosses a boundary (server action → UI, route handler →
 * client) is normalised to an `AppError` with a stable `code`, an HTTP-style
 * `status` and a user-safe `message`. Internal details stay in `cause` and are
 * only logged on the server — never shown to customers.
 */

export const ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "CONFLICT",
  "RATE_LIMITED",
  "DATABASE",
  "NETWORK",
  "CONFIGURATION",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type FieldErrors = Record<string, string[]>;

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  DATABASE: 500,
  NETWORK: 503,
  CONFIGURATION: 500,
  INTERNAL: 500,
};

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHORIZED: "Please sign in to continue.",
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "We couldn't find what you were looking for.",
  VALIDATION: "Some of the information provided is invalid.",
  CONFLICT: "This conflicts with something that already exists.",
  RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
  DATABASE: "We couldn't complete your request. Please try again.",
  NETWORK: "We're having trouble connecting. Please check your connection and try again.",
  CONFIGURATION: "The service is not configured correctly. Please contact support.",
  INTERNAL: "Something went wrong on our side. Please try again.",
};

export interface AppErrorOptions {
  message?: string;
  fieldErrors?: FieldErrors;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors?: FieldErrors;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? DEFAULT_MESSAGES[code], { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.fieldErrors = options.fieldErrors;
  }

  /** Serialisable shape safe to send to the client. */
  toJSON(): SerializedAppError {
    return { code: this.code, message: this.message, fieldErrors: this.fieldErrors };
  }

  static unauthorized(message?: string) {
    return new AppError("UNAUTHORIZED", { message });
  }
  static forbidden(message?: string) {
    return new AppError("FORBIDDEN", { message });
  }
  static notFound(message?: string) {
    return new AppError("NOT_FOUND", { message });
  }
  static validation(fieldErrors: FieldErrors, message?: string) {
    return new AppError("VALIDATION", { message, fieldErrors });
  }
  static conflict(message?: string) {
    return new AppError("CONFLICT", { message });
  }
}

export interface SerializedAppError {
  code: ErrorCode;
  message: string;
  fieldErrors?: FieldErrors;
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
