import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { ProductStatusBadge, StoreStatusBadge, VendorStatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROUTES } from "@/config/routes";
import { VendorStatusControls } from "@/features/admin/components/vendor-status-controls";
import { requireRole } from "@/lib/auth/dal";
import { fromPostgrestError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Vendor details" };

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

export default async function AdminVendorDetailPage({ params }: PageProps<"/admin/vendors/[id]">) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  await requireRole(["admin", "super_admin"], ROUTES.admin.vendor(id));
  const supabase = await createClient();

  const [
    { data: vendor, error },
    { data: store },
    { data: members, error: membersError },
    { data: products, error: productsError },
    { data: audits },
  ] = await Promise.all([
    supabase.from("vendors").select("*").eq("id", id).maybeSingle(),
    supabase.from("stores").select("slug, name, status, published_at").eq("vendor_id", id).maybeSingle(),
    supabase
      .from("vendor_users")
      .select("id, role, created_at, profiles!vendor_users_profile_id_fkey(full_name, user_id)")
      .eq("vendor_id", id)
      .order("created_at"),
    supabase
      .from("products")
      .select("id, name, slug, status, updated_at")
      .eq("vendor_id", id)
      .order("updated_at", { ascending: false })
      .limit(25),
    supabase
      .from("audit_logs")
      .select("id, action, created_at, metadata")
      .eq("entity_type", "vendor")
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  if (error) throw fromPostgrestError(error);
  if (!vendor) notFound();
  if (membersError) throw fromPostgrestError(membersError);
  if (productsError) throw fromPostgrestError(productsError);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Vendor"
        title={vendor.display_name}
        description={`${vendor.legal_name} · ${vendor.contact_email}${vendor.contact_phone ? ` · ${vendor.contact_phone}` : ""}`}
        actions={<VendorStatusBadge status={vendor.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>
              {vendor.status === "suspended" && vendor.suspension_reason
                ? `Suspended: ${vendor.suspension_reason}`
                : `Joined ${dateFormat.format(new Date(vendor.created_at))}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VendorStatusControls vendorId={vendor.id} status={vendor.status} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Store</CardTitle>
            <CardDescription>{store ? store.name : "No store created yet."}</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            {store ? <StoreStatusBadge status={store.status} /> : null}
            {store?.status === "published" ? (
              <Button asChild size="sm" variant="outline">
                <Link href={ROUTES.store(store.slug)}>View store</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Commission</CardTitle>
            <CardDescription>
              {vendor.commission_rate_bps === null
                ? "Follows category and platform rules."
                : `Vendor override: ${(vendor.commission_rate_bps / 100).toFixed(2)}%`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="sm" variant="outline">
              <Link href={ROUTES.admin.commissions}>Commission rules</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Team</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-line text-sm">
              {(members ?? []).map((member) => (
                <li key={member.id} className="flex items-center justify-between py-2">
                  <span>{member.profiles?.full_name ?? "Unnamed member"}</span>
                  <span className="text-xs text-ink-soft capitalize">{member.role}</span>
                </li>
              ))}
              {!members?.length ? <li className="py-2 text-ink-faint">No members.</li> : null}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-line text-sm">
              {(audits ?? []).map((audit) => (
                <li key={audit.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="font-mono text-xs">{audit.action}</span>
                  <span className="text-xs text-ink-faint">{dateFormat.format(new Date(audit.created_at))}</span>
                </li>
              ))}
              {!audits?.length ? <li className="py-2 text-ink-faint">No audited actions yet.</li> : null}
            </ul>
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="display-3">Products ({products?.length ?? 0})</h2>
        {products && products.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    {product.status === "active" ? (
                      <Link href={ROUTES.product(product.slug)} className="font-medium text-ink hover:underline">
                        {product.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-ink">{product.name}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <ProductStatusBadge status={product.status} />
                  </TableCell>
                  <TableCell>{dateFormat.format(new Date(product.updated_at))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-ink-faint">This vendor has not created any products.</p>
        )}
      </section>
    </div>
  );
}
