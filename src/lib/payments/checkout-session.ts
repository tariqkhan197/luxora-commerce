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
  /** Coupon discount allocated to the line (0 without a code). */
  discountMinor?: number;
  /** What the customer pays for the line: quantity × unit price − discount. */
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
  /** Coupon discount on the items (0 without a code). */
  discountMinor?: number;
  shippingMinor: number;
  /** Free-shipping discount (0 without a free-shipping code). */
  shippingDiscountMinor?: number;
  taxMinor: number;
  totalMinor: number;
  /** The discount code, shown on the Stripe page. */
  couponCode?: string | null;
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
  /** One-time Stripe coupon for the order's discount (required when discountMinor > 0). */
  discountCouponId?: string | null;
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

/** Shipping the customer pays (after any free-shipping discount). */
export function chargedShipping(order: Pick<CheckoutOrder, "shippingMinor" | "shippingDiscountMinor">): number {
  return order.shippingMinor - (order.shippingDiscountMinor ?? 0);
}

/** What Stripe will charge: line items − coupon discount + charged shipping + tax. */
export function checkoutLineTotal(
  order: Pick<CheckoutOrder, "items" | "shippingMinor" | "shippingDiscountMinor" | "taxMinor" | "discountMinor">,
): number {
  return (
    order.items.reduce((sum, item) => sum + item.unitPriceMinor * item.quantity, 0) -
    (order.discountMinor ?? 0) +
    chargedShipping(order) +
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
    const discount = item.discountMinor ?? 0;
    if (!Number.isSafeInteger(discount) || discount < 0) {
      throw new CheckoutAmountError(`Invalid discount for ${item.sku}.`);
    }
    if (item.unitPriceMinor * item.quantity - discount !== item.totalMinor) {
      throw new CheckoutAmountError(`Line total for ${item.sku} does not match its price and quantity.`);
    }
  }
  if (order.taxMinor !== 0) {
    throw new CheckoutAmountError("Tax collection is not enabled.");
  }
  const merchandise = order.items.reduce((sum, item) => sum + item.unitPriceMinor * item.quantity, 0);
  if (merchandise !== order.subtotalMinor) {
    throw new CheckoutAmountError("Item totals do not add up to the order subtotal.");
  }
  const discount = order.discountMinor ?? 0;
  if (order.items.reduce((sum, item) => sum + (item.discountMinor ?? 0), 0) !== discount) {
    throw new CheckoutAmountError("Line discounts do not add up to the order discount.");
  }
  const shippingDiscount = order.shippingDiscountMinor ?? 0;
  if (shippingDiscount < 0 || shippingDiscount > order.shippingMinor) {
    throw new CheckoutAmountError("Invalid shipping discount.");
  }
  if (checkoutLineTotal(order) !== order.totalMinor) {
    throw new CheckoutAmountError("Line items and shipping do not add up to the order total.");
  }
}

/** Stripe allows at most 40 characters in a coupon name. */
const STRIPE_COUPON_NAME_MAX = 40;

/**
 * The one-time Stripe coupon carrying an order's discount: exactly the
 * database amount, usable once, expiring with the checkout session.
 */
export function buildDiscountCouponParams(
  order: Pick<CheckoutOrder, "id" | "orderNumber" | "currency" | "discountMinor" | "couponCode">,
  options: Pick<CheckoutSessionOptions, "attemptNo" | "expiresAt">,
): Stripe.CouponCreateParams {
  const amount = order.discountMinor ?? 0;
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new CheckoutAmountError("The order has no discount to apply.");
  }
  return {
    amount_off: amount,
    currency: order.currency.toLowerCase(),
    duration: "once",
    max_redemptions: 1,
    redeem_by: Math.floor(options.expiresAt.getTime() / 1000),
    name: clip(order.couponCode ? `Code ${order.couponCode}` : "Discount", STRIPE_COUPON_NAME_MAX),
    metadata: { order_id: order.id, order_number: order.orderNumber, attempt_no: String(options.attemptNo) },
  };
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
  const couponId = (order.discountMinor ?? 0) > 0 ? options.discountCouponId : null;
  if ((order.discountMinor ?? 0) > 0 && !couponId) {
    throw new CheckoutAmountError("A discounted order needs its Stripe coupon.");
  }
  const currency = order.currency.toLowerCase();
  const shipping = chargedShipping(order);
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
    ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          display_name: shipping === 0 ? "Free shipping" : "Shipping",
          fixed_amount: { amount: shipping, currency },
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
