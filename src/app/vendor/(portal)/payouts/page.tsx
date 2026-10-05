import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Payouts" };

export default function VendorPayoutsPage() {
  return (
    <PhasePlaceholder
      eyebrow="Vendor portal"
      title="Payouts"
      description="Earnings, commission breakdowns and payout statements."
      phase={4}
    />
  );
}
