import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Rewards" };

export default function RewardsPage() {
  return (
    <PhasePlaceholder eyebrow="Account" title="Rewards" description="Loyalty points, tier and history." phase={5} />
  );
}
