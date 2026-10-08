import { ActionButton } from "@/components/shared/action-button";
import { Badge } from "@/components/ui/badge";
import { STORE_CURRENCY } from "@/config/legal";
import { formatDateTimeUtc } from "@/lib/format";
import { formatMoney, toDecimalInput } from "@/lib/money";
import { isoToDateTimeInput } from "@/lib/validation";
import { endFlashSale } from "../actions";
import type { FlashSaleRow } from "../queries";
import { FLASH_SALE_STATE_LABELS, flashSaleState } from "../state";
import { AdminDisableDialog } from "./admin-disable-dialog";
import { FlashSaleFormDialog, type VariantChoice } from "./flash-sale-form-dialog";

const STATE_VARIANT = {
  live: "success",
  scheduled: "accent",
  ended: "neutral",
  cancelled: "neutral",
  disabled: "danger",
} as const;

interface FlashSaleListProps {
  sales: FlashSaleRow[];
  viewer: "vendor" | "admin";
  /** Vendor owner/manager. */
  canManage?: boolean;
  variants?: VariantChoice[];
}

/** Flash sales with their items and units sold. Every action is re-checked by the database. */
export function FlashSaleList({ sales, viewer, canManage = false, variants = [] }: FlashSaleListProps) {
  return (
    <ul className="grid gap-4">
      {sales.map((sale) => {
        const state = flashSaleState(sale);
        const open = state === "live" || state === "scheduled";
        return (
          <li key={sale.id} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium text-ink">{sale.name}</p>
                <p className="text-xs text-ink-faint">
                  {viewer === "admin" ? `${sale.vendors?.display_name ?? "Vendor"} (funded by the vendor) · ` : ""}
                  {formatDateTimeUtc(new Date(sale.starts_at))} → {formatDateTimeUtc(new Date(sale.ends_at))}
                </p>
              </div>
              <Badge variant={STATE_VARIANT[state]}>{FLASH_SALE_STATE_LABELS[state]}</Badge>
            </div>
            {sale.flash_sale_items.length ? (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-ink-faint">
                  <tr>
                    <th className="py-1 font-normal">Item</th>
                    <th className="py-1 text-right font-normal">Regular</th>
                    <th className="py-1 text-right font-normal">Sale</th>
                    <th className="py-1 text-right font-normal">Reserved/sold</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {sale.flash_sale_items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-1.5 text-ink">
                        {item.product_variants?.products?.name ?? "Item"}
                        <span className="text-xs text-ink-faint">
                          {" "}
                          · {item.product_variants?.title} ({item.product_variants?.sku})
                        </span>
                      </td>
                      <td className="py-1.5 text-right text-ink-soft tabular-nums">
                        {item.product_variants ? formatMoney(item.product_variants.price_minor, STORE_CURRENCY) : "—"}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatMoney(item.sale_price_minor, STORE_CURRENCY)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {item.sold_count}
                        {item.quantity_limit ? ` / ${item.quantity_limit}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-ink-soft">No items yet.</p>
            )}
            {sale.disabled_by_admin_at ? (
              <p className="text-sm text-danger">Disabled by Luxora: {sale.disabled_reason}</p>
            ) : null}
            {(viewer === "vendor" && canManage && open) || (viewer === "admin" && open) ? (
              <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                {viewer === "vendor" ? (
                  <>
                    <FlashSaleFormDialog
                      currency={STORE_CURRENCY}
                      variants={variants}
                      started={state === "live" && sale.flash_sale_items.length > 0}
                      datesLocked={state === "live"}
                      initial={{
                        saleId: sale.id,
                        name: sale.name,
                        description: sale.description ?? "",
                        startsAt: isoToDateTimeInput(sale.starts_at),
                        endsAt: isoToDateTimeInput(sale.ends_at),
                        items: sale.flash_sale_items.map((item) => ({
                          variantId: item.variant_id,
                          salePrice: toDecimalInput(item.sale_price_minor, STORE_CURRENCY),
                          quantityLimit: item.quantity_limit ? String(item.quantity_limit) : "",
                        })),
                      }}
                    />
                    <ActionButton
                      size="sm"
                      variant="ghost"
                      confirmMessage={
                        state === "live"
                          ? "End this sale now? Prices return to normal."
                          : "Cancel this sale before it starts?"
                      }
                      action={endFlashSale.bind(null, sale.id)}
                    >
                      {state === "live" ? "End now" : "Cancel sale"}
                    </ActionButton>
                  </>
                ) : (
                  <AdminDisableDialog id={sale.id} kind="flash_sale" />
                )}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
