import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-medium tracking-[0.12em] whitespace-nowrap uppercase",
  {
    variants: {
      variant: {
        neutral: "border-line bg-surface-muted text-ink-soft",
        ink: "border-ink bg-ink text-canvas",
        accent: "border-transparent bg-accent-soft text-ink",
        success: "border-transparent bg-success/10 text-success",
        warning: "border-transparent bg-warning/15 text-ink",
        danger: "border-transparent bg-danger-soft text-danger",
        outline: "border-line-strong text-ink",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
