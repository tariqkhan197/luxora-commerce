import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Analytics" };

export default function VendorAnalyticsPage() {
  return (
    <PhasePlaceholder
      eyebrow="Vendor portal"
      title="Analytics"
      description="Sales, conversion and product performance for your store."
      phase={5}
    />
  );
}
