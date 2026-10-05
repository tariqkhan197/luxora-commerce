"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ROUTES } from "@/config/routes";

interface MobileNavProps {
  items: ReadonlyArray<{ label: string; href: string }>;
  signedIn: boolean;
}

export function MobileNav({ items, signedIn }: MobileNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open menu">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left">
        <SheetHeader>
          <SheetTitle className="font-display tracking-[0.08em] uppercase">Luxora</SheetTitle>
          <SheetDescription>Curated fashion & lifestyle</SheetDescription>
        </SheetHeader>
        <nav className="flex flex-col px-6" aria-label="Mobile">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="py-3 font-display text-2xl text-ink"
            >
              {item.label}
            </Link>
          ))}
          <Separator className="my-4" />
          {signedIn ? (
            <Link href={ROUTES.account.root} onClick={() => setOpen(false)} className="py-2 text-sm text-ink-soft">
              Your account
            </Link>
          ) : (
            <>
              <Link href={ROUTES.auth.login} onClick={() => setOpen(false)} className="py-2 text-sm text-ink-soft">
                Sign in
              </Link>
              <Link href={ROUTES.auth.signup} onClick={() => setOpen(false)} className="py-2 text-sm text-ink-soft">
                Create account
              </Link>
            </>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
