import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium tracking-wide whitespace-nowrap transition-[background-color,color,border-color,box-shadow,transform] duration-300 ease-out-expo active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ink text-canvas shadow-soft hover:bg-ink/90",
        accent: "bg-accent text-accent-ink shadow-soft hover:brightness-105",
        secondary: "bg-surface-muted text-ink hover:bg-line",
        outline: "border border-line-strong bg-transparent text-ink hover:border-ink hover:bg-surface",
        ghost: "text-ink hover:bg-surface-muted",
        link: "h-auto px-0 text-ink underline-offset-4 hover:underline",
        destructive: "bg-danger text-white hover:bg-danger/90",
      },
      size: {
        sm: "h-9 px-3.5 text-xs",
        md: "h-11 px-5",
        lg: "h-12 px-7 text-[0.9375rem]",
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, className }));

  // Radix Slot requires exactly one child, so the loading indicator is only
  // rendered for real <button> elements.
  if (asChild) {
    return (
      <Slot data-slot="button" className={classes} {...props}>
        {children}
      </Slot>
    );
  }

  return (
    <button
      data-slot="button"
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export { Button, buttonVariants };
