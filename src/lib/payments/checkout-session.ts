import type Stripe from "stripe";
import { CHECKOUT_PAYMENT_METHODS } from "@/config/payments";

/**
 * Builds the hosted-checkout (Stripe Checkout Session) request for an order.
 *
 * Pure and deterministic: every amount comes from the order rows written by
 * `place_order()` — never from the cart or the browser — and the builder
 * refuses to produce a session whose line items do not add up to the order
 * total exactly. The webhook re-checks the paid amount against the database.
 */

/** Shape of the address snapshot stored on orders (see public.address_snapshot). */
export interface CheckoutAddress {
  full_name?: string | null;
  phone?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
}

export interface CheckoutOrderItem {
  productName: string;
  variantTitle: string;
  sku: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  imageUrl?: string | null;
  /** Stripe product tax code snapshot (tax readiness; not used while tax is disabled). */
  taxCode?: string | null;
}

export interface CheckoutOrder {
  id: string;
  orderNumber: string;
  currency: string;
  subtotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  customerEmail: string;
  shippingAddress: CheckoutAddress;
  items: CheckoutOrderItem[];
}

export interface CheckoutSessionOptions {
  attemptNo: number;
  expiresAt: Date;
  successUrl: string;
  cancelUrl: string;
  /** Provider customer to attach (saved details, receipts); falls back to the order email. */
  customerId?: string | null;
}

export class CheckoutAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutAmountError";
  }
}

/** Stripe allows at most 100 line items per session (the bag is capped to match). */
export const MAX_CHECKOUT_LINE_ITEMS = 100;

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function checkoutLineTotal(order: Pick<CheckoutOrder, "items" | "shippingMinor" | "taxMinor">): number {
  return (
    order.items.reduce((sum, item) => sum + item.unitPriceMinor * item.quantity, 0) +
    order.shippingMinor +
    order.taxMinor
  );
}

/** Throws unless the order's rows describe exactly the amount that will be charged. */
export function assertCheckoutAmounts(order: CheckoutOrder): void {
  if (order.items.length === 0) throw new CheckoutAmountError("The order has no items.");
  if (order.items.length > MAX_CHECKOUT_LINE_ITEMS) {
    throw new CheckoutAmountError(`An order can have at most ${MAX_CHECKOUT_LINE_ITEMS} lines.`);
  }
  for (const item of order.items) {
    if (!Number.isSafeInteger(item.unitPriceMinor) || item.unitPriceMinor < 0) {
      throw new CheckoutAmountError(`Invalid price for ${item.sku}.`);
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new CheckoutAmountError(`Invalid quantity for ${item.sku}.`);
    }
    if (item.unitPriceMinor * item.quantity !== item.totalMinor) {
      throw new CheckoutAmountError(`Line total for ${item.sku} does not match its price and quantity.`);
    }
  }
  if (order.taxMinor !== 0) {
    throw new CheckoutAmountError("Tax collection is not enabled.");
  }
  const merchandise = order.items.reduce((sum, item) => sum + item.totalMinor, 0);
  if (merchandise !== order.subtotalMinor) {
    throw new CheckoutAmountError("Item totals do not add up to the order subtotal.");
  }
  if (checkoutLineTotal(order) !== order.totalMinor) {
    throw new CheckoutAmountError("Line items and shipping do not add up to the order total.");
  }
}

function stripeShipping(
  address: CheckoutAddress,
): Stripe.Checkout.SessionCreateParams.PaymentIntentData.Shipping | undefined {
  if (!address.full_name || !address.line1 || !address.country_code) return undefined;
  return {
    name: clip(address.full_name, 120),
    phone: address.phone ?? undefined,
    address: {
      line1: address.line1,
      line2: address.line2 ?? undefined,
      city: address.city ?? undefined,
      state: address.state ?? undefined,
      postal_code: address.postal_code ?? undefined,
      country: address.country_code,
    },
  };
}

export function buildCheckoutSessionParams(
  order: CheckoutOrder,
  options: CheckoutSessionOptions,
): Stripe.Checkout.SessionCreateParams {
  assertCheckoutAmounts(order);
  const currency = order.currency.toLowerCase();
  const metadata = { order_id: order.id, order_number: order.orderNumber, attempt_no: String(options.attemptNo) };

  return {
    mode: "payment",
    ui_mode: "hosted_page",
    client_reference_id: order.id,
    ...(options.customerId ? { customer: options.customerId } : { customer_email: order.customerEmail }),
    line_items: order.items.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency,
        unit_amount: item.unitPriceMinor,
        // Tax readiness: prices exclude tax. Stripe Tax stays disabled in Phase 4b.
        tax_behavior: "exclusive",
        product_data: {
          name: clip(item.productName, 250),
          description: clip(`${item.variantTitle} · ${item.sku}`, 500),
          ...(item.imageUrl ? { images: [item.imageUrl] } : {}),
          ...(item.taxCode ? { tax_code: item.taxCode } : {}),
          metadata: { sku: item.sku },
        },
      },
    })),
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          display_name: order.shippingMinor === 0 ? "Free shipping" : "Shipping",
          fixed_amount: { amount: order.shippingMinor, currency },
          tax_behavior: "exclusive",
        },
      },
    ],
    allowed_payment_method_types: [...CHECKOUT_PAYMENT_METHODS],
    billing_address_collection: "auto",
    // Charge exactly the database total in the order currency.
    adaptive_pricing: { enabled: false },
    // Stripe Tax stays disabled (STRIPE_TAX_ENABLED = false); see docs/PAYMENTS.md.
    automatic_tax: { enabled: false },
    expires_at: Math.floor(options.expiresAt.getTime() / 1000),
    success_url: options.successUrl,
    cancel_url: options.cancelUrl,
    metadata,
    payment_intent_data: {
      description: `Luxora order ${order.orderNumber}`,
      metadata,
      shipping: stripeShipping(order.shippingAddress),
    },
  };
}
