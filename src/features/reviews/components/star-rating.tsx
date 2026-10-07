import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  /** 0–5, may be fractional (averages). */
  value: number;
  /** Accessible description; defaults to "<value> out of 5 stars". */
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

/** Read-only star display. Partial stars are drawn by clipping a filled layer. */
export function StarRating({ value, label, size = "sm", className }: StarRatingProps) {
  const clamped = Math.max(0, Math.min(5, value));
  const icon = size === "sm" ? "size-3.5" : "size-5";
  return (
    <span
      role="img"
      aria-label={label ?? `${clamped.toFixed(1).replace(/\.0$/, "")} out of 5 stars`}
      className={cn("inline-flex items-center gap-0.5", className)}
    >
      {[0, 1, 2, 3, 4].map((index) => {
        const fill = Math.max(0, Math.min(1, clamped - index));
        return (
          <span key={index} className={cn("relative inline-block", icon)} aria-hidden>
            <Star className={cn("absolute inset-0 text-line-strong", icon)} />
            {fill > 0 ? (
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star className={cn("fill-current text-ink", icon)} />
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}
