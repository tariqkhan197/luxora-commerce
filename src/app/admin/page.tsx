import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/config/routes";
import { requireRole } from "@/lib/auth/dal";
import { fromPostgrestError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin overview" };

async function count(query: PromiseLike<{ count: number | null; error: { code?: string; message: string } | null }>) {
  const { count: value, error } = await query;
  if (error) throw fromPostgrestError(error);
  return value ?? 0;
}

export default async function AdminOverviewPage() {
  await requireRole(["admin", "super_admin"], ROUTES.admin.root);
  const supabase = await createClient();

  // Live counts from the database. There are no synthetic metrics here: with an
  // empty marketplace every figure is zero.
  const [pendingApplications, pendingVendors, approvedVendors, pendingProducts, customers] = await Promise.all([
    count(
      supabase
        .from("vendor_applications")
        .select("id", { count: "exact", head: true })
        .in("status", ["submitted", "under_review"]),
    ),
    count(supabase.from("vendors").select("id", { count: "exact", head: true }).eq("status", "pending")),
    count(supabase.from("vendors").select("id", { count: "exact", head: true }).eq("status", "approved")),
    count(supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "pending_review")),
    count(supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "customer")),
  ]);

  const tiles = [
    { label: "Applications awaiting review", value: pendingApplications, href: ROUTES.admin.vendors },
    { label: "Vendors pending approval", value: pendingVendors, href: ROUTES.admin.vendors },
    { label: "Approved vendors", value: approvedVendors, href: ROUTES.admin.vendors },
    { label: "Products awaiting moderation", value: pendingProducts, href: ROUTES.admin.products },
    { label: "Customer accounts", value: customers, href: ROUTES.admin.customers },
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Command center" title="Overview" description="Operational queues across the marketplace." />
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => (
          <li key={tile.label}>
            <Card className="h-full">
              <CardHeader className="pb-2">
                <CardDescription>{tile.label}</CardDescription>
                <CardTitle className="font-display text-4xl">{tile.value}</CardTitle>
              </CardHeader>
              <CardContent>
                <Button asChild variant="link" className="h-auto p-0 text-sm">
                  <Link href={tile.href}>Open queue →</Link>
                </Button>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-soft">
        Revenue, commission and payout figures appear once orders exist; they are computed from order and ledger
        records, never estimated.
      </p>
    </div>
  );
}
