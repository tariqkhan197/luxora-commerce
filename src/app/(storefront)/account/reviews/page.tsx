import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Your reviews" };

export default function ReviewsPage() {
  return (
    <PhasePlaceholder
      eyebrow="Account"
      title="Your reviews"
      description="Reviews you've written and their moderation status."
      phase={3}
    />
  );
}
