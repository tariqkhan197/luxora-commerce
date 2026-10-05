import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/** Honest empty state used wherever real data does not exist yet. */
export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-surface px-6 py-16 text-center",
        className,
      )}
    >
      {icon ? <div className="mb-4 text-ink-faint [&_svg]:size-7">{icon}</div> : null}
      <h3 className="display-3">{title}</h3>
      {description ? <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-soft">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
