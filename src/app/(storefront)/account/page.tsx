import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/config/routes";
import { ProfileForm } from "@/features/account/components/profile-form";
import { requireUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Account" };

const ROLE_LABELS = {
  customer: "Customer",
  vendor: "Vendor",
  admin: "Administrator",
  super_admin: "Super administrator",
} as const;

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const [{ user, profile }, params] = await Promise.all([requireUser(ROUTES.account.root), searchParams]);
  const memberSince = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(
    new Date(profile.created_at),
  );

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        eyebrow="Overview"
        title={profile.full_name ? `Hello, ${profile.full_name.split(" ")[0]}` : "Your account"}
        description={`Member since ${memberSince}.`}
        actions={<Badge variant="outline">{ROLE_LABELS[profile.role]}</Badge>}
      />

      {params.updated === "password" ? (
        <Alert variant="success">
          <CheckCircle2 />
          <AlertDescription>Your password has been updated.</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Personal details</CardTitle>
            <CardDescription>
              Your name appears on orders and reviews. Email changes are handled through sign-in security.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm fullName={profile.full_name} phone={profile.phone} />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Sign-in</CardTitle>
              <CardDescription className="break-all">{user.email}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <p className="text-ink-soft">Email {user.email_confirmed_at ? "verified" : "not yet verified"}.</p>
              <Button asChild variant="outline" size="sm">
                <Link href={ROUTES.auth.forgotPassword}>Change password</Link>
              </Button>
            </CardContent>
          </Card>

          {profile.role === "customer" ? (
            <Card className="bg-accent-soft/60">
              <CardHeader>
                <CardTitle>Sell on Luxora</CardTitle>
                <CardDescription>Run an independent label? Apply to open a store.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild size="sm" variant="accent">
                  <Link href={ROUTES.vendor.onboarding}>Start application</Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
