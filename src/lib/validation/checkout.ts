import { z } from "zod";
import { countryCodeSchema, fullNameSchema, optionalText, phoneSchema, urlSchema, uuidSchema } from "./common";

// -----------------------------------------------------------------------------
// Cart
// -----------------------------------------------------------------------------
const quantityInput = (min: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : value),
    z
      .number({ error: "Enter a quantity." })
      .int({ error: "Quantity must be a whole number." })
      .min(min, { error: `Quantity must be at least ${min}.` })
      .max(99, { error: "Quantity cannot exceed 99." }),
  );

export const addToCartSchema = z.object({
  variantId: uuidSchema,
  quantity: quantityInput(1).default(1),
});
export type AddToCartInput = z.input<typeof addToCartSchema>;

/** Quantity 0 removes the line. */
export const updateCartItemSchema = z.object({
  cartItemId: uuidSchema,
  quantity: quantityInput(0),
});

// -----------------------------------------------------------------------------
// Addresses (mirror the CHECK constraints on public.addresses)
// -----------------------------------------------------------------------------
export const ADDRESS_TYPES = ["both", "shipping", "billing"] as const;

export const addressSchema = z.object({
  type: z.enum(ADDRESS_TYPES).default("both"),
  label: optionalText(z.string().trim().max(40, { error: "Keep the label under 40 characters." })),
  fullName: fullNameSchema,
  phone: optionalText(phoneSchema),
  line1: z.string().trim().min(1, { error: "Street address is required." }).max(200),
  line2: optionalText(z.string().trim().max(200)),
  city: z.string().trim().min(1, { error: "City is required." }).max(100),
  state: optionalText(z.string().trim().max(100)),
  postalCode: z.string().trim().min(1, { error: "Postal code is required." }).max(20),
  countryCode: z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
    countryCodeSchema,
  ),
  isDefaultShipping: z.boolean().default(false),
  isDefaultBilling: z.boolean().default(false),
});
export type AddressInput = z.input<typeof addressSchema>;
export type AddressValues = z.output<typeof addressSchema>;

// -----------------------------------------------------------------------------
// Checkout
// -----------------------------------------------------------------------------
export const placeOrderSchema = z
  .object({
    shippingAddressId: uuidSchema,
    billingSameAsShipping: z.boolean().default(true),
    billingAddressId: optionalText(uuidSchema),
    /** Idempotency key issued with the checkout page; replays return the same order. */
    checkoutToken: uuidSchema,
    /** Total the customer saw. The database recomputes and rejects a mismatch. */
    expectedTotalMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    note: optionalText(z.string().trim().max(1000, { error: "Notes must be 1000 characters or fewer." })),
  })
  .refine((data) => data.billingSameAsShipping || Boolean(data.billingAddressId), {
    error: "Choose a billing address.",
    path: ["billingAddressId"],
  });
export type PlaceOrderInput = z.input<typeof placeOrderSchema>;

// -----------------------------------------------------------------------------
// Vendor fulfilment
// -----------------------------------------------------------------------------
export const FULFILMENT_STATUSES = ["processing", "shipped", "delivered"] as const;

export const vendorFulfilmentSchema = z
  .object({
    vendorOrderId: uuidSchema,
    status: z.enum(FULFILMENT_STATUSES),
    carrier: optionalText(z.string().trim().max(60)),
    trackingNumber: optionalText(z.string().trim().max(80)),
    trackingUrl: optionalText(urlSchema),
  })
  .refine((data) => data.status !== "shipped" || Boolean(data.carrier && data.trackingNumber), {
    error: "Add the carrier and tracking number when marking as shipped.",
    path: ["trackingNumber"],
  });
export type VendorFulfilmentInput = z.input<typeof vendorFulfilmentSchema>;
