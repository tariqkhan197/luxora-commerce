import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Refunds" };

export default function AdminRefundsPage() {
  return <PhasePlaceholder eyebrow="Admin" title="Refunds" description="Refund requests and processing." phase={4} />;
}
