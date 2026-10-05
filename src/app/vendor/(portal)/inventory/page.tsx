import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Inventory" };

export default function VendorInventoryPage() {
  return (
    <PhasePlaceholder
      eyebrow="Vendor portal"
      title="Inventory"
      description="Stock levels, reservations, low-stock alerts and movement history."
      phase={2}
    />
  );
}
