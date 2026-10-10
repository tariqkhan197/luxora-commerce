import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { STORE_CURRENCY } from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { BarChart } from "@/features/reports/components/bar-chart";
import { MetricTile } from "@/features/reports/components/metric-tile";
import { PeriodPicker } from "@/features/reports/components/period-picker";
import { RankingTable } from "@/features/reports/components/ranking-table";
import { formatRateBps, PLATFORM_LEDGER_LABELS, shortDay, spansYears } from "@/features/reports/format";
import {
  adminDiscountUsage,
  adminRevenueBreakdown,
  adminSalesDaily,
  adminSalesSummary,
  adminTopProducts,
  adminTopVendors,
} from "@/features/reports/queries";
import { requireRole } from "@/lib/auth/dal";
import { formatMoney } from "@/lib/money";
import { ratioBps, resolvePeriod } from "@/lib/reporting/periods";

export const metadata: Metadata = { title: "Analytics" };

const money = (minor: number) => formatMoney(minor, STORE_CURRENCY);

export default async function AdminAnalyticsPage({ searchParams }: PageProps<"/admin/analytics">) {
  await requireRole(["admin", "super_admin"], ROUTES.admin.analytics);
  const { period, error } = resolvePeriod(await searchParams);
  const [current, previous, daily, breakdown, vendors, products, discounts] = await Promise.all([
    adminSalesSummary(period),
    adminSalesSummary(period.previous),
    adminSalesDaily(period),
    adminRevenueBreakdown(period),
    adminTopVendors(period),
    adminTopProducts(period),
    adminDiscountUsage(period),
  ]);
  const days = period.days;
  const returnRate = ratioBps(current.returnedUnits, current.units);
  const previousReturnRate = ratioBps(previous.returnedUnits, previous.units);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Insights"
        title="Analytics"
        description="Computed from paid orders, completed refunds, return requests and Luxora's ledger. All dates are UTC."
      />
      <PeriodPicker basePath={ROUTES.admin.analytics} period={period} error={error} />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Sales">
        <MetricTile
          label="Gross sales"
          value={money(current.grossSales)}
          current={current.grossSales}
          previous={previous.grossSales}
          days={days}
          hint="Paid orders, after discounts, incl. shipping"
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
          label="Net sales"
          value={money(current.netSales)}
          current={current.netSales}
          previous={previous.netSales}
          days={days}
        />
        <MetricTile
          label="Luxora net revenue"
          value={money(current.luxoraNetRevenue)}
          current={current.luxoraNetRevenue}
          previous={previous.luxoraNetRevenue}
          days={days}
          hint="Platform ledger total"
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
          label="Average order value"
          value={money(current.averageOrderValue)}
          current={current.averageOrderValue}
          previous={previous.averageOrderValue}
          days={days}
          hint="Gross sales ÷ paid orders"
        />
        <MetricTile
          label="New customers"
          value={String(current.newCustomers)}
          current={current.newCustomers}
          previous={previous.newCustomers}
          days={days}
          hint="First paid order in the period"
        />
        <MetricTile
          label="Return rate"
          value={formatRateBps(returnRate)}
          hint={`${current.returnedUnits} units in returns opened ÷ ${current.units} sold · previous ${formatRateBps(previousReturnRate)}`}
        />
      </section>

      <BarChart
        title="Gross sales by day (UTC)"
        description={`daily gross sales from ${period.from} to ${period.to}`}
        points={daily.map((d) => ({ label: shortDay(d.day, spansYears(period)), value: d.grossSales }))}
        format={money}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">Luxora net revenue by ledger entry</h2>
          {breakdown.length ? (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {breakdown.map((row) => (
                  <tr key={row.entryType}>
                    <td className="py-1.5 text-ink-soft">{PLATFORM_LEDGER_LABELS[row.entryType] ?? row.entryType}</td>
                    <td className="py-1.5 text-right tabular-nums">{money(row.amount)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="py-1.5 font-medium text-ink">Total</td>
                  <td className="py-1.5 text-right font-medium tabular-nums">{money(current.luxoraNetRevenue)}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-ink-soft">No ledger entries in this period.</p>
          )}
        </section>
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">Discounts on paid orders</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              <tr>
                <td className="py-1.5 text-ink-soft">Orders with a code</td>
                <td className="py-1.5 text-right tabular-nums">{discounts.ordersWithCode}</td>
              </tr>
              <tr>
                <td className="py-1.5 text-ink-soft">Luxora-funded codes and free shipping</td>
                <td className="py-1.5 text-right tabular-nums">{money(discounts.luxoraFunded)}</td>
              </tr>
              <tr>
                <td className="py-1.5 text-ink-soft">Vendor-funded codes</td>
                <td className="py-1.5 text-right tabular-nums">{money(discounts.vendorCodes)}</td>
              </tr>
              <tr>
                <td className="py-1.5 text-ink-soft">Flash-sale savings (vendor-funded)</td>
                <td className="py-1.5 text-right tabular-nums">{money(discounts.flashSaleSavings)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <RankingTable
          title="Top vendors"
          empty="No paid orders in this period."
          headers={["Vendor", "Orders", "Sales", "Commission"]}
          rows={vendors.map((v) => [v.name, String(v.paidOrders), money(v.sales), money(v.commission)])}
        />
        <RankingTable
          title="Top products"
          empty="No paid orders in this period."
          headers={["Product", "Units", "Sales"]}
          rows={products.map((p) => [`${p.name} · ${p.vendorName}`, String(p.units), money(p.sales)])}
        />
      </div>
    </div>
  );
}
