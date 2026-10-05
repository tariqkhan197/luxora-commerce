import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Flash sales" };

export default function AdminFlashSalesPage() {
  return (
    <PhasePlaceholder
      eyebrow="Admin"
      title="Flash sales"
      description="Time-boxed promotions across vendors."
      phase={4}
    />
  );
}
