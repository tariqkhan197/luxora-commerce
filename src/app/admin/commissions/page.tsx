import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Commissions" };

export default function AdminCommissionsPage() {
  return (
    <PhasePlaceholder
      eyebrow="Admin"
      title="Commissions"
      description="Global, vendor and category commission rules and the commission ledger."
      phase={4}
    />
  );
}
