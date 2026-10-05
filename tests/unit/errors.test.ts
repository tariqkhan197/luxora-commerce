import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  actionFailure,
  AppError,
  fieldErrorsFromZod,
  fromAuthError,
  fromPostgrestError,
  runAction,
  toAppError,
} from "@/lib/errors";

describe("AppError", () => {
  it("carries a code, status and a user-safe default message", () => {
    const error = AppError.forbidden();
    expect(error.code).toBe("FORBIDDEN");
    expect(error.status).toBe(403);
    expect(error.message).toMatch(/permission/);
    expect(error.toJSON()).toEqual({ code: "FORBIDDEN", message: error.message, fieldErrors: undefined });
  });
});

describe("fromPostgrestError", () => {
  it("maps database codes without leaking database messages", () => {
    const dbError = { code: "23505", message: 'duplicate key value violates unique constraint "vendors_slug_key"' };
    const mapped = fromPostgrestError(dbError);
    expect(mapped.code).toBe("CONFLICT");
    expect(mapped.message).not.toContain("vendors_slug_key");
    expect(mapped.cause).toBe(dbError);
  });

  it("maps RLS denials to FORBIDDEN and missing rows to NOT_FOUND", () => {
    expect(fromPostgrestError({ code: "42501", message: "permission denied" }).code).toBe("FORBIDDEN");
    expect(fromPostgrestError({ code: "PGRST116", message: "no rows" }).code).toBe("NOT_FOUND");
    expect(fromPostgrestError({ code: "P0002", message: "no inventory record" }).code).toBe("NOT_FOUND");
  });

  it("surfaces deliberate business-rule messages raised by our functions", () => {
    const mapped = fromPostgrestError({ code: "P0001", message: "insufficient stock: have 3, requested change -4" });
    expect(mapped.code).toBe("VALIDATION");
    expect(mapped.message).toBe("insufficient stock: have 3, requested change -4");
  });

  it("falls back to a generic DATABASE error", () => {
    expect(fromPostgrestError({ code: "XX000", message: "internal" }).code).toBe("DATABASE");
  });
});

describe("fromAuthError", () => {
  it("maps Supabase auth codes to specific messages", () => {
    expect(fromAuthError({ message: "x", code: "invalid_credentials" }).message).toBe("Incorrect email or password.");
    expect(fromAuthError({ message: "x", code: "email_not_confirmed" }).code).toBe("UNAUTHORIZED");
    expect(fromAuthError({ message: "x", code: "user_already_exists" }).code).toBe("CONFLICT");
    expect(fromAuthError({ message: "x", code: "weak_password" }).fieldErrors).toEqual({
      password: ["Please choose a stronger password."],
    });
    expect(fromAuthError({ message: "x", status: 429 }).code).toBe("RATE_LIMITED");
    expect(fromAuthError({ message: "x" }).code).toBe("INTERNAL");
  });
});

describe("toAppError and action results", () => {
  const schema = z.object({ email: z.email(), age: z.number().int().min(18) });

  it("flattens Zod errors to field errors", () => {
    const result = schema.safeParse({ email: "nope", age: 12 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = fieldErrorsFromZod(result.error);
      expect(Object.keys(fields).sort()).toEqual(["age", "email"]);
      const appError = toAppError(result.error);
      expect(appError.code).toBe("VALIDATION");
      expect(appError.fieldErrors).toEqual(fields);
    }
  });

  it("passes AppError through untouched and wraps unknown errors", () => {
    const original = AppError.notFound();
    expect(toAppError(original)).toBe(original);
    expect(toAppError(new Error("boom")).code).toBe("INTERNAL");
    expect(toAppError({ code: "23514", message: "check" }).code).toBe("VALIDATION");
  });

  it("produces serialisable failure results and logs server faults", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = actionFailure(new Error("secret internal detail"));
    expect(failure).toEqual({
      ok: false,
      error: { code: "INTERNAL", message: expect.not.stringContaining("secret"), fieldErrors: undefined },
    });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();

    const validation = actionFailure(AppError.validation({ email: ["Required"] }));
    expect(validation.ok).toBe(false);
    if (!validation.ok) expect(validation.error.fieldErrors).toEqual({ email: ["Required"] });
  });

  it("runAction wraps success and failure", async () => {
    expect(await runAction(async () => 42)).toEqual({ ok: true, data: 42 });
    const failed = await runAction(async () => {
      throw AppError.unauthorized();
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe("UNAUTHORIZED");
  });
});
