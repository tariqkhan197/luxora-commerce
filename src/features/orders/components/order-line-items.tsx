import { StorageImage } from "@/components/shared/storage-image";
import { formatMoney } from "@/lib/money";
import { STORAGE_BUCKETS } from "@/lib/storage";

export interface OrderLine {
  id: string;
  product_name: string;
  variant_title: string;
  sku: string;
  image_path: string | null;
  quantity: number;
  unit_price_minor: number;
  total_minor: number;
  /** Regular price when the unit price was a flash-sale price (Phase 6B). */
  list_price_minor?: number | null;
  /** Discount-code share of the line. */
  discount_minor?: number;
  flash_sale_item_id?: string | null;
}

/** Line items rendered from the order snapshot (never from the live catalog). */
export function OrderLineItems({ items, currency }: { items: OrderLine[]; currency: string }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((item) => {
        return (
          <li key={item.id} className="flex gap-4 py-4">
            <StorageImage
              bucket={STORAGE_BUCKETS.productImages}
              path={item.image_path}
              alt=""
              className="aspect-[4/5] w-16 shrink-0 rounded-md"
              sizes="64px"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
              <span className="font-medium text-ink">{item.product_name}</span>
              <span className="text-ink-soft">{item.variant_title}</span>
              <span className="text-xs text-ink-faint">
                SKU {item.sku} · {item.quantity} × {formatMoney(item.unit_price_minor, currency)}
                {item.flash_sale_item_id && item.list_price_minor && item.list_price_minor > item.unit_price_minor ? (
                  <>
                    {" "}
                    <span className="line-through">{formatMoney(item.list_price_minor, currency)}</span> · Flash sale
                  </>
                ) : null}
                {item.discount_minor ? ` · Code −${formatMoney(item.discount_minor, currency)}` : null}
              </span>
            </div>
            <p className="text-sm tabular-nums">{formatMoney(item.total_minor, currency)}</p>
          </li>
        );
      })}
    </ul>
  );
}
