import type { Metadata } from "next";
import { Zap } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { ROUTES } from "@/config/routes";
import { FlashSaleList } from "@/features/promotions/components/flash-sale-list";
import { listFlashSales } from "@/features/promotions/queries";
import { requireRole } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Flash sales" };

export default async function AdminFlashSalesPage() {
  await requireRole(["admin", "super_admin"], ROUTES.admin.flashSales);
  const sales = await listFlashSales();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Marketing"
        title="Flash sales"
        description="Vendors run their own flash sales and pay for them. Luxora does not change vendor prices; you can disable a sale, which ends it at once (orders already placed keep their price)."
      />
      {sales.length ? (
        <FlashSaleList sales={sales} viewer="admin" />
      ) : (
        <EmptyState icon={<Zap />} title="No flash sales" description="Sales vendors create appear here." />
      )}
    </div>
  );
}
