import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Native select styled to match Input. Accessible and fully keyboard/mobile friendly. */
function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(
          "flex h-11 w-full appearance-none rounded-md border border-line bg-surface px-3.5 pr-10 text-base text-ink transition-[border-color,box-shadow] duration-200 outline-none md:text-sm",
          "focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-focus",
          "aria-invalid:border-danger aria-invalid:ring-danger/30",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-ink-faint"
      />
    </div>
  );
}

export { Select };
