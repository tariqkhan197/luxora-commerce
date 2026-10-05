import {
  BadgePercent,
  BarChart3,
  Building2,
  FileClock,
  FolderTree,
  Layers,
  LayoutDashboard,
  Megaphone,
  Package,
  Receipt,
  RotateCcw,
  Settings,
  ShoppingCart,
  Star,
  Tags,
  TicketPercent,
  Undo2,
  Users,
  Zap,
} from "lucide-react";
import { navItem, PortalShell } from "@/components/layout/portal-shell";
import { ROUTES } from "@/config/routes";
import { requireRole } from "@/lib/auth/dal";

const NAV = [
  { ...navItem("Overview", ROUTES.admin.root, LayoutDashboard), exact: true },
  navItem("Vendors", ROUTES.admin.vendors, Building2),
  navItem("Products", ROUTES.admin.products, Package),
  navItem("Orders", ROUTES.admin.orders, ShoppingCart),
  navItem("Customers", ROUTES.admin.customers, Users),
  navItem("Categories", ROUTES.admin.categories, FolderTree),
  navItem("Brands", ROUTES.admin.brands, Tags),
  navItem("Collections", ROUTES.admin.collections, Layers),
  navItem("Coupons", ROUTES.admin.coupons, TicketPercent),
  navItem("Flash sales", ROUTES.admin.flashSales, Zap),
  navItem("Commissions", ROUTES.admin.commissions, BadgePercent),
  navItem("Payouts", ROUTES.admin.payouts, Receipt),
  navItem("Refunds", ROUTES.admin.refunds, Undo2),
  navItem("Returns", ROUTES.admin.returns, RotateCcw),
  navItem("Reviews", ROUTES.admin.reviews, Star),
  navItem("Content", ROUTES.admin.content, Megaphone),
  navItem("Analytics", ROUTES.admin.analytics, BarChart3),
  navItem("Settings", ROUTES.admin.settings, Settings),
  navItem("Audit logs", ROUTES.admin.auditLogs, FileClock),
];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { profile } = await requireRole(["admin", "super_admin"], ROUTES.admin.root);
  return (
    <PortalShell
      title="Command center"
      subtitle={profile.full_name ?? undefined}
      items={NAV}
      footer={<p className="text-xs text-ink-soft capitalize">{profile.role.replace("_", " ")}</p>}
    >
      {children}
    </PortalShell>
  );
}
