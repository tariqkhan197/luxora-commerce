import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Orders" };

export default function AdminOrdersPage() {
  return (
    <PhasePlaceholder
      eyebrow="Admin"
      title="Orders"
      description="Every order across the marketplace with vendor breakdowns."
      phase={3}
    />
  );
}
