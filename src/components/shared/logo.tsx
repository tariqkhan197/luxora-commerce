import Link from "next/link";
import { ROUTES } from "@/config/routes";
import { cn } from "@/lib/utils";

export function Logo({ className, href = ROUTES.home }: { className?: string; href?: string }) {
  return (
    <Link
      href={href}
      className={cn("font-display text-2xl tracking-[0.08em] text-ink uppercase select-none", className)}
      aria-label="Luxora home"
    >
      Luxora
    </Link>
  );
}
