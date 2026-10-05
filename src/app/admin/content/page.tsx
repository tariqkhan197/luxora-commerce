import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Content" };

export default function AdminContentPage() {
  return <PhasePlaceholder eyebrow="Admin" title="Content" description="Homepage sections and banners." phase={5} />;
}
