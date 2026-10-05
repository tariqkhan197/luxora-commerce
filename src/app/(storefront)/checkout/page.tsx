import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Checkout" };

export default function CheckoutPage() {
  return (
    <div className="container-editorial py-12 md:py-16">
      <PhasePlaceholder
        title="Checkout"
        description="Secure checkout that splits a single payment across every vendor in your bag."
        phase={3}
      />
    </div>
  );
}
