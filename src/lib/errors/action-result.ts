import type { SerializedAppError } from "./app-error";
import { toAppError } from "./map-errors";

/**
 * Discriminated result returned by every Server Action so client components
 * can render success or failure without try/catch over the network boundary.
 */
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: SerializedAppError };

export function actionSuccess<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function actionFailure<T = never>(error: unknown): ActionResult<T> {
  const appError = toAppError(error);
  if (appError.status >= 500) {
    // Server-side detail for operators; the user only sees appError.message.
    console.error(`[action:${appError.code}]`, appError.cause ?? appError);
  }
  return { ok: false, error: appError.toJSON() };
}

/**
 * Wraps an async action body so that any thrown error becomes a failure result.
 */
export async function runAction<T>(body: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return actionSuccess(await body());
  } catch (error) {
    return actionFailure<T>(error);
  }
}
