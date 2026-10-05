import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { ROUTES } from "@/config/routes";
import { PortalNav, type PortalNavItem } from "./portal-nav";

export type { PortalNavItem } from "./portal-nav";

interface PortalShellProps {
  title: string;
  subtitle?: string;
  items: PortalNavItem[];
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Two-column shell shared by the Vendor Portal and the Admin Command Center.
 * Desktop: fixed sidebar. Tablet/mobile: compact top bar with horizontal nav.
 */
export function PortalShell({ title, subtitle, items, children, footer }: PortalShellProps) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="border-b border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between px-5 py-4 lg:block lg:px-6 lg:py-6">
          <div>
            <Logo className="text-xl" />
            <p className="mt-1 text-xs tracking-wide text-ink-faint">{title}</p>
          </div>
          {subtitle ? (
            <p className="hidden truncate text-sm text-ink-soft lg:mt-6 lg:block" title={subtitle}>
              {subtitle}
            </p>
          ) : null}
        </div>
        <PortalNav items={items} />
        <div className="hidden px-6 py-5 lg:mt-auto lg:block">
          {footer}
          <Link href={ROUTES.home} className="mt-3 block text-xs text-ink-faint hover:text-ink">
            ← Back to storefront
          </Link>
        </div>
      </aside>
      <main className="flex-1">
        <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-10 lg:py-12">{children}</div>
      </main>
    </div>
  );
}

export function navItem(label: string, href: string, icon: LucideIcon): PortalNavItem {
  return { label, href, icon };
}
