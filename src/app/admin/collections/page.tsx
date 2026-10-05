import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Collections" };

export default function AdminCollectionsPage() {
  return (
    <PhasePlaceholder
      eyebrow="Admin"
      title="Collections"
      description="Editorial collections for the storefront."
      phase={2}
    />
  );
}
