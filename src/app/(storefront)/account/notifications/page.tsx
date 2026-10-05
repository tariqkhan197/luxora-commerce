import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <PhasePlaceholder
      eyebrow="Account"
      title="Notifications"
      description="Order updates, vendor replies and account notices."
      phase={5}
    />
  );
}
