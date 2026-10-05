import { z } from "zod";

/**
 * Shared validation primitives. Mirrors the CHECK constraints in the database
 * so that input is rejected early with friendly messages, while the database
 * remains the final authority.
 */

export const emailSchema = z
  .string({ error: "Enter a valid email address." })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email address." }).max(254, { error: "Email address is too long." }));

/** E.164-ish: optional +, digits, spaces, parentheses and hyphens; 7–20 chars. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9(][0-9 ()-]{6,19}$/, { error: "Enter a valid phone number." });

export const passwordSchema = z
  .string()
  .min(10, { error: "Use at least 10 characters." })
  .max(128, { error: "Password is too long." })
  .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value), {
    error: "Include upper and lower case letters and a number.",
  });

export const fullNameSchema = z
  .string()
  .trim()
  .min(1, { error: "Name is required." })
  .max(120, { error: "Name is too long." });

export const slugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: "Use lowercase letters, numbers and single hyphens." })
  .min(2, { error: "Slug is too short." })
  .max(120, { error: "Slug is too long." });

export const uuidSchema = z.uuid({ error: "Invalid identifier." });

export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, { error: "Currency must be a 3-letter ISO code." });

/** Money in integer minor units (never floats). */
export const moneyMinorSchema = z
  .number({ error: "Amount must be a number." })
  .int({ error: "Amount must be in whole minor units (e.g. cents)." })
  .min(0, { error: "Amount cannot be negative." })
  .max(Number.MAX_SAFE_INTEGER);

/** Positive money in minor units. */
export const positiveMoneyMinorSchema = moneyMinorSchema.min(1, { error: "Amount must be greater than zero." });

/** Rates in basis points: 0..10000 (0%..100%). */
export const basisPointsSchema = z
  .number({ error: "Rate must be a number." })
  .int({ error: "Rate must be a whole number of basis points." })
  .min(0, { error: "Rate cannot be negative." })
  .max(10_000, { error: "Rate cannot exceed 100%." });

/**
 * Accepts a human-entered percentage ("12.5") and converts to basis points.
 * Uses string arithmetic to avoid floating point drift.
 */
export const percentageInputSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, { error: "Enter a percentage like 12.5." })
  .transform((value) => {
    const [whole, fraction = ""] = value.split(".");
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  })
  .pipe(basisPointsSchema);

export const urlSchema = z.url({ protocol: /^https?$/, error: "Enter a valid http(s) URL." });

export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, { error: "Country must be a 2-letter ISO code." });

export const positiveQuantitySchema = z
  .number({ error: "Quantity must be a number." })
  .int({ error: "Quantity must be a whole number." })
  .min(1, { error: "Quantity must be at least 1." })
  .max(99, { error: "Quantity cannot exceed 99." });

/** Helper for enum-backed status fields. */
export function statusSchema<const T extends readonly [string, ...string[]]>(values: T) {
  return z.enum(values, { error: `Status must be one of: ${values.join(", ")}.` });
}

export const USER_ROLES = ["customer", "vendor", "admin", "super_admin"] as const;
export const userRoleSchema = statusSchema(USER_ROLES);

export const VENDOR_STATUSES = ["pending", "approved", "suspended", "rejected", "closed"] as const;
export const vendorStatusSchema = statusSchema(VENDOR_STATUSES);

export const PRODUCT_STATUSES = ["draft", "pending_review", "active", "rejected", "archived"] as const;
export const productStatusSchema = statusSchema(PRODUCT_STATUSES);

/** Converts "" to undefined so optional text inputs validate cleanly. */
export const optionalText = (schema: z.ZodType<string>) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), schema.optional());
