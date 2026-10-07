import { z } from "zod";
import { moneyInputSchema } from "./catalog";
import { optionalText, uuidSchema } from "./common";

// -----------------------------------------------------------------------------
// Admin: refunds (one vendor order at a time)
// -----------------------------------------------------------------------------
export const REFUND_KINDS = ["cancellation", "return", "goodwill"] as const;

export const refundRequestSchema = z
  .object({
    vendorOrderId: uuidSchema,
    kind: z.enum(REFUND_KINDS, { error: "Choose why the refund is issued." }),
    reason: z
      .string()
      .trim()
      .min(3, { error: "Give a reason (at least 3 characters)." })
      .max(1000, { error: "Keep the reason under 1000 characters." }),
    /** "policy" follows the configured shipping-refund policy. */
    shipping: z.enum(["policy", "include", "exclude"]).default("policy"),
    items: z
      .array(
        z.object({
          orderItemId: uuidSchema,
          quantity: z.preprocess(
            (value) => (value === "" || value === undefined ? 0 : Number(value)),
            z.number({ error: "Enter a whole number." }).int({ error: "Enter a whole number." }).min(0).max(99),
          ),
        }),
      )
      .max(100)
      .default([]),
  })
  .transform((data) => ({ ...data, items: data.items.filter((item) => item.quantity > 0) }))
  .refine((data) => data.items.length > 0 || data.shipping === "include", {
    error: "Choose at least one item to refund.",
    path: ["items"],
  });
export type RefundRequestInput = z.input<typeof refundRequestSchema>;
export type RefundRequestValues = z.output<typeof refundRequestSchema>;

export function shippingChoiceToFlag(choice: RefundRequestValues["shipping"]): boolean | null {
  return choice === "include" ? true : choice === "exclude" ? false : null;
}

// -----------------------------------------------------------------------------
// Admin: vendor payouts made outside Stripe
// -----------------------------------------------------------------------------
export const vendorPayoutSchema = z.object({
  vendorId: uuidSchema,
  amount: moneyInputSchema,
  method: z
    .string()
    .trim()
    .min(2, { error: "Describe the payout method (e.g. bank transfer)." })
    .max(60, { error: "Keep the method under 60 characters." }),
  reference: z
    .string()
    .trim()
    .min(2, { error: "Enter the transfer reference." })
    .max(120, { error: "Keep the reference under 120 characters." }),
  notes: optionalText(z.string().trim().max(1000)),
});
export type VendorPayoutInput = z.input<typeof vendorPayoutSchema>;

export const reversePayoutSchema = z.object({
  payoutId: uuidSchema,
  reason: z.string().trim().min(3, { error: "Give a reason (at least 3 characters)." }).max(500),
});
