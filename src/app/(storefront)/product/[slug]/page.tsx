import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Product" };

export default function ProductPage() {
  return (
    <div className="container-editorial py-12 md:py-16">
      <PhasePlaceholder
        title="Product"
        description="Product detail with variants, imagery, reviews and vendor information."
        phase={2}
      />
    </div>
  );
}
