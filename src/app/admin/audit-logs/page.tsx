import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Audit logs" };

export default function AdminAuditLogsPage() {
  return (
    <PhasePlaceholder
      eyebrow="Admin"
      title="Audit logs"
      description="An immutable record of sensitive administrative actions."
      phase={2}
    />
  );
}
