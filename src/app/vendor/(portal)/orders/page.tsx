import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Orders" };

export default function VendorOrdersPage() {
  return (
    <PhasePlaceholder
      eyebrow="Vendor portal"
      title="Orders"
      description="Vendor orders assigned to you from customer checkouts."
      phase={3}
    />
  );
}
