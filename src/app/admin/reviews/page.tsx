import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Reviews" };

export default function AdminReviewsPage() {
  return <PhasePlaceholder eyebrow="Admin" title="Reviews" description="Review moderation queue." phase={3} />;
}
