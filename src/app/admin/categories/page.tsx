import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Categories" };

export default function AdminCategoriesPage() {
  return (
    <PhasePlaceholder
      eyebrow="Admin"
      title="Categories"
      description="The category tree and category-level commission rules."
      phase={2}
    />
  );
}
