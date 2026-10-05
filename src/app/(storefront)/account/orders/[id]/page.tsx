import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Order details" };

export default function OrderDetailPage() {
  return (
    <PhasePlaceholder
      eyebrow="Account"
      title="Order details"
      description="Items, shipments, payments and returns for a single order."
      phase={3}
    />
  );
}
