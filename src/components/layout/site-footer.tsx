import Link from "next/link";
import { Logo } from "@/components/shared/logo";
import { ROUTES } from "@/config/routes";

const FOOTER_GROUPS = [
  {
    heading: "Shop",
    links: [
      { label: "All products", href: ROUTES.shop },
      { label: "Search", href: ROUTES.search },
      { label: "Wishlist", href: ROUTES.wishlist },
    ],
  },
  {
    heading: "Account",
    links: [
      { label: "Your account", href: ROUTES.account.root },
      { label: "Orders", href: ROUTES.account.orders },
      { label: "Rewards", href: ROUTES.account.rewards },
    ],
  },
  {
    heading: "Partners",
    links: [
      { label: "Sell on Luxora", href: ROUTES.vendor.root },
      { label: "Vendor portal", href: ROUTES.vendor.dashboard },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-surface">
      <div className="container-editorial grid gap-12 py-16 md:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-4 text-sm leading-relaxed text-ink-soft">
            A considered marketplace for independent fashion and lifestyle brands.
          </p>
        </div>
        {FOOTER_GROUPS.map((group) => (
          <div key={group.heading}>
            <p className="mb-4 eyebrow">{group.heading}</p>
            <ul className="flex flex-col gap-2.5">
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-ink-soft transition-colors hover:text-ink">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="container-editorial flex flex-col gap-2 py-6 text-xs text-ink-faint sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Luxora. All rights reserved.</p>
          <p>Prices shown include applicable taxes where required by law.</p>
        </div>
      </div>
    </footer>
  );
}
