import { z } from "zod";
import { moneyInputSchema, optionalMoneyInputSchema } from "./catalog";
import { optionalText, uuidSchema } from "./common";

/**
 * Coupons and flash sales (Phase 6B). Mirrors the checks in the promotion
 * functions of migration 0024; the database stays the final authority.
 */

export const COUPON_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

export const applyCouponSchema = z.object({
  code: z.string().trim().min(1, { error: "Enter a code." }).max(32, { error: "Codes are at most 32 characters." }),
});

/** "12.5" → 1250 basis points (no floating point). Null when not a valid 0.01–100 percentage. */
export function percentToBasisPoints(input: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  return bps >= 1 && bps <= 10_000 ? bps : null;
}

/** 1250 → "12.5" for form inputs. */
export function basisPointsToPercentInput(bps: number): string {
  const whole = Math.floor(bps / 100);
  const fraction = bps % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}

const optionalCount = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : Number(value)),
  z
    .number({ error: "Enter a whole number." })
    .int({ error: "Enter a whole number." })
    .min(1, { error: "Use at least 1 (or leave empty for no limit)." })
    .max(1_000_000)
    .optional(),
);

/** `<input type="datetime-local">` value, interpreted as UTC. */
const optionalDateTime = optionalText(
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, { error: "Enter a date and time." }),
);

export function dateTimeInputToIso(value: string | undefined): string | null {
  if (!value) return null;
  return new Date(`${value.length === 16 ? `${value}:00` : value}Z`).toISOString();
}

/** ISO timestamp → "YYYY-MM-DDTHH:MM" (UTC) for datetime-local inputs. */
export function isoToDateTimeInput(value: string | null | undefined): string {
  return value ? new Date(value).toISOString().slice(0, 16) : "";
}

export const couponFormSchema = z
  .object({
    couponId: optionalText(uuidSchema),
    code: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .pipe(z.string().regex(COUPON_CODE_PATTERN, { error: "Use 3–32 letters, numbers, hyphens or underscores." })),
    name: z.string().trim().min(2, { error: "Give the code a name." }).max(120),
    description: optionalText(z.string().trim().max(500, { error: "Keep the description under 500 characters." })),
    discountType: z.enum(["percentage", "fixed_amount", "free_shipping"]),
    percent: optionalText(z.string().trim()),
    amount: optionalMoneyInputSchema,
    minSubtotal: optionalMoneyInputSchema,
    maxDiscount: optionalMoneyInputSchema,
    usageLimit: optionalCount,
    usageLimitPerCustomer: optionalCount,
    startsAt: optionalDateTime,
    endsAt: optionalDateTime,
  })
  .superRefine((data, ctx) => {
    if (data.discountType === "percentage" && (!data.percent || percentToBasisPoints(data.percent) === null)) {
      ctx.addIssue({ code: "custom", message: "Enter a percentage between 0.01 and 100.", path: ["percent"] });
    }
    if (data.discountType === "fixed_amount" && (!data.amount || Number(data.amount) <= 0)) {
      ctx.addIssue({ code: "custom", message: "Enter the discount amount.", path: ["amount"] });
    }
    if (data.discountType !== "percentage" && data.maxDiscount) {
      ctx.addIssue({
        code: "custom",
        message: "A maximum discount applies to percentage codes only.",
        path: ["maxDiscount"],
      });
    }
    if (data.startsAt && data.endsAt && dateTimeInputToIso(data.endsAt)! <= dateTimeInputToIso(data.startsAt)!) {
      ctx.addIssue({ code: "custom", message: "The end must be after the start.", path: ["endsAt"] });
    }
  });
export type CouponFormInput = z.input<typeof couponFormSchema>;
export type CouponFormValues = z.output<typeof couponFormSchema>;

export const couponActiveSchema = z.object({ couponId: uuidSchema, active: z.boolean() });

export const adminDisableSchema = z.object({
  id: uuidSchema,
  reason: z
    .string()
    .trim()
    .min(3, { error: "Give a reason (at least 3 characters)." })
    .max(500, { error: "Keep the reason under 500 characters." }),
});

export const flashSaleFormSchema = z
  .object({
    saleId: optionalText(uuidSchema),
    name: z.string().trim().min(2, { error: "Give the sale a name." }).max(120),
    description: optionalText(z.string().trim().max(500, { error: "Keep the description under 500 characters." })),
    startsAt: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, { error: "Enter a start date and time." }),
    endsAt: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, { error: "Enter an end date and time." }),
    items: z
      .array(
        z.object({
          variantId: uuidSchema,
          salePrice: moneyInputSchema,
          quantityLimit: optionalCount,
        }),
      )
      .max(200, { error: "A flash sale can have at most 200 items." })
      .refine((items) => new Set(items.map((item) => item.variantId)).size === items.length, {
        error: "Each product option can be listed once.",
      }),
  })
  .refine((data) => dateTimeInputToIso(data.endsAt)! > dateTimeInputToIso(data.startsAt)!, {
    error: "The sale must end after it starts.",
    path: ["endsAt"],
  });
export type FlashSaleFormInput = z.input<typeof flashSaleFormSchema>;
export type FlashSaleFormValues = z.output<typeof flashSaleFormSchema>;

export const COUPON_TYPE_LABELS: Record<string, string> = {
  percentage: "Percentage off",
  fixed_amount: "Amount off",
  free_shipping: "Free shipping",
};
