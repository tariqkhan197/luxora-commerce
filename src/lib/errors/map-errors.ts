import { ZodError } from "zod";
import { AppError, type FieldErrors } from "./app-error";

/** Minimal structural type shared by PostgREST and Supabase Storage errors. */
export interface PostgrestLikeError {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/** Minimal structural type for Supabase Auth errors. */
export interface AuthLikeError {
  message: string;
  status?: number;
  code?: string;
}

/**
 * Maps PostgreSQL / PostgREST error codes to application errors. Database
 * messages are never forwarded to the user.
 */
export function fromPostgrestError(error: PostgrestLikeError): AppError {
  // supabase-js surfaces transport failures as a PostgREST-shaped error with an empty code.
  if (
    !error.code &&
    /fetch failed|network|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(`${error.message} ${error.details ?? ""}`)
  ) {
    return new AppError("NETWORK", { cause: error });
  }
  switch (error.code) {
    case "PGRST116": // no rows returned for .single()
      return new AppError("NOT_FOUND", { cause: error });
    case "42501": // insufficient_privilege (RLS)
      return new AppError("FORBIDDEN", { cause: error });
    case "23505": // unique_violation
      return new AppError("CONFLICT", { cause: error });
    case "23503": // foreign_key_violation
      return new AppError("VALIDATION", { message: "A referenced record does not exist.", cause: error });
    case "23514": // check_violation
    case "22P02": // invalid_text_representation
    case "22001": // string_data_right_truncation
      return new AppError("VALIDATION", { cause: error });
    case "P0001": // raise_exception (business rule inside a function)
      return new AppError("VALIDATION", { message: sanitizeRaisedMessage(error.message), cause: error });
    case "P0002": // no_data_found
      return new AppError("NOT_FOUND", { cause: error });
    case "40001": // serialization_failure
    case "40P01": // deadlock_detected
      return new AppError("DATABASE", {
        message: "The request conflicted with another update. Please retry.",
        cause: error,
      });
    default:
      return new AppError("DATABASE", { cause: error });
  }
}

/**
 * Messages raised deliberately by our own database functions are written to
 * be user-presentable, but we still cap and strip them defensively.
 */
function sanitizeRaisedMessage(message: string): string {
  const cleaned = message.replace(/\s+/g, " ").trim();
  return cleaned.length > 160 ? `${cleaned.slice(0, 157)}…` : cleaned;
}

/** Maps Supabase Auth errors to application errors with safe, specific wording. */
export function fromAuthError(error: AuthLikeError): AppError {
  const code = error.code ?? "";
  switch (code) {
    case "invalid_credentials":
      return new AppError("UNAUTHORIZED", { message: "Incorrect email or password.", cause: error });
    case "email_not_confirmed":
      return new AppError("UNAUTHORIZED", {
        message: "Please verify your email address before signing in.",
        cause: error,
      });
    case "user_already_exists":
    case "email_exists":
      return new AppError("CONFLICT", { message: "An account with this email already exists.", cause: error });
    case "weak_password":
      return new AppError("VALIDATION", {
        message: "Please choose a stronger password.",
        fieldErrors: { password: ["Please choose a stronger password."] },
        cause: error,
      });
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return new AppError("RATE_LIMITED", { cause: error });
    case "otp_expired":
      return new AppError("UNAUTHORIZED", {
        message: "This link has expired. Please request a new one.",
        cause: error,
      });
    case "same_password":
      return new AppError("VALIDATION", {
        message: "Your new password must be different from the current one.",
        fieldErrors: { password: ["Choose a password you haven't used before."] },
        cause: error,
      });
    case "session_not_found":
    case "refresh_token_not_found":
      return new AppError("UNAUTHORIZED", { cause: error });
    default:
      if (error.status === 429) return new AppError("RATE_LIMITED", { cause: error });
      if (error.status === 422) return new AppError("VALIDATION", { cause: error });
      return new AppError("INTERNAL", { cause: error });
  }
}

/** Flattens a Zod error into `{ field: [messages] }`. */
export function fieldErrorsFromZod(error: ZodError): FieldErrors {
  const result: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.map(String).join(".") : "_form";
    (result[key] ??= []).push(issue.message);
  }
  return result;
}

/** Normalises any thrown value to an AppError. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) return AppError.validation(fieldErrorsFromZod(error));
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return new AppError("NETWORK", { cause: error });
  }
  if (isPostgrestLike(error)) return fromPostgrestError(error);
  return new AppError("INTERNAL", { cause: error });
}

function isPostgrestLike(error: unknown): error is PostgrestLikeError {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string" &&
    /^[0-9A-Z]{5}$|^PGRST\d{3}$/.test((error as { code: string }).code)
  );
}
