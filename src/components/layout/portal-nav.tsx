"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PortalNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Match only the exact path (used for dashboards whose href is a prefix of others). */
  exact?: boolean;
}

export function PortalNav({ items }: { items: PortalNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Portal" className="overflow-x-auto px-3 pb-3 lg:flex-1 lg:px-3 lg:py-2">
      <ul className="flex gap-1 lg:flex-col">
        {items.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors",
                  active ? "bg-ink text-canvas" : "text-ink-soft hover:bg-surface-muted hover:text-ink",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
