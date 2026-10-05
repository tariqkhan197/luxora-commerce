import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "New product" };

export default function VendorNewProductPage() {
  return (
    <PhasePlaceholder
      eyebrow="Vendor portal"
      title="New product"
      description="Create a product with variants, pricing, imagery and inventory."
      phase={2}
    />
  );
}
