import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/brand/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("brands").select("name").eq("slug", slug).maybeSingle();
  return { title: data?.name ?? "Brand" };
}

export default async function BrandPage({ params }: PageProps<"/brand/[slug]">) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: brand } = await supabase.from("brands").select("name, description").eq("slug", slug).maybeSingle();
  if (!brand) notFound();

  return (
    <div className="container-editorial py-12 md:py-16">
      <PhasePlaceholder
        eyebrow="Brand"
        title={brand.name}
        description={brand.description ?? "Brand pages list every product carrying this label."}
        phase={2}
      />
    </div>
  );
}
