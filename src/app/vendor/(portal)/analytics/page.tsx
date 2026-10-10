import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { STORE_CURRENCY } from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { BarChart } from "@/features/reports/components/bar-chart";
import { MetricTile } from "@/features/reports/components/metric-tile";
import { PeriodPicker } from "@/features/reports/components/period-picker";
import { RankingTable } from "@/features/reports/components/ranking-table";
import { formatRateBps, shortDay, spansYears } from "@/features/reports/format";
import { vendorLowStock, vendorSalesDaily, vendorSalesSummary, vendorTopProducts } from "@/features/reports/queries";
import { requireVendorContext } from "@/lib/auth/dal";
import { formatMoney } from "@/lib/money";
import { ratioBps, resolvePeriod } from "@/lib/reporting/periods";

export const metadata: Metadata = { title: "Analytics" };

const money = (minor: number) => formatMoney(minor, STORE_CURRENCY);

/** Average of 1–5 star ratings to one decimal, from integer sums. */
function averageRating(sum: number, count: number): string {
  if (count <= 0) return "—";
  return (Math.round((sum * 10) / count) / 10).toFixed(1);
}

export default async function VendorAnalyticsPage({ searchParams }: PageProps<"/vendor/analytics">) {
  const { vendor } = await requireVendorContext(ROUTES.vendor.analytics);
  const { period, error } = resolvePeriod(await searchParams);
  const [current, previous, daily, products, lowStock] = await Promise.all([
    vendorSalesSummary(vendor.id, period),
    vendorSalesSummary(vendor.id, period.previous),
    vendorSalesDaily(vendor.id, period),
    vendorTopProducts(vendor.id, period),
    vendorLowStock(vendor.id),
  ]);
  const days = period.days;
  const returnRate = ratioBps(current.returnedUnits, current.units);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Vendor portal"
        title="Analytics"
        description="Your store's paid orders, earnings, returns and stock. All dates are UTC."
      />
      <PeriodPicker basePath={ROUTES.vendor.analytics} period={period} error={error} />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Sales">
        <MetricTile
          label="Sales"
          value={money(current.sales)}
          current={current.sales}
          previous={previous.sales}
          days={days}
          hint="Your items after your own discounts, incl. shipping"
        />
        <MetricTile
          label="Paid orders"
          value={String(current.paidOrders)}
          current={current.paidOrders}
          previous={previous.paidOrders}
          days={days}
        />
        <MetricTile
          label="Units sold"
          value={String(current.units)}
          current={current.units}
          previous={previous.units}
          days={days}
        />
        <MetricTile
          label="Commission"
          value={money(current.commission)}
          current={current.commission}
          previous={previous.commission}
          days={days}
          hint="Snapshotted on each order"
        />
        <MetricTile
          label="Earnings"
          value={money(current.earnings)}
          current={current.earnings}
          previous={previous.earnings}
          days={days}
          hint="Ledger: order earnings, fees and refund debits"
        />
        <MetricTile
          label="Refunds"
          value={money(current.refunds)}
          current={current.refunds}
          previous={previous.refunds}
          days={days}
          hint="Completed in the period"
        />
        <MetricTile
          label="Returns"
          value={String(current.returnRequests)}
          current={current.returnRequests}
          previous={previous.returnRequests}
          days={days}
          hint={`${current.returnedUnits} units · return rate ${formatRateBps(returnRate)}`}
        />
        <MetricTile
          label="Average rating"
          value={averageRating(current.ratingSum, current.reviewCount)}
          hint={`${current.reviewCount} approved review${current.reviewCount === 1 ? "" : "s"}, all time`}
        />
      </section>

      <BarChart
        title="Sales by day (UTC)"
        description={`daily sales from ${period.from} to ${period.to}`}
        points={daily.map((d) => ({ label: shortDay(d.day, spansYears(period)), value: d.sales }))}
        format={money}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <RankingTable
          title="Top products"
          empty="No paid orders in this period."
          headers={["Product", "Units", "Sales"]}
          rows={products.map((p) => [p.name, String(p.units), money(p.sales)])}
        />
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-ink">Low stock now ({lowStock.count})</h2>
            {lowStock.count ? (
              <Button asChild size="sm" variant="ghost">
                <Link href={`${ROUTES.vendor.inventory}?filter=low`}>Manage inventory</Link>
              </Button>
            ) : null}
          </div>
          {lowStock.rows.length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-faint">
                <tr>
                  <th className="py-1 font-normal">Variant</th>
                  <th className="py-1 text-right font-normal">Available</th>
                  <th className="py-1 text-right font-normal">Threshold</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lowStock.rows.map((row) => (
                  <tr key={row.variantId}>
                    <td className="py-1.5 text-ink">
                      {row.productName}
                      {row.variantTitle ? <span className="text-ink-soft"> · {row.variantTitle}</span> : null}
                      {row.sku ? <span className="block text-xs text-ink-faint">{row.sku}</span> : null}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{row.available}</td>
                    <td className="py-1.5 text-right tabular-nums">{row.threshold}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-ink-soft">No tracked variant is at or below its low-stock threshold.</p>
          )}
        </section>
      </div>
    </div>
  );
}
