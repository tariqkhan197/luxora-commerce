import Link from "next/link";
import { Heart, Search, ShoppingBag } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { getCurrentUser } from "@/lib/auth/dal";
import { AccountMenu } from "./account-menu";
import { MobileNav } from "./mobile-nav";

export const PRIMARY_NAV = [
  { label: "Shop", href: ROUTES.shop },
  { label: "Brands", href: ROUTES.search + "?type=brands" },
  { label: "Sell on Luxora", href: ROUTES.vendor.root },
] as const;

export async function SiteHeader() {
  const current = await getCurrentUser();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="container-editorial flex h-16 items-center justify-between gap-6 md:h-20">
        <div className="flex items-center gap-3 md:hidden">
          <MobileNav items={PRIMARY_NAV} signedIn={Boolean(current)} />
        </div>

        <Logo className="md:order-first" />

        <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
          {PRIMARY_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm tracking-wide text-ink-soft transition-colors hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1 md:gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Search">
            <Link href={ROUTES.search}>
              <Search />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="icon" aria-label="Wishlist" className="hidden sm:inline-flex">
            <Link href={ROUTES.wishlist}>
              <Heart />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="icon" aria-label="Bag">
            <Link href={ROUTES.cart}>
              <ShoppingBag />
            </Link>
          </Button>
          {current ? (
            <AccountMenu
              name={current.profile.full_name}
              email={current.user.email ?? ""}
              role={current.profile.role}
              avatarUrl={current.profile.avatar_url}
            />
          ) : (
            <Button asChild variant="outline" size="sm" className="ml-1 hidden sm:inline-flex">
              <Link href={ROUTES.auth.login}>Sign in</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
