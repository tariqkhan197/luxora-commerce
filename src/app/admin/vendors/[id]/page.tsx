import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Vendor details" };

export default function AdminVendorDetailPage() {
  return (
    <PhasePlaceholder
      eyebrow="Admin"
      title="Vendor details"
      description="A single vendor: team, store, catalog, orders and finances."
      phase={2}
    />
  );
}
