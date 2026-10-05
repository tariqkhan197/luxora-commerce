import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/category/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("categories").select("name").eq("slug", slug).maybeSingle();
  return { title: data?.name ?? "Category" };
}

export default async function CategoryPage({ params }: PageProps<"/category/[slug]">) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: category } = await supabase
    .from("categories")
    .select("name, description")
    .eq("slug", slug)
    .maybeSingle();
  if (!category) notFound();

  return (
    <div className="container-editorial py-12 md:py-16">
      <PhasePlaceholder
        eyebrow="Category"
        title={category.name}
        description={category.description ?? "Product listings for this category arrive with the catalog phase."}
        phase={2}
      />
    </div>
  );
}
