import type { UserRole } from "@/lib/supabase/database.types";

/** Centralised route definitions. Use these instead of string literals. */
export const ROUTES = {
  home: "/",
  shop: "/shop",
  search: "/search",
  category: (slug: string) => `/category/${slug}`,
  product: (slug: string) => `/product/${slug}`,
  brand: (slug: string) => `/brand/${slug}`,
  brands: "/brands",
  store: (slug: string) => `/store/${slug}`,
  collection: (slug: string) => `/collection/${slug}`,
  cart: "/cart",
  checkout: "/checkout",
  checkoutSuccess: "/checkout/success",
  wishlist: "/wishlist",
  compare: "/compare",
  account: {
    root: "/account",
    orders: "/account/orders",
    order: (id: string) => `/account/orders/${id}`,
    addresses: "/account/addresses",
    returns: "/account/returns",
    reviews: "/account/reviews",
    rewards: "/account/rewards",
    notifications: "/account/notifications",
  },
  auth: {
    login: "/login",
    signup: "/signup",
    forgotPassword: "/forgot-password",
    resetPassword: "/reset-password",
    verifyEmail: "/verify-email",
    callback: "/auth/callback",
    confirm: "/auth/confirm",
    error: "/auth/error",
  },
  vendor: {
    root: "/vendor",
    onboarding: "/vendor/onboarding",
    dashboard: "/vendor/dashboard",
    products: "/vendor/products",
    newProduct: "/vendor/products/new",
    product: (id: string) => `/vendor/products/${id}`,
    orders: "/vendor/orders",
    order: (id: string) => `/vendor/orders/${id}`,
    returns: "/vendor/returns",
    reviews: "/vendor/reviews",
    inventory: "/vendor/inventory",
    shipping: "/vendor/shipping",
    customers: "/vendor/customers",
    analytics: "/vendor/analytics",
    coupons: "/vendor/coupons",
    storefront: "/vendor/storefront",
    payouts: "/vendor/payouts",
    settings: "/vendor/settings",
  },
  admin: {
    root: "/admin",
    vendors: "/admin/vendors",
    vendor: (id: string) => `/admin/vendors/${id}`,
    products: "/admin/products",
    orders: "/admin/orders",
    order: (id: string) => `/admin/orders/${id}`,
    customers: "/admin/customers",
    categories: "/admin/categories",
    brands: "/admin/brands",
    shipping: "/admin/shipping",
    collections: "/admin/collections",
    coupons: "/admin/coupons",
    flashSales: "/admin/flash-sales",
    commissions: "/admin/commissions",
    payouts: "/admin/payouts",
    refunds: "/admin/refunds",
    returns: "/admin/returns",
    reviews: "/admin/reviews",
    content: "/admin/content",
    analytics: "/admin/analytics",
    settings: "/admin/settings",
    auditLogs: "/admin/audit-logs",
  },
  legal: {
    terms: "/legal/terms",
    privacy: "/legal/privacy",
    shipping: "/legal/shipping",
    returns: "/legal/returns",
    vendorTerms: "/legal/vendor-terms",
  },
  forbidden: "/forbidden",
} as const;

/** Path prefixes that require a signed-in user (enforced in proxy + layouts). */
export const PROTECTED_PREFIXES = ["/account", "/vendor/", "/admin", "/checkout"] as const;

/** Exact paths under a protected prefix that remain public. */
export const PUBLIC_EXCEPTIONS = new Set<string>([ROUTES.vendor.root]);

/** Auth pages that signed-in users are redirected away from. */
export const AUTH_ONLY_PATHS = new Set<string>([ROUTES.auth.login, ROUTES.auth.signup, ROUTES.auth.forgotPassword]);

export function isProtectedPath(pathname: string): boolean {
  if (PUBLIC_EXCEPTIONS.has(pathname)) return false;
  return PROTECTED_PREFIXES.some((prefix) =>
    prefix.endsWith("/") ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Where a user lands after signing in, by role. */
export function homeForRole(role: UserRole): string {
  switch (role) {
    case "admin":
    case "super_admin":
      return ROUTES.admin.root;
    case "vendor":
      return ROUTES.vendor.dashboard;
    default:
      return ROUTES.account.root;
  }
}

/**
 * Validates a `next` redirect target so we only ever redirect to a relative
 * path on this site (prevents open redirects).
 */
export function safeRedirectPath(candidate: string | null | undefined, fallback: string): string {
  if (!candidate) return fallback;
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return fallback;
  return candidate;
}
