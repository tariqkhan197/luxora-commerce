import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Products" };

export default function AdminProductsPage() {
  return (
    <PhasePlaceholder
      eyebrow="Admin"
      title="Products"
      description="Moderate the catalog: approve, reject and archive products."
      phase={2}
    />
  );
}
