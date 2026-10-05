import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-11 w-full min-w-0 rounded-md border border-line bg-surface px-3.5 py-2 text-base text-ink shadow-none transition-[border-color,box-shadow] duration-200 outline-none placeholder:text-ink-faint md:text-sm",
        "focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-focus",
        "aria-invalid:border-danger aria-invalid:ring-danger/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
