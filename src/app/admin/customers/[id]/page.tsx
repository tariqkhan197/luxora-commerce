import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import {
  AccountStatusBadge,
  OrderStatusBadge,
  PaymentStatusBadge,
  ReturnStatusBadge,
  ReviewStatusBadge,
} from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STORE_CURRENCY } from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { AccountStatusDialog } from "@/features/operations/components/account-status-dialog";
import { getAdminCustomer } from "@/features/operations/queries";
import { redactedJson } from "@/features/operations/state";
import { requireRole } from "@/lib/auth/dal";
import { formatDate, formatDateTimeUtc } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { uuidSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Customer" };

const AUDIT_LABELS: Record<string, string> = {
  "account.suspended": "Account suspended",
  "account.reactivated": "Account reactivated",
  "account.status_changed": "Status changed directly",
};

export default async function AdminCustomerPage({ params }: PageProps<"/admin/customers/[id]">) {
  const { id } = await params;
  await requireRole(["admin", "super_admin"], ROUTES.admin.customer(id));
  if (!uuidSchema.safeParse(id).success) notFound();
  const detail = await getAdminCustomer(id);
  if (!detail) notFound();
  const { customer, orders, returns, refunds, reviews, audit } = detail;
  const label = customer.fullName || customer.email || "This customer";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Customer"
        title={customer.fullName || "Unnamed customer"}
        description={`${customer.email ?? "No email"} · joined ${formatDate(customer.joinedAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AccountStatusBadge status={customer.status} />
            {customer.status === "active" ? (
              <AccountStatusDialog profileId={customer.profileId} status="suspended" customerLabel={label} />
            ) : customer.status === "suspended" ? (
              <AccountStatusDialog profileId={customer.profileId} status="active" customerLabel={label} />
            ) : null}
          </div>
        }
      />
      <Button asChild size="sm" variant="ghost" className="self-start">
        <Link href={ROUTES.admin.customers}>← All customers</Link>
      </Button>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Totals">
        <Stat label="Paid orders" value={String(customer.paidOrders)} />
        <Stat label="Spent (net of refunds)" value={formatMoney(customer.spent, STORE_CURRENCY)} />
        <Stat label="Return requests" value={String(customer.returnRequests)} />
      </section>

      <Panel title="Recent orders" empty="No orders." count={orders.length}>
        <ul className="divide-y divide-line text-sm">
          {orders.map((order) => (
            <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link href={ROUTES.admin.order(order.id)} className="font-medium text-ink hover:underline">
                {order.order_number}
              </Link>
              <span className="flex flex-wrap gap-1">
                <OrderStatusBadge status={order.status} />
                <PaymentStatusBadge status={order.payment_status} />
              </span>
              <span className="text-ink-soft">{formatDateTimeUtc(order.placed_at)}</span>
              <span className="tabular-nums">{formatMoney(order.total_minor, order.currency)}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Returns" empty="No return requests." count={returns.length}>
          <ul className="divide-y divide-line text-sm">
            {returns.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-ink">
                  {r.rma_number}
                  {r.orderNumber ? <span className="text-ink-soft"> · {r.orderNumber}</span> : null}
                </span>
                <ReturnStatusBadge status={r.status} />
                <span className="text-ink-soft">{formatDateTimeUtc(r.requested_at)}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Refunds" empty="No refunds." count={refunds.length}>
          <ul className="divide-y divide-line text-sm">
            {refunds.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-ink">{r.orderNumber ?? "Order"}</span>
                <Badge variant={r.status === "completed" ? "success" : r.status === "failed" ? "danger" : "neutral"}>
                  {r.status.replace(/_/g, " ")}
                </Badge>
                <span className="text-ink-soft">{formatDateTimeUtc(r.processed_at ?? r.created_at)}</span>
                <span className="tabular-nums">{formatMoney(r.amount_minor, r.currency)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Reviews" empty="No reviews." count={reviews.length}>
        <ul className="divide-y divide-line text-sm">
          {reviews.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-ink">
                {r.productName}
                {r.title ? <span className="text-ink-soft"> · {r.title}</span> : null}
              </span>
              <span className="tabular-nums">{r.rating}/5</span>
              <ReviewStatusBadge status={r.status} />
              <span className="text-ink-soft">{formatDateTimeUtc(r.created_at)}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Account history" empty="No account changes recorded." count={audit.length}>
        <ul className="divide-y divide-line text-sm">
          {audit.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-1 py-2">
              <span className="flex flex-wrap justify-between gap-2">
                <span className="text-ink">{AUDIT_LABELS[entry.action] ?? entry.action}</span>
                <span className="text-ink-soft">
                  {formatDateTimeUtc(entry.created_at)}
                  {entry.actor_role ? ` · ${entry.actor_role.replace(/_/g, " ")}` : ""}
                </span>
              </span>
              <pre className="overflow-x-auto rounded bg-surface-muted p-2 text-xs break-words whitespace-pre-wrap text-ink-soft">
                {redactedJson(entry.metadata)}
              </pre>
            </li>
          ))}
        </ul>
        <Link
          href={`${ROUTES.admin.auditLogs}?entity=profile&entityId=${customer.profileId}`}
          className="text-xs text-ink-soft hover:underline"
        >
          Open in the audit log
        </Link>
      </Panel>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="font-display text-2xl text-ink tabular-nums">{value}</p>
    </div>
  );
}

function Panel({
  title,
  empty,
  count,
  children,
}: {
  title: string;
  empty: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-sm font-medium text-ink">{title}</h2>
      {count ? children : <p className="text-sm text-ink-soft">{empty}</p>}
    </section>
  );
}
