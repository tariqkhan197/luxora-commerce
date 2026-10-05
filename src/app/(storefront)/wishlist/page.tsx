import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Wishlist" };

export default function WishlistPage() {
  return (
    <div className="container-editorial py-12 md:py-16">
      <PhasePlaceholder title="Wishlist" description="Save pieces to revisit and share." phase={3} />
    </div>
  );
}
