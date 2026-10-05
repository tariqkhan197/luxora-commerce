import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Edit product" };

export default function VendorProductDetailPage() {
  return (
    <PhasePlaceholder
      eyebrow="Vendor portal"
      title="Edit product"
      description="Edit a product, its variants and images."
      phase={2}
    />
  );
}
