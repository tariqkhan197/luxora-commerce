import { z } from "zod";
import { moneyInputSchema, optionalMoneyInputSchema } from "./catalog";
import { countryCodeSchema, optionalText, uuidSchema } from "./common";

// -----------------------------------------------------------------------------
// Admin: shipping zones
// -----------------------------------------------------------------------------
export const shippingZoneSchema = z.object({
  id: optionalText(uuidSchema),
  name: z
    .string()
    .trim()
    .min(2, { error: "Name must be at least 2 characters." })
    .max(80, { error: "Name must be 80 characters or fewer." }),
  description: optionalText(z.string().trim().max(300, { error: "Keep the description under 300 characters." })),
  position: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? 0 : Number(value)),
    z.number({ error: "Enter a whole number." }).int({ error: "Enter a whole number." }).min(0).max(100_000),
  ),
  isActive: z.boolean().default(true),
  countries: z
    .array(countryCodeSchema)
    .max(250)
    .default([])
    .refine((codes) => new Set(codes).size === codes.length, { error: "Each country can be listed once." }),
});
export type ShippingZoneInput = z.input<typeof shippingZoneSchema>;
export type ShippingZoneValues = z.output<typeof shippingZoneSchema>;

// -----------------------------------------------------------------------------
// Vendor: shipping rate for one zone
// -----------------------------------------------------------------------------
const optionalDaysSchema = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : Number(value)),
  z
    .number({ error: "Enter a whole number of days." })
    .int({ error: "Enter a whole number of days." })
    .min(0, { error: "Days cannot be negative." })
    .max(120, { error: "Use at most 120 days." })
    .optional(),
);

export const vendorShippingRateSchema = z
  .object({
    zoneId: uuidSchema,
    /** false = the vendor does not ship to this zone (rate row deactivated). */
    enabled: z.boolean(),
    firstItem: moneyInputSchema,
    additionalItem: moneyInputSchema,
    /** Blank = no free shipping. */
    freeOver: optionalMoneyInputSchema,
    minDays: optionalDaysSchema,
    maxDays: optionalDaysSchema,
  })
  .refine((data) => data.minDays === undefined || data.maxDays === undefined || data.maxDays >= data.minDays, {
    error: "The latest delivery day cannot be before the earliest.",
    path: ["maxDays"],
  });
export type VendorShippingRateInput = z.input<typeof vendorShippingRateSchema>;
export type VendorShippingRateValues = z.output<typeof vendorShippingRateSchema>;
