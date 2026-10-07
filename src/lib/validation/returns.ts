import { z } from "zod";
import { optionalText, urlSchema, uuidSchema } from "./common";

// -----------------------------------------------------------------------------
// Customer: request a return for items of one shipment (vendor order)
// -----------------------------------------------------------------------------
export const returnRequestSchema = z
  .object({
    vendorOrderId: uuidSchema,
    note: optionalText(z.string().trim().max(1000, { error: "Keep the note under 1000 characters." })),
    items: z
      .array(
        z.object({
          orderItemId: uuidSchema,
          quantity: z.preprocess(
            (value) => (value === "" || value === undefined ? 0 : Number(value)),
            z.number({ error: "Enter a whole number." }).int({ error: "Enter a whole number." }).min(0).max(99),
          ),
          reason: z.string().trim().max(500, { error: "Keep the reason under 500 characters." }).default(""),
        }),
      )
      .max(100),
  })
  .transform((data) => ({ ...data, items: data.items.filter((item) => item.quantity > 0) }))
  .superRefine((data, ctx) => {
    if (data.items.length === 0) {
      ctx.addIssue({ code: "custom", message: "Choose at least one item to return.", path: ["items"] });
    }
    data.items.forEach((item) => {
      if (item.reason.length < 3) {
        ctx.addIssue({
          code: "custom",
          message: "Tell us why you are returning each item (at least 3 characters).",
          path: ["items"],
        });
      }
    });
  });
export type ReturnRequestInput = z.input<typeof returnRequestSchema>;
export type ReturnRequestValues = z.output<typeof returnRequestSchema>;

export const returnShippedSchema = z.object({
  returnId: uuidSchema,
  carrier: z.string().trim().min(2, { error: "Enter the carrier." }).max(60),
  trackingNumber: z.string().trim().min(3, { error: "Enter the tracking number." }).max(80),
  trackingUrl: optionalText(urlSchema),
});
export type ReturnShippedInput = z.input<typeof returnShippedSchema>;

// -----------------------------------------------------------------------------
// Vendor (owner/manager) or admin decisions
// -----------------------------------------------------------------------------
export const approveReturnSchema = z.object({
  returnId: uuidSchema,
  instructions: z
    .string()
    .trim()
    .min(10, { error: "Give the return address and instructions (at least 10 characters)." })
    .max(2000),
});

export const rejectReturnSchema = z.object({
  returnId: uuidSchema,
  reason: z.string().trim().min(3, { error: "Give a reason (at least 3 characters)." }).max(1000),
});

export const receiveReturnSchema = z.object({
  returnId: uuidSchema,
  restock: z.boolean().default(true),
  notes: optionalText(z.string().trim().max(2000)),
});

export const refundReturnSchema = z.object({
  returnId: uuidSchema,
  shipping: z.enum(["policy", "include", "exclude"]).default("policy"),
});

export const RETURN_STATUS_LABELS: Record<string, string> = {
  requested: "Requested",
  approved: "Approved — send it back",
  rejected: "Not accepted",
  in_transit: "On its way back",
  received: "Received",
  completed: "Refund issued",
  cancelled: "Cancelled",
};
