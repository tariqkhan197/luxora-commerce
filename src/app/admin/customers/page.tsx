import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { AccountStatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STORE_CURRENCY } from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { listAdminCustomers } from "@/features/operations/queries";
import { requireRole } from "@/lib/auth/dal";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { Enums } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Customers" };

const STATUSES: Enums<"account_status">[] = ["active", "suspended", "deactivated"];

export default async function AdminCustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  await requireRole(["admin", "super_admin"], ROUTES.admin.customers);
  const params = await searchParams;
  const search = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const status = STATUSES.includes(params.status as Enums<"account_status">)
    ? (params.status as Enums<"account_status">)
    : null;
  const page = Math.max(1, Number.parseInt(typeof params.page === "string" ? params.page : "1", 10) || 1);
  const result = await listAdminCustomers({ search, status, page });

  const hrefFor = (target: number, nextStatus: Enums<"account_status"> | null = status) => {
    const query = new URLSearchParams();
    if (search) query.set("q", search);
    if (nextStatus) query.set("status", nextStatus);
    if (target > 1) query.set("page", String(target));
    const qs = query.toString();
    return qs ? `${ROUTES.admin.customers}?${qs}` : ROUTES.admin.customers;
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="People"
        title="Customers"
        description="Customer accounts with their paid orders, spend (net of completed refunds) and return requests. Suspension is managed on each customer's page."
      />
      <div className="flex flex-wrap items-center gap-3">
        <form method="get" action={ROUTES.admin.customers} className="flex max-w-md flex-1 gap-2" role="search">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <Input
            name="q"
            defaultValue={search}
            placeholder="Search by name or email"
            aria-label="Search customers"
            maxLength={100}
          />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        <div className="flex flex-wrap gap-1">
          <Button asChild size="sm" variant={status ? "ghost" : "primary"}>
            <Link href={hrefFor(1, null)}>All</Link>
          </Button>
          {STATUSES.map((value) => (
            <Button key={value} asChild size="sm" variant={status === value ? "primary" : "ghost"}>
              <Link href={hrefFor(1, value)} className="capitalize">
                {value}
              </Link>
            </Button>
          ))}
        </div>
      </div>
      {result.rows.length === 0 ? (
        <EmptyState
          title={search || status ? "No matching customers" : "No customers yet"}
          description={
            search || status
              ? "Try a different search or status."
              : "Customer accounts appear here when people sign up."
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
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Paid orders</TableHead>
                <TableHead className="text-right">Spent</TableHead>
                <TableHead className="text-right">Returns</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((row) => (
                <TableRow key={row.profileId}>
                  <TableCell>
                    <Link href={ROUTES.admin.customer(row.profileId)} className="font-medium text-ink hover:underline">
                      {row.fullName || "Unnamed customer"}
                    </Link>
                    <p className="text-xs text-ink-faint">{row.email}</p>
                  </TableCell>
                  <TableCell>
                    <AccountStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.paidOrders}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(row.spent, STORE_CURRENCY)}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.returnRequests}</TableCell>
                  <TableCell className="text-ink-soft">{formatDate(row.joinedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination page={result.page} pageCount={result.pageCount} hrefFor={(p) => hrefFor(p)} />
        </>
      )}
    </div>
  );
}
