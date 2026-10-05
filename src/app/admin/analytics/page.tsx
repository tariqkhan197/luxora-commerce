import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Analytics" };

export default function AdminAnalyticsPage() {
  return (
    <PhasePlaceholder
      eyebrow="Admin"
      title="Analytics"
      description="Marketplace performance built from real order and event data."
      phase={5}
    />
  );
}
