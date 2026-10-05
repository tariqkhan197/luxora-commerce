import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-28 w-full rounded-md border border-line bg-surface px-3.5 py-2.5 text-base text-ink transition-[border-color,box-shadow] duration-200 outline-none placeholder:text-ink-faint md:text-sm",
        "focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-focus",
        "aria-invalid:border-danger aria-invalid:ring-danger/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
