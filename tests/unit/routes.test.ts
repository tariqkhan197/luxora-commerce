import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { homeForRole, isProtectedPath, ROUTES, safeRedirectPath } from "@/config/routes";

describe("isProtectedPath", () => {
  it("protects account, vendor portal, admin and checkout", () => {
    expect(isProtectedPath("/account")).toBe(true);
    expect(isProtectedPath("/account/orders/123")).toBe(true);
    expect(isProtectedPath("/vendor/dashboard")).toBe(true);
    expect(isProtectedPath("/vendor/onboarding")).toBe(true);
    expect(isProtectedPath("/admin")).toBe(true);
    expect(isProtectedPath("/admin/vendors")).toBe(true);
    expect(isProtectedPath("/checkout")).toBe(true);
  });

  it("keeps the storefront and the vendor landing page public", () => {
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/shop")).toBe(false);
    expect(isProtectedPath("/vendor")).toBe(false);
    expect(isProtectedPath("/product/wool-coat")).toBe(false);
    expect(isProtectedPath("/accounting")).toBe(false);
    expect(isProtectedPath("/administrator")).toBe(false);
  });
});

describe("safeRedirectPath", () => {
  it("allows relative paths only", () => {
    expect(safeRedirectPath("/account/orders", "/")).toBe("/account/orders");
    expect(safeRedirectPath("https://evil.example", "/")).toBe("/");
    expect(safeRedirectPath("//evil.example", "/")).toBe("/");
    expect(safeRedirectPath("/\\evil.example", "/")).toBe("/");
    expect(safeRedirectPath(null, "/fallback")).toBe("/fallback");
    expect(safeRedirectPath("", "/fallback")).toBe("/fallback");
  });
});

describe("homeForRole", () => {
  it("routes each role to its home", () => {
    expect(homeForRole("customer")).toBe(ROUTES.account.root);
    expect(homeForRole("vendor")).toBe(ROUTES.vendor.dashboard);
    expect(homeForRole("admin")).toBe(ROUTES.admin.root);
    expect(homeForRole("super_admin")).toBe(ROUTES.admin.root);
  });
});

describe("ROUTES", () => {
  const appDir = path.resolve(__dirname, "../../src/app");

  /** Finds page.tsx / route.ts for a URL path, looking through (group) folders. */
  function hasRoute(dir: string, segments: string[]): boolean {
    if (segments.length === 0) {
      if (["page.tsx", "route.ts"].some((file) => existsSync(path.join(dir, file)))) return true;
    }
    const entries = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    for (const entry of entries) {
      if (entry.name.startsWith("(") && entry.name.endsWith(")") && hasRoute(path.join(dir, entry.name), segments)) {
        return true;
      }
      if (
        segments.length > 0 &&
        entry.name === segments[0] &&
        hasRoute(path.join(dir, entry.name), segments.slice(1))
      ) {
        return true;
      }
    }
    return false;
  }

  function staticPaths(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (value && typeof value === "object") return Object.values(value).flatMap(staticPaths);
    return [];
  }

  it("has a page or route handler for every static route", () => {
    const missing = staticPaths(ROUTES).filter((route) => !hasRoute(appDir, route.split("/").filter(Boolean)));
    expect(missing).toEqual([]);
  });

  it("includes the Release 4a pages", () => {
    expect(ROUTES.admin.shipping).toBe("/admin/shipping");
    expect(ROUTES.vendor.shipping).toBe("/vendor/shipping");
    expect(ROUTES.brands).toBe("/brands");
    expect(Object.values(ROUTES.legal)).toEqual([
      "/legal/terms",
      "/legal/privacy",
      "/legal/shipping",
      "/legal/returns",
      "/legal/vendor-terms",
    ]);
  });
});
