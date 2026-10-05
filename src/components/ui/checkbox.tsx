import * as React from "react";
import { cn } from "@/lib/utils";

interface CheckboxFieldProps extends Omit<React.ComponentProps<"input">, "type"> {
  label: string;
  description?: string;
}

/** Native checkbox with label and optional description. */
function CheckboxField({ label, description, className, id, ...props }: CheckboxFieldProps) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  return (
    <label htmlFor={inputId} className={cn("flex cursor-pointer items-start gap-3", className)}>
      <input
        id={inputId}
        type="checkbox"
        data-slot="checkbox"
        className="[&:checked]:bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22white%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22M3.5 8.5l3 3 6-7%22/></svg>')] mt-0.5 size-4 shrink-0 cursor-pointer appearance-none rounded-sm border border-line-strong bg-surface transition-colors checked:border-ink checked:bg-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 [&:checked]:bg-center [&:checked]:bg-no-repeat"
        {...props}
      />
      <span className="grid gap-0.5">
        <span className="text-sm text-ink">{label}</span>
        {description ? <span className="text-xs text-ink-faint">{description}</span> : null}
      </span>
    </label>
  );
}

export { CheckboxField };
