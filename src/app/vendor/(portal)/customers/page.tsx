import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Customers" };

export default function VendorCustomersPage() {
  return (
    <PhasePlaceholder
      eyebrow="Vendor portal"
      title="Customers"
      description="Customers who have purchased from your store."
      phase={3}
    />
  );
}
