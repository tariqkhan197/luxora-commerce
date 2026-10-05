import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Coupons" };

export default function VendorCouponsPage() {
  return (
    <PhasePlaceholder eyebrow="Vendor portal" title="Coupons" description="Vendor-scoped discount codes." phase={4} />
  );
}
