import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Customers" };

export default function AdminCustomersPage() {
  return (
    <PhasePlaceholder
      eyebrow="Admin"
      title="Customers"
      description="Customer accounts and support tooling."
      phase={3}
    />
  );
}
