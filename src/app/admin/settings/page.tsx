import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Settings" };

export default function AdminSettingsPage() {
  return (
    <PhasePlaceholder
      eyebrow="Admin"
      title="Settings"
      description="Platform settings: currency, commission defaults, order numbering."
      phase={2}
    />
  );
}
