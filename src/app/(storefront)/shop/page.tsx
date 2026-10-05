import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Shop" };

export default function ShopPage() {
  return (
    <div className="container-editorial py-12 md:py-16">
      <PhasePlaceholder
        title="Shop"
        description="The full catalog with filters, sorting and editorial collections."
        phase={2}
      />
    </div>
  );
}
