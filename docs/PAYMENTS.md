# Luxora — Payments (Phase 4b, Stripe TEST MODE)

> **Live payments are blocked.** Luxora's merchant-of-record model has not been approved by Stripe, and the
> company, legal and tax details are still placeholders. Everything below runs in Stripe **test mode** only.
> See [Production activation](#production-activation-blocked) for what must happen before real money.

## Model

- **Luxora is the only merchant.** Customers pay Luxora through Stripe hosted Checkout. Vendors never have a
  Stripe account and there is no Stripe Connect.
- **The database is the financial source of truth.** `place_order()` fixes every amount (items, shipping,
  commission) before payment starts. The Checkout Session is built from those order rows and must add up to the
  order total. The webhook re-checks the paid amount against the order before anything is confirmed.
- **Luxora owes vendors through a ledger.** Paid orders post vendor earnings to `vendor_ledger_entries`.
  Earnings become available 14 days after delivery, and an administrator records each payout Luxora makes
  outside Stripe (bank transfer, Wise, …). Vendor bank details are **not** stored.

## Flow

```
Checkout ─ place_order() ─► order (pending, stock reserved 30 min)
        └ begin_payment_attempt()  (customer)          ┐
          Stripe Checkout Session  (server, secret key) ├─ startCheckout()
          record_checkout_session() (service role)     ┘   hold := session expiry + 5 min
        ─► redirect to Stripe ─► pay ─► /checkout/success?session_id=…
Stripe ── signed webhook ─► /api/webhooks/stripe ─► begin_webhook_event (dedupe)
                                                 └► confirm_order_payment()  (idempotent per PaymentIntent)
                                                     commits stock, order → confirmed/paid, ledger postings
```

- `/checkout/success` re-reads the session from Stripe on the server and applies it through the same idempotent
  path, so a slow webhook never leaves the customer guessing. The order page then auto-refreshes until the
  database shows the payment.
- **Pay now / Resume payment:** the order page reuses the open session or starts a new one. Limits: 3 attempts per
  order, and stock is held for at most 120 minutes from placement.
- **Cancel:** open Stripe sessions are expired first. If a session has already been paid, the cancellation is
  refused.
- **Expired or failed:** stock is released and the order is cancelled. "Restore these items to my bag" puts the
  items back at current prices.
- **Late payment:** if money arrives for an order that is no longer payable, `confirm_order_payment` returns
  `refund_required`. The webhook refunds it in full automatically, and the event is audited.

## States

| Customer-facing state | `orders.status` / `payment_status`                                              |
| --------------------- | ------------------------------------------------------------------------------- |
| Awaiting payment      | `pending` / `pending`                                                           |
| Payment processing    | `pending` / `processing` ¹                                                      |
| Paid                  | `confirmed` / `paid`                                                            |
| Payment failed        | `cancelled` / `failed`                                                          |
| Cancelled             | `cancelled` / `cancelled`                                                       |
| Expired               | `cancelled` / `expired`                                                         |
| Refunded              | `refunded` / `refunded`; partial: order status unchanged / `partially_refunded` |

¹ Only reachable with delayed payment methods, which are not enabled (card + Link only; Apple Pay and Google Pay
come with `card`).

## Finance policies (configurable in `platform_settings`)

| Setting                                 | Value      | Meaning                                                             |
| --------------------------------------- | ---------- | ------------------------------------------------------------------- |
| `payments.fee_bearer`                   | `platform` | Stripe fees are Luxora's cost (`vendor` splits them)                |
| `refunds.vendor_liability`              | `none`     | Refunds are borne by Luxora (`net_of_commission` debits the vendor) |
| `disputes.vendor_liability`             | `none`     | Chargebacks are borne by Luxora                                     |
| `refunds.shipping_on_partial`           | `false`    | Partial refunds keep the shipping charge                            |
| `refunds.shipping_on_full_cancellation` | `true`     | A fully cancelled vendor order refunds shipping                     |
| `refunds.shipping_on_full_return`       | `false`    | A fully returned vendor order does not refund shipping              |
| `payouts.hold_days_after_delivery`      | `14`       | Earnings become payable this many days after delivery               |
| `payments.live_mode_enabled`            | `false`    | Database refuses live-mode Stripe data                              |
| `tax.collection_enabled`                | `false`    | Stripe Tax disabled                                                 |
| `payments.minimum_charge_minor`         | `50`       | Discount codes cannot take an order total below this (Stripe min.)  |
| `coupons.max_failed_attempts_per_hour`  | `10`       | Failed discount-code attempts allowed per customer per hour         |

Every fee and loss is recorded in `platform_ledger_entries`: `processing_fee`, `refund_loss`,
`commission_reversed`, `dispute_loss`, `dispute_fee`, `dispute_recovered`, `promotion_cost` and
`promotion_cost_reversed`. That keeps the books exact today and lets the policy change later without changing the
architecture.

## Promotions (Phase 6B)

- **Luxora codes** (and free shipping) are paid by Luxora. The vendor order records the customer's discount and
  `platform_funded_minor`; vendor earnings = total + platform-funded − commission − fee, so earnings and commission
  are unchanged. When the order is paid, `promotion_cost` is posted per vendor order.
- **Vendor codes and flash sales** are paid by the vendor: commission is charged on the discounted (or sale) price
  and no promotion cost is booked.
- **Checkout session.** Line items stay at the price charged per unit; the order discount is a one-time Stripe
  coupon (`amount_off` = the order discount, single use, expiring with the session, idempotency key per attempt);
  the shipping option is the shipping the customer pays. `assertCheckoutAmounts` refuses any session whose lines,
  discount and shipping do not add up to the database total. The webhook amount check is unchanged.
- **Refunds.** Each refund returns what was paid for the refunded units (the line's paid total, split cumulatively)
  and only the shipping the customer paid. Under today's policy (Luxora bears refunds) the refund loss equals the
  amount refunded and promotion costs are not reversed. If `refunds.vendor_liability` becomes `net_of_commission`,
  the vendor repays its own side of the refunded units, commission is reversed and Luxora's funded share is booked
  back as `promotion_cost_reversed`, so Luxora's result on a fully refunded order is zero.

| Scenario (test mode)     | How                                                             | Expect                                                                |
| ------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| Luxora code              | Admin → Coupons → New code (10%); apply in the bag; pay `4242…` | Stripe page shows "Code …"; vendor earnings unchanged; promotion cost |
| Vendor code              | Vendor → Coupons → New code; apply in the bag; pay              | Discount only on that vendor's items; commission on the net price     |
| Free shipping            | Admin → New code, type Free shipping                            | Shipping charged 0; Luxora pays the vendor's shipping                 |
| Flash sale               | Vendor → Flash sales → New flash sale with an item; buy it      | Sale price charged; codes do not apply to it                          |
| Refund a discounted item | Admin → order → Refund one unit                                 | Refund = what was paid for that unit                                  |

## Local setup (test mode)

1. Create or open a Stripe account and stay in **Test mode**. Under **Settings → Payment methods**, enable Cards,
   Link, Apple Pay and Google Pay, and leave delayed methods off.
2. Copy the **test** secret key (`sk_test_…`, or a restricted `rk_test_…` key with write access to Checkout
   Sessions, Customers and Refunds, and read access to PaymentIntents and Balance transactions).
3. Install the Stripe CLI. On Windows, either use `scoop bucket add stripe https://github.com/stripe/scoop-stripe-cli.git`
   then `scoop install stripe`, or download it from the Stripe CLI GitHub releases. Then run:

   ```powershell
   stripe login
   stripe listen --forward-to localhost:3000/api/webhooks/stripe `
     --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,charge.updated,payment_intent.payment_failed,refund.created,refund.updated,refund.failed,charge.dispute.created,charge.dispute.updated,charge.dispute.closed
   ```

   `stripe listen` prints a signing secret (`whsec_…`) for this forwarding session.

4. Add to `.env.local`, then restart `npm run dev`:

   ```
   PAYMENT_PROVIDER=stripe
   STRIPE_SECRET_KEY=sk_test_…
   STRIPE_WEBHOOK_SECRET=whsec_…   # from `stripe listen`
   ```

   Live keys (`sk_live_…`, `rk_live_…`) are refused at startup.

5. Apply the migrations (`supabase db push`). The dev seed `supabase/seeds/dev/0003_shipping.sql` gives the demo
   store a development shipping zone.

### Manual test script (test cards)

| Scenario                       | How                                                                                                             | Expect                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Successful payment             | Card `4242 4242 4242 4242`, any future date, any CVC                                                            | Order **confirmed / paid**, stock committed, vendor earnings pending |
| 3-D Secure                     | Card `4000 0025 0000 3155`, complete the challenge                                                              | Paid                                                                 |
| Declined, then retry           | Card `4000 0000 0000 9995`, then `4242…` on the same page                                                       | Paid on retry; nothing recorded for the decline                      |
| Abandon and resume             | Click "back" on Stripe, then **Resume payment** on the order page                                               | Same session reused while open                                       |
| Cancel while a session is open | **Cancel order**                                                                                                | Session expired at Stripe, order cancelled, stock released           |
| Expiry                         | `stripe checkout sessions expire cs_test_…` (or wait 30 minutes)                                                | Order cancelled as expired; **Restore these items to my bag** works  |
| Duplicate delivery             | `stripe events resend evt_…`                                                                                    | 200 "duplicate event", no double booking                             |
| Partial refund                 | Admin → order → **Refund** one unit                                                                             | Payment partially refunded; `refund_loss` in the platform ledger     |
| Full cancellation refund       | Refund every unit with type "Cancellation"                                                                      | Shipping included, order **refunded**                                |
| Dashboard refund               | Refund in the Stripe Dashboard                                                                                  | Recorded as an external refund                                       |
| Dispute                        | Card `4000 0000 0000 0259`                                                                                      | Dispute recorded with loss and fee                                   |
| Payout                         | Set a vendor order delivered more than 14 days ago (SQL in test only), then Admin → Payouts → **Record payout** | Available balance drops; vendor statement shows the payout           |

## Webhook endpoint

- Route: `POST /api/webhooks/stripe` (Node.js runtime). It is excluded from the session proxy.
- **Signature:** the raw body is verified with the endpoint secret, including the timestamp tolerance. A missing,
  invalid, tampered or stale signature gets **400**.
- **Live mode:** live-mode events get **400** while `LIVE_PAYMENTS_APPROVED` is false.
- **De-duplication:** each event id is recorded once in `payment_webhook_events`.
  - A duplicate gets **200**.
  - An event already being processed gets **409**, so Stripe retries.
  - A failure is stored with its error and gets **500**, so Stripe retries for up to 3 days.
- Events handled: see `HANDLED_EVENT_TYPES` in `src/features/payments/stripe-events.ts`.

## Production activation (blocked)

None of these may happen until **Stripe has approved Luxora's business model** (a single merchant collecting for
independent vendors, without Connect) and the business, legal and tax questions are settled:

1. Replace the legal placeholders in `src/config/legal.ts` and have the policies reviewed. Customers who already
   accepted earlier versions may need to accept the new ones (a re-acceptance flow is not built yet).
2. Decide tax registrations. Stripe Tax needs `STRIPE_TAX_ENABLED`, `tax.collection_enabled` and a
   tax-finalisation step in `confirm_order_payment` (today it refuses any tax amount).
3. Set `LIVE_PAYMENTS_APPROVED = true` in `src/config/payments.ts` (code review) **and**
   `payments.live_mode_enabled = true` (super admin).
4. Register the live webhook endpoint `https://<production-domain>/api/webhooks/stripe` with the events above,
   use a restricted live key, and store `STRIPE_WEBHOOK_SECRET` for that endpoint.
5. Enable `pg_cron` on Supabase so abandoned checkouts are released even without traffic.
6. Choose and document the vendor payout rails (bank transfer, Wise, Payoneer, or Stripe Global Payouts once
   available to the account) and the vendor tax and identity checks they require.
