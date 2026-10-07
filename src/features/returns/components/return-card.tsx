import Link from "next/link";
import { ActionButton } from "@/components/shared/action-button";
import { ReturnStatusBadge } from "@/components/shared/status-badge";
import { ROUTES } from "@/config/routes";
import { formatDateTimeUtc } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { cancelReturn } from "../actions";
import type { ReturnRequestRow } from "../queries";
import { ReturnStepDialog } from "./return-step-dialog";

interface ReturnCardProps {
  ret: ReturnRequestRow;
  /** Who is looking: decides which actions are offered (the database re-checks every one). */
  viewer: "customer" | "vendor" | "admin";
  /** Vendor owner/manager (or admin) may decide on and receive the return. */
  canManage?: boolean;
  /** Payments enabled: admins can refund received returns. */
  canRefund?: boolean;
}

function when(value: string | null) {
  return value ? formatDateTimeUtc(new Date(value)) : null;
}

export function ReturnCard({ ret, viewer, canManage = false, canRefund = false }: ReturnCardProps) {
  const currency = ret.orders?.currency ?? "USD";
  const manage = canManage && viewer !== "customer";
  const timeline = [
    ["Requested", when(ret.requested_at)],
    ["Approved", when(ret.approved_at)],
    ["Sent back", when(ret.shipped_at)],
    ["Received", when(ret.received_at)],
    ["Refund issued", when(ret.completed_at)],
    ["Declined", when(ret.rejected_at)],
    ["Cancelled", when(ret.cancelled_at)],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return (
    <article className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Return {ret.rma_number}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {viewer === "customer" ? (
              <>
                {ret.vendors?.display_name ?? "Vendor"} ·{" "}
                <Link href={ROUTES.account.order(ret.order_id)} className="underline-offset-4 hover:underline">
                  Order {ret.orders?.order_number}
                </Link>
              </>
            ) : viewer === "vendor" ? (
              <Link href={ROUTES.vendor.order(ret.vendor_order_id)} className="underline-offset-4 hover:underline">
                Shipment {ret.vendor_orders?.vendor_order_number}
              </Link>
            ) : (
              <>
                {ret.vendors?.display_name ?? "Vendor"} ·{" "}
                <Link href={ROUTES.admin.order(ret.order_id)} className="underline-offset-4 hover:underline">
                  Order {ret.orders?.order_number}
                </Link>{" "}
                · {ret.orders?.customer_email}
              </>
            )}
          </p>
        </div>
        <ReturnStatusBadge status={ret.status} />
      </header>

      <ul className="grid gap-2 text-sm">
        {ret.return_request_items.map((item) => (
          <li key={item.id} className="flex flex-wrap justify-between gap-3">
            <span className="min-w-0">
              <span className="text-ink">
                {item.quantity} × {item.order_items?.product_name ?? "Item"}
              </span>
              <span className="text-xs text-ink-faint"> · {item.order_items?.variant_title}</span>
              <span className="block text-xs text-ink-soft">“{item.reason}”</span>
            </span>
            {item.order_items ? (
              <span className="text-ink-soft tabular-nums">
                {formatMoney(item.order_items.unit_price_minor * item.quantity, currency)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {ret.customer_note ? <p className="text-sm text-ink-soft">Note: {ret.customer_note}</p> : null}
      {ret.return_instructions && ["approved", "in_transit"].includes(ret.status) ? (
        <div className="rounded-md bg-surface-muted p-3 text-sm">
          <p className="mb-1 font-medium text-ink">Where to send it</p>
          <p className="whitespace-pre-line text-ink-soft">{ret.return_instructions}</p>
        </div>
      ) : null}
      {ret.tracking_number ? (
        <p className="text-sm text-ink-soft">
          Return tracking: {ret.carrier} ·{" "}
          {ret.tracking_url ? (
            <a
              href={ret.tracking_url}
              target="_blank"
              rel="noreferrer"
              className="text-ink underline-offset-4 hover:underline"
            >
              {ret.tracking_number}
            </a>
          ) : (
            ret.tracking_number
          )}
        </p>
      ) : null}
      {ret.rejection_reason && ret.status === "rejected" ? (
        <p className="text-sm text-danger">Reason: {ret.rejection_reason}</p>
      ) : null}
      {ret.inspection_notes && viewer !== "customer" ? (
        <p className="text-sm text-ink-soft">
          Inspection: {ret.inspection_notes}
          {ret.restocked ? " · restocked" : ""}
        </p>
      ) : null}
      {ret.status === "completed" && viewer === "customer" ? (
        <p className="text-sm text-ink-soft">The refund has been issued to your original payment method.</p>
      ) : null}

      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-faint">
        {timeline.map(([label, value]) => (
          <div key={label}>
            <dt className="inline">{label}: </dt>
            <dd className="inline">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-start gap-2">
        {viewer === "customer" && ["approved", "in_transit"].includes(ret.status) ? (
          <ReturnStepDialog returnId={ret.id} step="ship" />
        ) : null}
        {viewer === "customer" && ["requested", "approved"].includes(ret.status) ? (
          <ActionButton
            size="sm"
            variant="ghost"
            confirmMessage="Cancel this return request?"
            action={cancelReturn.bind(null, ret.id)}
          >
            Cancel return
          </ActionButton>
        ) : null}
        {manage && ret.status === "requested" ? (
          <>
            <ReturnStepDialog returnId={ret.id} step="approve" />
            <ReturnStepDialog returnId={ret.id} step="reject" />
          </>
        ) : null}
        {manage && ["approved", "in_transit"].includes(ret.status) ? (
          <ReturnStepDialog returnId={ret.id} step="receive" />
        ) : null}
        {viewer === "admin" && ret.status === "received" ? (
          <>
            {canRefund ? <ReturnStepDialog returnId={ret.id} step="refund" /> : null}
            <ReturnStepDialog returnId={ret.id} step="reject" />
          </>
        ) : null}
        {viewer === "vendor" && ret.status === "received" ? (
          <p className="text-xs text-ink-faint">Waiting for Luxora to issue the refund.</p>
        ) : null}
      </div>
    </article>
  );
}
