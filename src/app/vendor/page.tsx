import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = {
  title: "Sell on Luxora",
  description: "Open a store on Luxora, the curated marketplace for independent fashion and lifestyle brands.",
};

const STEPS = [
  { title: "Apply", body: "Tell us about your label. Our team reviews every application personally." },
  { title: "Build your store", body: "Upload your catalog, set inventory and shape your storefront." },
  { title: "Sell & get paid", body: "Fulfil orders from your studio; payouts are scheduled and itemised." },
] as const;

export default async function VendorLandingPage() {
  const supabase = await createClient();
  const { data: plans } = await supabase
    .from("subscription_plans")
    .select("id, name, description, price_minor, currency, billing_interval, features")
    .eq("is_active", true)
    .order("position", { ascending: true });

  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <section className="border-b border-line">
          <div className="container-editorial grid gap-10 py-20 md:grid-cols-[1.2fr_1fr] md:items-end md:py-28">
            <div>
              <p className="mb-6 eyebrow">For brands</p>
              <h1 className="display-1 text-balance">Your label, presented the way it deserves.</h1>
            </div>
            <div className="max-w-md">
              <p className="text-base leading-relaxed text-ink-soft md:text-lg">
                Luxora is a curated marketplace. Vendors keep control of their catalog, pricing and fulfilment — we
                bring the audience, the checkout and the operations.
              </p>
              <Button asChild size="lg" className="mt-8">
                <Link href={ROUTES.vendor.onboarding}>
                  Apply to sell <ArrowRight />
                </Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="border-b border-line bg-surface">
          <div className="container-editorial grid gap-10 py-16 md:grid-cols-3 md:py-24">
            {STEPS.map((step, index) => (
              <article key={step.title}>
                <p className="mb-4 eyebrow">Step {index + 1}</p>
                <h2 className="display-3">{step.title}</h2>
                <p className="mt-3 text-sm leading-relaxed text-ink-soft">{step.body}</p>
              </article>
            ))}
          </div>
        </section>

        {plans && plans.length > 0 ? (
          <section>
            <div className="container-editorial py-16 md:py-24">
              <p className="mb-3 eyebrow">Plans</p>
              <h2 className="mb-10 display-2">Choose how you sell</h2>
              <ul className="grid gap-6 md:grid-cols-3">
                {plans.map((plan) => (
                  <li key={plan.id} className="rounded-lg border border-line bg-surface p-6">
                    <h3 className="display-3">{plan.name}</h3>
                    <p className="mt-2 text-sm text-ink-soft">{plan.description}</p>
                    <p className="mt-6 font-display text-3xl">
                      {formatMoney(plan.price_minor, plan.currency)}
                      <span className="ml-1 text-sm text-ink-faint">
                        / {plan.billing_interval === "monthly" ? "month" : "year"}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}
      </main>
      <SiteFooter />
    </>
  );
}
