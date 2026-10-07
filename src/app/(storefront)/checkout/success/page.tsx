import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { reconcileCheckoutSession } from "@/features/payments/checkout";
import { requireUser } from "@/lib/auth/dal";
import { paymentsOn } from "@/lib/payments/status";

export const metadata: Metadata = { title: "Payment" };

const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{10,255}$/;

/**
 * Return address after hosted checkout. The session id in the URL is only a
 * lookup key: the session is re-read from Stripe on the server and applied
 * through the same idempotent path as the webhook (it may simply be a no-op
 * when the webhook was first). The customer then sees their order.
 */
export default async function CheckoutSuccessPage({ searchParams }: PageProps<"/checkout/success">) {
  await requireUser(ROUTES.checkout);
  const { session_id: sessionId } = await searchParams;

  let orderId: string | null = null;
  if (typeof sessionId === "string" && SESSION_ID.test(sessionId) && paymentsOn()) {
    try {
      orderId = (await reconcileCheckoutSession(sessionId))?.orderId ?? null;
    } catch (error) {
      // The webhook remains the source of truth; the order page keeps refreshing.
      console.error("[payments] success-page reconciliation failed:", error instanceof Error ? error.message : error);
    }
  }
  if (orderId) redirect(`${ROUTES.account.order(orderId)}?payment=success`);

  return (
    <div className="container-editorial py-16">
      <EmptyState
        title="We could not find this payment"
        description="If you completed a payment, it will appear on your order within a few moments."
        action={
          <Button asChild>
            <Link href={ROUTES.account.orders}>Go to your orders</Link>
          </Button>
        }
      />
    </div>
  );
}
