import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Coupons" };

export default function AdminCouponsPage() {
  return <PhasePlaceholder eyebrow="Admin" title="Coupons" description="Platform-wide discount codes." phase={4} />;
}
