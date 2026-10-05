import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROUTES } from "@/config/routes";
import { AdjustStockDialog, InventorySettingsDialog } from "@/features/inventory/components/inventory-controls";
import { requireVendorContext } from "@/lib/auth/dal";
import { fromPostgrestError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Inventory" };

const dateTime = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

export default async function VendorInventoryPage({ searchParams }: PageProps<"/vendor/inventory">) {
  const { vendor } = await requireVendorContext(ROUTES.vendor.inventory);
  const params = await searchParams;
  const lowOnly = params.filter === "low";
  const historyVariant =
    typeof params.variant === "string" && uuidSchema.safeParse(params.variant).success ? params.variant : null;
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("inventory")
    .select(
      "id, variant_id, stock_quantity, reserved_quantity, available_quantity, low_stock_threshold, track_inventory, allow_backorder, updated_at, product_variants!inventory_variant_id_fkey(sku, title, is_active, products!product_variants_product_id_fkey(id, name, status))",
    )
    .eq("vendor_id", vendor.id)
    .order("updated_at", { ascending: false });
  if (error) throw fromPostgrestError(error);

  const isLow = (row: { track_inventory: boolean; available_quantity: number | null; low_stock_threshold: number }) =>
    row.track_inventory && (row.available_quantity ?? 0) <= row.low_stock_threshold;
  const items = (rows ?? []).filter((row) => !lowOnly || isLow(row));
  const lowCount = (rows ?? []).filter(isLow).length;
  const historyRow = rows?.find((row) => row.variant_id === historyVariant);

  const history = historyRow
    ? await supabase
        .from("inventory_movements")
        .select("id, type, quantity_delta, quantity_after, reason, reference_type, created_at")
        .eq("inventory_id", historyRow.id)
        .order("created_at", { ascending: false })
        .limit(50)
    : null;
  if (history?.error) throw fromPostgrestError(history.error);
  const movements = history?.data ?? [];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Catalog"
        title="Inventory"
        description="Stock is only ever changed through audited adjustments; every movement is recorded."
        actions={
          <div className="flex gap-1">
            <Button asChild size="sm" variant={lowOnly ? "ghost" : "primary"}>
              <Link href={ROUTES.vendor.inventory}>All variants</Link>
            </Button>
            <Button asChild size="sm" variant={lowOnly ? "primary" : "ghost"}>
              <Link href={`${ROUTES.vendor.inventory}?filter=low`}>Low stock ({lowCount})</Link>
            </Button>
          </div>
        }
      />

      {items.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Variant</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead className="text-right">Reserved</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((row) => {
              const variant = row.product_variants;
              const product = variant?.products;
              const available = row.available_quantity ?? 0;
              const low = isLow(row);
              const label = `${product?.name ?? "Product"} · ${variant?.title ?? "Variant"}`;
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    {product ? (
                      <Link href={ROUTES.vendor.product(product.id)} className="font-medium text-ink hover:underline">
                        {product.name}
                      </Link>
                    ) : null}
                    <p className="text-xs text-ink-faint">{variant?.title}</p>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{variant?.sku}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.stock_quantity}</TableCell>
                  <TableCell className="text-right text-ink-soft tabular-nums">{row.reserved_quantity}</TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${available <= 0 ? "text-danger" : low ? "text-warning" : ""}`}
                  >
                    {available}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {low ? <Badge variant="warning">Low</Badge> : null}
                      {!row.track_inventory ? <Badge variant="neutral">Untracked</Badge> : null}
                      {row.allow_backorder ? <Badge variant="outline">Backorder</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex flex-wrap items-center justify-end gap-1">
                      <AdjustStockDialog variantId={row.variant_id} label={label} stock={row.stock_quantity} />
                      <InventorySettingsDialog
                        variantId={row.variant_id}
                        label={label}
                        lowStockThreshold={row.low_stock_threshold}
                        trackInventory={row.track_inventory}
                        allowBackorder={row.allow_backorder}
                      />
                      <Button asChild size="sm" variant="ghost">
                        <Link
                          href={`${ROUTES.vendor.inventory}?variant=${row.variant_id}${lowOnly ? "&filter=low" : ""}`}
                        >
                          History
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <EmptyState
          title={lowOnly ? "No low-stock variants" : "No inventory yet"}
          description={
            lowOnly
              ? "Everything is above its threshold."
              : "Inventory records are created automatically when you add product variants."
          }
        />
      )}

      {historyRow ? (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="display-3">Movement history · {historyRow.product_variants?.sku}</h2>
            <Button asChild size="sm" variant="ghost">
              <Link href={lowOnly ? `${ROUTES.vendor.inventory}?filter=low` : ROUTES.vendor.inventory}>Close</Link>
            </Button>
          </div>
          {movements.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">After</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell className="whitespace-nowrap">
                      {dateTime.format(new Date(movement.created_at))}
                    </TableCell>
                    <TableCell className="capitalize">{movement.type.replace("_", " ")}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${movement.quantity_delta < 0 ? "text-danger" : "text-success"}`}
                    >
                      {movement.quantity_delta > 0 ? `+${movement.quantity_delta}` : movement.quantity_delta}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{movement.quantity_after}</TableCell>
                    <TableCell className="text-ink-soft">{movement.reason ?? movement.reference_type ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-ink-faint">No movements recorded for this variant.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
