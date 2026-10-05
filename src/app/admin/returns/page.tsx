import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Returns" };

export default function AdminReturnsPage() {
  return <PhasePlaceholder eyebrow="Admin" title="Returns" description="Return requests and inspections." phase={4} />;
}
