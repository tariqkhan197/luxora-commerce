"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROUTES } from "@/config/routes";
import { cn } from "@/lib/utils";

const ITEMS = [
  { label: "Overview", href: ROUTES.account.root, exact: true },
  { label: "Orders", href: ROUTES.account.orders },
  { label: "Addresses", href: ROUTES.account.addresses },
  { label: "Reviews", href: ROUTES.account.reviews },
  { label: "Rewards", href: ROUTES.account.rewards },
  { label: "Notifications", href: ROUTES.account.notifications },
] as const;

export function AccountNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Account" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <p className="mb-3 hidden eyebrow lg:block">Account</p>
      <ul className="flex gap-1 lg:flex-col">
        {ITEMS.map((item) => {
          const active = "exact" in item && item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors",
                  active ? "bg-ink text-canvas" : "text-ink-soft hover:bg-surface-muted hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
