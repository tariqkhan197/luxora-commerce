import {
  BarChart3,
  Boxes,
  LayoutDashboard,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  Store,
  TicketPercent,
  Truck,
  Users,
} from "lucide-react";
import { navItem, PortalShell } from "@/components/layout/portal-shell";
import { Badge } from "@/components/ui/badge";
import { ROUTES } from "@/config/routes";
import { requireVendorContext } from "@/lib/auth/dal";

const VENDOR_STATUS_VARIANT = {
  pending: "warning",
  approved: "success",
  suspended: "danger",
  rejected: "danger",
  closed: "neutral",
} as const;

const NAV = [
  { ...navItem("Dashboard", ROUTES.vendor.dashboard, LayoutDashboard), exact: true },
  navItem("Products", ROUTES.vendor.products, Package),
  navItem("Orders", ROUTES.vendor.orders, ShoppingCart),
  navItem("Inventory", ROUTES.vendor.inventory, Boxes),
  navItem("Shipping", ROUTES.vendor.shipping, Truck),
  navItem("Customers", ROUTES.vendor.customers, Users),
  navItem("Analytics", ROUTES.vendor.analytics, BarChart3),
  navItem("Coupons", ROUTES.vendor.coupons, TicketPercent),
  navItem("Storefront", ROUTES.vendor.storefront, Store),
  navItem("Payouts", ROUTES.vendor.payouts, Receipt),
  navItem("Settings", ROUTES.vendor.settings, Settings),
];

export default async function VendorPortalLayout({ children }: LayoutProps<"/vendor">) {
  const { vendor, memberRole } = await requireVendorContext(ROUTES.vendor.dashboard);

  return (
    <PortalShell
      title="Vendor portal"
      subtitle={vendor.display_name}
      items={NAV}
      footer={
        <div className="flex items-center justify-between gap-2 text-xs text-ink-soft">
          <span className="capitalize">{memberRole}</span>
          <Badge variant={VENDOR_STATUS_VARIANT[vendor.status]}>{vendor.status}</Badge>
        </div>
      }
    >
      {children}
    </PortalShell>
  );
}
