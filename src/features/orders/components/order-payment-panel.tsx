import { AlertCircle, CheckCircle2, Clock, CreditCard, Loader2 } from "lucide-react";
import { ActionButton } from "@/components/shared/action-button";
import { AutoRefresh } from "@/components/shared/auto-refresh";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cancelOrder, payForOrder, restoreCartFromOrder } from "@/features/checkout/actions";
import { formatDateTimeUtc } from "@/lib/format";
import type { Enums, Json } from "@/lib/supabase/database.types";
import { PaymentNotice } from "./payment-notice";

interface OrderPaymentPanelProps {
  order: {
    id: string;
    status: Enums<"order_status">;
    payment_status: Enums<"payment_status">;
    reservation_expires_at: string | null;
    metadata: Json;
    payment_attempts: { attempt_no: number; status: Enums<"payment_attempt_status">; expires_at: string }[];
  };
  /** `?payment=` from the URL: where the customer is coming from. Display only — never trusted for state. */
  returnState: string | null;
  placed: boolean;
  paymentsOn: boolean;
}

function wasRestored(metadata: Json): boolean {
  return Boolean(
    metadata && typeof metadata === "object" && !Array.isArray(metadata) && "cart_restored_at" in metadata,
  );
}

/**
 * Payment state of an order for its customer. Everything shown is read from
 * the database; the `payment` query parameter only chooses the wording.
 */
export function OrderPaymentPanel({ order, returnState, placed, paymentsOn }: OrderPaymentPanelProps) {
  const awaitingPayment = order.status === "pending" && order.payment_status === "pending";
  const holdEnds = order.reservation_expires_at ? formatDateTimeUtc(new Date(order.reservation_expires_at)) : null;

  if (order.payment_status === "paid" || order.payment_status === "partially_refunded") {
    return returnState === "success" ? (
      <Alert variant="success">
        <CheckCircle2 />
        <AlertTitle>Payment received — thank you</AlertTitle>
        <AlertDescription>
          Your order is confirmed. Each brand will ship its items and add tracking here.
        </AlertDescription>
      </Alert>
    ) : null;
  }

  if (order.payment_status === "processing") {
    return (
      <Alert variant="info">
        <Clock />
        <AlertTitle>Payment processing</AlertTitle>
        <AlertDescription>
          Your payment is being confirmed by the payment provider. This page updates automatically.
        </AlertDescription>
        <AutoRefresh />
      </Alert>
    );
  }

  if (awaitingPayment && !paymentsOn) {
    return (
      <div className="flex flex-col gap-3">
        <PaymentNotice reservationExpiresAt={order.reservation_expires_at} />
        <ActionButton
          variant="outline"
          size="sm"
          confirmMessage="Cancel this order and release the items?"
          action={cancelOrder.bind(null, order.id)}
        >
          Cancel order
        </ActionButton>
      </div>
    );
  }

  if (awaitingPayment) {
    const confirming = returnState === "success";
    const hasAttempt = order.payment_attempts.length > 0;
    return (
      <div className="flex flex-col gap-3">
        {confirming ? (
          <Alert variant="info">
            <Loader2 className="animate-spin" />
            <AlertTitle>Confirming your payment…</AlertTitle>
            <AlertDescription>
              This usually takes a few seconds. You will not be charged twice — this page updates automatically.
            </AlertDescription>
            <AutoRefresh />
          </Alert>
        ) : (
          <Alert variant="info">
            <CreditCard />
            <AlertTitle>
              {returnState === "cancelled"
                ? "Payment not completed"
                : returnState === "unavailable"
                  ? "We could not open the payment page"
                  : placed
                    ? "Order placed — awaiting payment"
                    : "Awaiting payment"}
            </AlertTitle>
            <AlertDescription>
              Nothing has been charged. Your items are reserved{holdEnds ? ` until ${holdEnds}` : ""}; after that they
              are released and the order is cancelled automatically.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-start gap-3">
          <ActionButton size="sm" action={payForOrder.bind(null, order.id)}>
            {hasAttempt ? "Resume payment" : "Pay now"}
          </ActionButton>
          <ActionButton
            variant="outline"
            size="sm"
            confirmMessage="Cancel this order and release the items?"
            action={cancelOrder.bind(null, order.id)}
          >
            Cancel order
          </ActionButton>
        </div>
        <p className="text-xs text-ink-faint">Payments run in Stripe test mode: no real money is taken.</p>
      </div>
    );
  }

  const restorable =
    order.status === "cancelled" &&
    ["cancelled", "expired", "failed"].includes(order.payment_status) &&
    !wasRestored(order.metadata);
  if (restorable) {
    return (
      <div className="flex flex-col gap-3">
        {order.payment_status === "failed" ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Payment failed</AlertTitle>
            <AlertDescription>
              The payment did not go through, so the items were released. Nothing was charged.
            </AlertDescription>
          </Alert>
        ) : null}
        <div>
          <ActionButton variant="outline" size="sm" action={restoreCartFromOrder.bind(null, order.id)}>
            Restore these items to my bag
          </ActionButton>
        </div>
      </div>
    );
  }
  return null;
}
