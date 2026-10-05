import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ApplicationStatusBadge, VendorStatusBadge } from "@/components/shared/status-badge";
import { ActionButton } from "@/components/shared/action-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROUTES } from "@/config/routes";
import { markApplicationUnderReview } from "@/features/admin/actions";
import { ApproveApplicationDialog, RejectApplicationDialog } from "@/features/admin/components/application-review";
import { requireRole } from "@/lib/auth/dal";
import { fromPostgrestError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Vendors" };

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

export default async function AdminVendorsPage({ searchParams }: PageProps<"/admin/vendors">) {
  await requireRole(["admin", "super_admin"], ROUTES.admin.vendors);
  const params = await searchParams;
  const statusFilter = typeof params.status === "string" ? params.status : "all";
  const supabase = await createClient();

  const applicationsQuery = supabase
    .from("vendor_applications")
    .select(
      "id, business_name, business_email, website_url, description, product_categories, status, created_at, profiles!vendor_applications_profile_id_fkey(full_name)",
    )
    .in("status", ["submitted", "under_review"])
    .order("created_at", { ascending: true });

  let vendorsQuery = supabase
    .from("vendors")
    .select("id, slug, display_name, contact_email, status, commission_rate_bps, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (["pending", "approved", "suspended", "rejected", "closed"].includes(statusFilter)) {
    vendorsQuery = vendorsQuery.eq("status", statusFilter as "pending");
  }

  const [{ data: applications, error: appError }, { data: vendors, error: vendorError }] = await Promise.all([
    applicationsQuery,
    vendorsQuery,
  ]);
  if (appError) throw fromPostgrestError(appError);
  if (vendorError) throw fromPostgrestError(vendorError);

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        eyebrow="Vendors"
        title="Vendor management"
        description="Review applications, then manage approved vendors."
      />

      <section className="flex flex-col gap-4">
        <h2 className="display-3">Applications awaiting review ({applications?.length ?? 0})</h2>
        {applications && applications.length > 0 ? (
          <ul className="grid gap-4 lg:grid-cols-2">
            {applications.map((application) => (
              <li key={application.id}>
                <Card className="h-full">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle>{application.business_name}</CardTitle>
                        <CardDescription>
                          {application.profiles?.full_name ?? "Unknown applicant"} · {application.business_email}
                        </CardDescription>
                      </div>
                      <ApplicationStatusBadge status={application.status} />
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <p className="line-clamp-4 text-sm leading-relaxed text-ink-soft">{application.description}</p>
                    <dl className="grid grid-cols-2 gap-2 text-xs text-ink-soft">
                      <dt>Submitted</dt>
                      <dd className="text-ink">{dateFormat.format(new Date(application.created_at))}</dd>
                      {application.website_url ? (
                        <>
                          <dt>Website</dt>
                          <dd>
                            <a
                              href={application.website_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-ink underline-offset-4 hover:underline"
                            >
                              {application.website_url}
                            </a>
                          </dd>
                        </>
                      ) : null}
                    </dl>
                    <div className="flex flex-wrap items-center gap-2">
                      <ApproveApplicationDialog
                        applicationId={application.id}
                        businessName={application.business_name}
                      />
                      <RejectApplicationDialog
                        applicationId={application.id}
                        businessName={application.business_name}
                      />
                      {application.status === "submitted" ? (
                        <ActionButton
                          size="sm"
                          variant="ghost"
                          action={() => markApplicationUnderReview(application.id)}
                        >
                          Mark under review
                        </ActionButton>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No applications waiting"
            description="New vendor applications will appear here for review."
          />
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="display-3">Vendors</h2>
          <div className="flex flex-wrap gap-1">
            {["all", "approved", "pending", "suspended", "closed"].map((status) => (
              <Button key={status} asChild size="sm" variant={statusFilter === status ? "primary" : "ghost"}>
                <Link
                  href={status === "all" ? ROUTES.admin.vendors : `${ROUTES.admin.vendors}?status=${status}`}
                  className="capitalize"
                >
                  {status}
                </Link>
              </Button>
            ))}
          </div>
        </div>
        {vendors && vendors.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Commission</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendors.map((vendor) => (
                <TableRow key={vendor.id}>
                  <TableCell>
                    <p className="font-medium text-ink">{vendor.display_name}</p>
                    <p className="text-xs text-ink-faint">
                      /{vendor.slug} · {vendor.contact_email}
                    </p>
                  </TableCell>
                  <TableCell>
                    <VendorStatusBadge status={vendor.status} />
                  </TableCell>
                  <TableCell>
                    {vendor.commission_rate_bps === null ? (
                      <span className="text-ink-faint">Rules</span>
                    ) : (
                      `${(vendor.commission_rate_bps / 100).toFixed(2)}%`
                    )}
                  </TableCell>
                  <TableCell>{dateFormat.format(new Date(vendor.created_at))}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link href={ROUTES.admin.vendor(vendor.id)}>Open</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState title="No vendors" description="Approved applications become vendors and appear in this list." />
        )}
      </section>
    </div>
  );
}
