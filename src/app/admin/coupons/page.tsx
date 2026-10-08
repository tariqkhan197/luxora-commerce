import type { Metadata } from "next";
import { TicketPercent } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { ROUTES } from "@/config/routes";
import { CouponFormDialog } from "@/features/promotions/components/coupon-form-dialog";
import { CouponList } from "@/features/promotions/components/coupon-list";
import { couponRedemptions, listCoupons } from "@/features/promotions/queries";
import { requireRole } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Coupons" };

export default async function AdminCouponsPage() {
  await requireRole(["admin", "super_admin"], ROUTES.admin.coupons);
  const [platform, vendor] = await Promise.all([listCoupons({ scope: "platform" }), listCoupons({ scope: "vendor" })]);
  const redemptions = await couponRedemptions([...platform, ...vendor].map((coupon) => coupon.id));

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        eyebrow="Marketing"
        title="Coupons"
        description="Luxora codes are paid for by Luxora: vendor earnings and commission are unchanged and the cost is booked as a promotion cost when an order is paid. Vendors run their own codes; you can disable any code."
        actions={<CouponFormDialog scope="platform" />}
      />
      <section className="flex flex-col gap-4">
        <h2 className="display-3">Luxora codes</h2>
        {platform.length ? (
          <CouponList coupons={platform} redemptions={redemptions} viewer="admin" canManage />
        ) : (
          <EmptyState icon={<TicketPercent />} title="No Luxora codes" description="Create one with “New code”." />
        )}
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="display-3">Vendor codes</h2>
        {vendor.length ? (
          <CouponList coupons={vendor} redemptions={redemptions} viewer="admin" canManage={false} />
        ) : (
          <EmptyState
            icon={<TicketPercent />}
            title="No vendor codes"
            description="Codes vendors create appear here."
          />
        )}
      </section>
    </div>
  );
}
