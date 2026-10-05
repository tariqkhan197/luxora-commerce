import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Brands" };

export default function AdminBrandsPage() {
  return <PhasePlaceholder eyebrow="Admin" title="Brands" description="Brand directory and verification." phase={2} />;
}
