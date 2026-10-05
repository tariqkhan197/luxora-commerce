import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import type { SerializedAppError } from "@/lib/errors";

/**
 * Pushes field-level errors from a failed ActionResult into React Hook Form
 * and returns the message that should be shown at form level (if any).
 */
export function applyActionError<T extends FieldValues>(
  setError: UseFormSetError<T>,
  error: SerializedAppError,
  knownFields: readonly Path<T>[],
): string | null {
  let appliedToField = false;
  for (const [field, messages] of Object.entries(error.fieldErrors ?? {})) {
    if ((knownFields as readonly string[]).includes(field) && messages.length) {
      setError(field as Path<T>, { type: "server", message: messages[0] });
      appliedToField = true;
    }
  }
  const formLevel = error.fieldErrors?._form?.[0];
  if (formLevel) return formLevel;
  return appliedToField ? null : error.message;
}
