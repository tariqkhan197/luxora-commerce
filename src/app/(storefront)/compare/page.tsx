import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Compare" };

export default function ComparePage() {
  return (
    <div className="container-editorial py-12 md:py-16">
      <PhasePlaceholder title="Compare" description="Compare materials, fit and pricing side by side." phase={3} />
    </div>
  );
}
