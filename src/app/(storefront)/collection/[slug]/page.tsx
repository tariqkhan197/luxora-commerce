import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/collection/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("collections").select("name").eq("slug", slug).maybeSingle();
  return { title: data?.name ?? "Collection" };
}

export default async function CollectionPage({ params }: PageProps<"/collection/[slug]">) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: collection } = await supabase
    .from("collections")
    .select("name, description")
    .eq("slug", slug)
    .maybeSingle();
  if (!collection) notFound();

  return (
    <div className="container-editorial py-12 md:py-16">
      <PhasePlaceholder
        eyebrow="Collection"
        title={collection.name}
        description={collection.description ?? "Curated edits assembled by the Luxora team."}
        phase={2}
      />
    </div>
  );
}
