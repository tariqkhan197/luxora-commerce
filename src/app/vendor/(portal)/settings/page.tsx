import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Settings" };

export default function VendorSettingsPage() {
  return (
    <PhasePlaceholder
      eyebrow="Vendor portal"
      title="Settings"
      description="Business details, team members and notification preferences."
      phase={2}
    />
  );
}
