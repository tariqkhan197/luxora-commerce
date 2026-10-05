import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/config/routes";
import { VendorApplicationForm } from "@/features/vendors/components/vendor-application-form";
import { requireUser } from "@/lib/auth/dal";
import { fromPostgrestError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Vendor onboarding" };

const STATUS_COPY = {
  submitted: {
    badge: "Submitted",
    variant: "accent",
    body: "Thanks — your application is in the queue. We'll email you once it has been reviewed.",
  },
  under_review: {
    badge: "Under review",
    variant: "warning",
    body: "Our team is reviewing your application. We may reach out for more information.",
  },
  approved: {
    badge: "Approved",
    variant: "success",
    body: "Your application was approved. Your store is being prepared.",
  },
  rejected: { badge: "Not approved", variant: "danger", body: "Unfortunately we couldn't approve this application." },
} as const;

export default async function VendorOnboardingPage() {
  const { user, profile } = await requireUser(ROUTES.vendor.onboarding);
  const supabase = await createClient();

  const { data: membership } = await supabase
    .from("vendor_users")
    .select("vendor_id")
    .eq("profile_id", profile.id)
    .limit(1)
    .maybeSingle();
  if (membership) redirect(ROUTES.vendor.dashboard);

  const { data: application, error } = await supabase
    .from("vendor_applications")
    .select("id, business_name, status, rejection_reason, created_at")
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw fromPostgrestError(error);

  const latest = application && application.status !== "rejected" ? application : null;

  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <div className="container-editorial max-w-4xl py-12 md:py-16">
          <PageHeader
            eyebrow="Sell on Luxora"
            title={latest ? "Your application" : "Apply to open a store"}
            description={
              latest
                ? undefined
                : "Tell us about your brand. Once approved you'll be able to build your storefront, list products and manage orders."
            }
          />
          <div className="mt-10">
            {latest ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-4">
                    <CardTitle>{latest.business_name}</CardTitle>
                    <Badge variant={STATUS_COPY[latest.status].variant}>{STATUS_COPY[latest.status].badge}</Badge>
                  </div>
                  <CardDescription>
                    Submitted {new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(new Date(latest.created_at))}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-sm leading-relaxed text-ink-soft">
                  {STATUS_COPY[latest.status].body}
                </CardContent>
              </Card>
            ) : (
              <>
                {application?.status === "rejected" ? (
                  <Card className="mb-8 border-danger/30">
                    <CardHeader>
                      <CardTitle>Previous application not approved</CardTitle>
                      <CardDescription>
                        {application.rejection_reason ?? "You're welcome to apply again with more detail."}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                ) : null}
                <VendorApplicationForm defaultEmail={user.email ?? ""} />
              </>
            )}
          </div>
          <p className="mt-10 text-sm text-ink-soft">
            Questions about selling?{" "}
            <Button asChild variant="link" className="h-auto p-0 text-sm">
              <Link href={ROUTES.vendor.root}>Read how Luxora works for brands</Link>
            </Button>
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
