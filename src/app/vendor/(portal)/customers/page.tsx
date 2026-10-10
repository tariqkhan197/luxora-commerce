import type { Metadata } from "next";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STORE_CURRENCY } from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { vendorCustomers } from "@/features/reports/queries";
import { requireVendorContext } from "@/lib/auth/dal";
import { formatDateTimeUtc } from "@/lib/format";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Customers" };

export default async function VendorCustomersPage({ searchParams }: PageProps<"/vendor/customers">) {
  const { vendor } = await requireVendorContext(ROUTES.vendor.customers);
  const params = await searchParams;
  const search = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const page = Math.max(1, Number.parseInt(typeof params.page === "string" ? params.page : "1", 10) || 1);
  const result = await vendorCustomers(vendor.id, { search, page });
  const hrefFor = (target: number) => {
    const query = new URLSearchParams();
    if (search) query.set("q", search);
    if (target > 1) query.set("page", String(target));
    const qs = query.toString();
    return qs ? `${ROUTES.vendor.customers}?${qs}` : ROUTES.vendor.customers;
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Vendor portal"
        title="Customers"
        description="Customers with a paid order from your store. Email addresses and phone numbers are not shared with vendors."
      />
      <form method="get" action={ROUTES.vendor.customers} className="flex max-w-md gap-2" role="search">
        <Input
          name="q"
          defaultValue={search}
          placeholder="Search by name"
          aria-label="Search customers"
          maxLength={100}
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      {result.rows.length === 0 ? (
        <EmptyState
          title={search ? "No matching customers" : "No customers yet"}
          description={
            search ? "Try a different name." : "Customers appear here after their first paid order from your store."
          }
        />
      ) : (
        <>
          <p className="text-sm text-ink-soft">
            {result.total} customer{result.total === 1 ? "" : "s"}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Ships to</TableHead>
                <TableHead className="text-right">Paid orders</TableHead>
                <TableHead className="text-right">Spent with you</TableHead>
                <TableHead>Last order</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="font-medium text-ink">{row.name ?? "—"}</TableCell>
                  <TableCell className="text-ink-soft">
                    {[row.city, row.countryCode].filter(Boolean).join(", ") || "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.paidOrders}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(row.spent, STORE_CURRENCY)}</TableCell>
                  <TableCell className="text-ink-soft">
                    {row.lastOrderAt ? formatDateTimeUtc(row.lastOrderAt) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination page={result.page} pageCount={result.pageCount} hrefFor={hrefFor} />
        </>
      )}
    </div>
  );
}
