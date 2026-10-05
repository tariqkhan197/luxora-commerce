import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Addresses" };

export default function AddressesPage() {
  return (
    <PhasePlaceholder
      eyebrow="Account"
      title="Addresses"
      description="Saved shipping and billing addresses."
      phase={3}
    />
  );
}
