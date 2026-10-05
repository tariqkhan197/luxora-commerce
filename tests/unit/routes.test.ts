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
