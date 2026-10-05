import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage() {
  return (
    <PhasePlaceholder
      eyebrow="Account"
      title="Orders"
      description="Every order you've placed, grouped by vendor shipment."
      phase={3}
    />
  );
}
