import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/store/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("stores")
    .select("name, seo_title, seo_description")
    .eq("slug", slug)
    .maybeSingle();
  return { title: data?.seo_title ?? data?.name ?? "Store", description: data?.seo_description ?? undefined };
}

/** Only published stores of approved vendors are visible here (enforced by RLS). */
export default async function StorePage({ params }: PageProps<"/store/[slug]">) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: store } = await supabase
    .from("stores")
    .select("name, tagline, description")
    .eq("slug", slug)
    .maybeSingle();
  if (!store) notFound();

  return (
    <div className="container-editorial py-12 md:py-16">
      <PhasePlaceholder
        eyebrow="Store"
        title={store.name}
        description={store.tagline ?? store.description ?? "This vendor's storefront, products and policies."}
        phase={2}
      />
    </div>
  );
}
