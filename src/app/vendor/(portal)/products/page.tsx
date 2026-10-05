import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Products" };

export default function VendorProductsPage() {
  return (
    <PhasePlaceholder
      eyebrow="Vendor portal"
      title="Products"
      description="Your catalog: create, edit, submit for review and archive products."
      phase={2}
    />
  );
}
