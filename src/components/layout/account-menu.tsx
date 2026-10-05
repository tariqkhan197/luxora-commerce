"use client";

import Link from "next/link";
import { LayoutDashboard, LogOut, Package, Settings, Store, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROUTES } from "@/config/routes";
import { signOut } from "@/features/auth/actions";
import type { UserRole } from "@/lib/supabase/database.types";

interface AccountMenuProps {
  name: string | null;
  email: string;
  role: UserRole;
  avatarUrl: string | null;
}

function initials(name: string | null, email: string): string {
  const source = name?.trim() || email;
  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function AccountMenu({ name, email, role, avatarUrl }: AccountMenuProps) {
  const isAdmin = role === "admin" || role === "super_admin";
  const isVendor = role === "vendor";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="ml-1 rounded-full ring-offset-2 ring-offset-canvas outline-none focus-visible:ring-2 focus-visible:ring-focus"
        aria-label="Account menu"
      >
        <Avatar>
          {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
          <AvatarFallback>{initials(name, email)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <span className="block truncate text-sm font-medium text-ink">{name ?? "Your account"}</span>
          <span className="block truncate text-xs text-ink-faint">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={ROUTES.account.root}>
            <User /> Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={ROUTES.account.orders}>
            <Package /> Orders
          </Link>
        </DropdownMenuItem>
        {isVendor ? (
          <DropdownMenuItem asChild>
            <Link href={ROUTES.vendor.dashboard}>
              <Store /> Vendor portal
            </Link>
          </DropdownMenuItem>
        ) : null}
        {isAdmin ? (
          <DropdownMenuItem asChild>
            <Link href={ROUTES.admin.root}>
              <LayoutDashboard /> Admin
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <Link href={ROUTES.account.notifications}>
            <Settings /> Notifications
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()} variant="destructive">
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
