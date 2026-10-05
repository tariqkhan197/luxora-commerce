import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Search" };

export default function SearchPage() {
  return (
    <div className="container-editorial py-12 md:py-16">
      <PhasePlaceholder
        title="Search"
        description="Search products, brands and stores across the marketplace."
        phase={2}
      />
    </div>
  );
}
