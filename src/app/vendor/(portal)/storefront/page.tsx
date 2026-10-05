import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Storefront" };

export default function VendorStorefrontPage() {
  return (
    <PhasePlaceholder
      eyebrow="Vendor portal"
      title="Storefront"
      description="Logo, cover, story, policies and SEO for your public store."
      phase={2}
    />
  );
}
