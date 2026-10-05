import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Vendors" };

export default function AdminVendorsPage() {
  return (
    <PhasePlaceholder
      eyebrow="Admin"
      title="Vendors"
      description="Review applications, approve or suspend vendors and manage commission overrides."
      phase={2}
    />
  );
}
