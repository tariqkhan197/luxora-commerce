import "server-only";

import Stripe from "stripe";
import { STRIPE_API_VERSION } from "@/config/payments";
import { readStripeConfig, type StripeConfig } from "./config";

let client: Stripe | null = null;
let config: StripeConfig | null = null;

/** Validated Stripe configuration (test-mode keys only unless live payments are approved). */
export function getStripeConfig(): StripeConfig {
  config ??= readStripeConfig(process.env);
  return config;
}

/** Server-side Stripe client, pinned to the API version this integration is tested against. */
export function getStripe(): Stripe {
  client ??= new Stripe(getStripeConfig().secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    appInfo: { name: "Luxora Commerce" },
  });
  return client;
}
