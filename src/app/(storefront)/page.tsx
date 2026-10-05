import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { createClient } from "@/lib/supabase/server";

const PILLARS = [
  {
    title: "Curated, not crowded",
    body: "Every vendor is reviewed before they can sell. Fewer, better brands — and a storefront that stays considered.",
  },
  {
    title: "One checkout, many ateliers",
    body: "Buy from several independent brands in a single order. Each ships from its own studio; you track everything in one place.",
  },
  {
    title: "Fair to makers",
    body: "Transparent commissions and scheduled payouts mean the brands you love keep more of what they earn.",
  },
] as const;

export default async function HomePage() {
  const supabase = await createClient();
  const { data: categories } = await supabase
    .from("categories")
    .select("id, slug, name, description")
    .is("parent_id", null)
    .eq("is_active", true)
    .order("position", { ascending: true })
    .limit(8);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-line">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_80%_20%,oklch(94%_0.03_80),transparent_55%)]"
        />
        <div className="relative container-editorial grid gap-12 py-20 md:grid-cols-[1.2fr_1fr] md:items-end md:py-28 lg:py-36">
          <div className="animate-fade-up">
            <p className="mb-6 eyebrow">Fashion & lifestyle · Independent brands</p>
            <h1 className="display-1 text-balance">A marketplace with an editor&apos;s eye.</h1>
          </div>
          <div className="max-w-md animate-fade-up [animation-delay:120ms]">
            <p className="text-base leading-relaxed text-ink-soft md:text-lg">
              Luxora gathers independent ateliers and labels into one considered storefront — with a single checkout and
              the kind of service you&apos;d expect from a boutique.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href={ROUTES.shop}>
                  Explore the shop <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href={ROUTES.vendor.root}>Sell on Luxora</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Categories — rendered only when the catalog has them */}
      {categories && categories.length > 0 ? (
        <section className="border-b border-line">
          <div className="container-editorial py-16 md:py-24">
            <div className="mb-10 flex items-end justify-between gap-6">
              <div>
                <p className="mb-3 eyebrow">Browse</p>
                <h2 className="display-2">Departments</h2>
              </div>
              <Link href={ROUTES.shop} className="hidden text-sm text-ink-soft hover:text-ink sm:inline">
                View all →
              </Link>
            </div>
            <ul className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
              {categories.map((category) => (
                <li key={category.id} className="bg-surface">
                  <Link
                    href={ROUTES.category(category.slug)}
                    className="group flex h-full flex-col justify-between gap-10 p-6 transition-colors hover:bg-surface-muted"
                  >
                    <span className="display-3 group-hover:text-accent">{category.name}</span>
                    <span className="line-clamp-2 text-sm text-ink-soft">
                      {category.description ?? "Discover the edit"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {/* Pillars */}
      <section className="border-b border-line bg-surface">
        <div className="container-editorial grid gap-10 py-16 md:grid-cols-3 md:gap-12 md:py-24">
          {PILLARS.map((pillar, index) => (
            <article key={pillar.title} className="max-w-sm">
              <p className="mb-4 eyebrow">0{index + 1}</p>
              <h3 className="display-3">{pillar.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-ink-soft">{pillar.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Vendor CTA */}
      <section>
        <div className="container-editorial flex flex-col gap-8 py-16 md:flex-row md:items-center md:justify-between md:py-24">
          <div className="max-w-xl">
            <p className="mb-4 eyebrow">For brands</p>
            <h2 className="display-2 text-balance">Built for independent labels who care about presentation.</h2>
          </div>
          <Button asChild size="lg" variant="accent">
            <Link href={ROUTES.vendor.onboarding}>
              Apply to sell <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}
