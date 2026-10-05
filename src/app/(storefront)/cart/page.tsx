import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Your bag" };

export default function CartPage() {
  return (
    <div className="container-editorial py-12 md:py-16">
      <PhasePlaceholder
        title="Your bag"
        description="Items from multiple vendors, grouped by who ships them."
        phase={3}
      />
    </div>
  );
}
