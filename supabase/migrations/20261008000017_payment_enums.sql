-- =============================================================================
-- Migration 0017 (Phase 4b): payment enum values and types.
-- -----------------------------------------------------------------------------
-- Kept separate on purpose: PostgreSQL cannot use an enum value in the same
-- transaction that adds it, and `supabase db push` applies each migration in
-- its own transaction. Migration 0018 uses these values.
-- =============================================================================

-- payment_status gains the two states hosted checkout needs:
--   processing — the customer finished checkout but the money has not settled
--                (only reachable with delayed payment methods, which Luxora
--                does not enable; handled for safety)
--   expired    — the payment window closed without a payment
alter type public.payment_status add value if not exists 'processing' after 'pending';
alter type public.payment_status add value if not exists 'expired' after 'cancelled';

-- One hosted-checkout attempt (a Stripe Checkout Session) for an order.
create type public.payment_attempt_status as enum ('open', 'complete', 'expired', 'failed', 'cancelled');

-- Processing state of a received provider webhook event.
create type public.webhook_event_status as enum ('received', 'processed', 'failed', 'ignored');
