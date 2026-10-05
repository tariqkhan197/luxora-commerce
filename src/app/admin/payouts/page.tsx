import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Payouts" };

export default function AdminPayoutsPage() {
  return (
    <PhasePlaceholder eyebrow="Admin" title="Payouts" description="Vendor payout runs and statements." phase={4} />
  );
}
