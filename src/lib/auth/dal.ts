import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { homeForRole, ROUTES } from "@/config/routes";
import { AppError, fromPostgrestError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { Profile, UserRole, Vendor, VendorMemberRole } from "@/lib/supabase/database.types";

/**
 * Data Access Layer for authentication.
 *
 * All server-side code (layouts, pages, actions) resolves the current user
 * through these helpers. They validate the session with Supabase Auth
 * (`getUser()`, which contacts the Auth server) and load the profile row that
 * carries the application role and account status.
 */

export interface CurrentUser {
  user: User;
  profile: Profile;
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (profileError) {
    // A missing profile means the auth trigger did not run — treat as signed out
    // rather than leaking a half-initialised account into the UI.
    if (profileError.code === "PGRST116") return null;
    throw fromPostgrestError(profileError);
  }
  return { user, profile };
});

/** Redirects to the login page (preserving the intended destination) when signed out. */
export async function requireUser(nextPath?: string): Promise<CurrentUser> {
  const current = await getCurrentUser();
  if (!current) {
    const target = nextPath ? `${ROUTES.auth.login}?next=${encodeURIComponent(nextPath)}` : ROUTES.auth.login;
    redirect(target);
  }
  if (current.profile.status !== "active") {
    redirect(`${ROUTES.auth.error}?reason=account_${current.profile.status}`);
  }
  return current;
}

const ROLE_RANK: Record<UserRole, number> = { customer: 0, vendor: 1, admin: 2, super_admin: 3 };

export function hasRole(profile: Pick<Profile, "role">, allowed: readonly UserRole[]): boolean {
  return allowed.includes(profile.role);
}

export function isAdminRole(role: UserRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.admin;
}

/**
 * Requires one of the given roles. Admins are NOT implicitly granted vendor
 * access — vendor pages operate on vendor-scoped data and should be explicit.
 */
export async function requireRole(allowed: readonly UserRole[], nextPath?: string): Promise<CurrentUser> {
  const current = await requireUser(nextPath);
  if (!hasRole(current.profile, allowed)) {
    redirect(ROUTES.forbidden);
  }
  return current;
}

export interface VendorContext extends CurrentUser {
  vendor: Vendor;
  memberRole: VendorMemberRole;
}

/**
 * Resolves the vendor the current user operates. Users without a vendor
 * membership are sent to onboarding; RLS guarantees the query only returns
 * vendors they belong to.
 */
export async function requireVendorContext(nextPath?: string): Promise<VendorContext> {
  const current = await requireUser(nextPath);
  const supabase = await createClient();
  const { data: membership, error } = await supabase
    .from("vendor_users")
    .select("vendor_id, role")
    .eq("profile_id", current.profile.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw fromPostgrestError(error);
  if (!membership) redirect(ROUTES.vendor.onboarding);

  const { data: vendor, error: vendorError } = await supabase
    .from("vendors")
    .select("*")
    .eq("id", membership.vendor_id)
    .single();
  if (vendorError) throw fromPostgrestError(vendorError);

  return { ...current, vendor, memberRole: membership.role };
}

/** Throws (instead of redirecting) — for Server Actions and Route Handlers. */
export async function assertUser(): Promise<CurrentUser> {
  const current = await getCurrentUser();
  if (!current) throw AppError.unauthorized();
  if (current.profile.status !== "active") throw AppError.forbidden("This account is not active.");
  return current;
}

export async function assertRole(allowed: readonly UserRole[]): Promise<CurrentUser> {
  const current = await assertUser();
  if (!hasRole(current.profile, allowed)) throw AppError.forbidden();
  return current;
}

/** Vendor context for Server Actions: throws instead of redirecting. */
export async function assertVendorContext(allowedRoles?: readonly VendorMemberRole[]): Promise<VendorContext> {
  const current = await assertUser();
  const supabase = await createClient();
  const { data: membership, error } = await supabase
    .from("vendor_users")
    .select("vendor_id, role")
    .eq("profile_id", current.profile.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw fromPostgrestError(error);
  if (!membership) throw AppError.forbidden("You are not a member of a vendor.");
  if (allowedRoles && !allowedRoles.includes(membership.role)) {
    throw AppError.forbidden("Your vendor role does not allow this action.");
  }
  const { data: vendor, error: vendorError } = await supabase
    .from("vendors")
    .select("*")
    .eq("id", membership.vendor_id)
    .single();
  if (vendorError) throw fromPostgrestError(vendorError);
  return { ...current, vendor, memberRole: membership.role };
}

export function defaultDestination(profile: Pick<Profile, "role">): string {
  return homeForRole(profile.role);
}
