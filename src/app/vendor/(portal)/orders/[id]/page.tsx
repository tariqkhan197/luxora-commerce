import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Order details" };

export default function VendorOrderDetailPage() {
  return (
    <PhasePlaceholder
      eyebrow="Vendor portal"
      title="Order details"
      description="Fulfil a vendor order: items, shipping and customer notes."
      phase={3}
    />
  );
}
