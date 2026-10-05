import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";

export type Phase = 2 | 3 | 4 | 5;

const PHASE_LABELS: Record<Phase, string> = {
  2: "Phase 2 · Vendor onboarding & catalog",
  3: "Phase 3 · Cart, checkout & orders",
  4: "Phase 4 · Finance, payouts & promotions",
  5: "Phase 5 · Analytics, content & loyalty",
};

interface PhasePlaceholderProps {
  title: string;
  description: string;
  phase: Phase;
  eyebrow?: string;
}

/**
 * Rendered by routes whose feature is scheduled for a later implementation
 * phase. It deliberately shows no mock data: the route, its protection and
 * its navigation entry are real; the feature is not yet built.
 */
export function PhasePlaceholder({ title, description, phase, eyebrow }: PhasePlaceholderProps) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <div className="rounded-lg border border-dashed border-line-strong bg-surface p-8">
        <Badge variant="accent">Scheduled</Badge>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">
          This area is part of <span className="font-medium text-ink">{PHASE_LABELS[phase]}</span>. The route, access
          control and data model are in place; the interface will be delivered in that phase.
        </p>
      </div>
    </div>
  );
}
