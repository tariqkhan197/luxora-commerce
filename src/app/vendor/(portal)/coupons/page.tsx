import type { Metadata } from "next";
import { TicketPercent } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ROUTES } from "@/config/routes";
import { CouponFormDialog } from "@/features/promotions/components/coupon-form-dialog";
import { CouponList } from "@/features/promotions/components/coupon-list";
import { couponRedemptions, listCoupons } from "@/features/promotions/queries";
import { requireVendorContext } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Coupons" };

export default async function VendorCouponsPage() {
  const { vendor, memberRole } = await requireVendorContext(ROUTES.vendor.coupons);
  const canManage = memberRole === "owner" || memberRole === "manager";
  const coupons = await listCoupons({ vendorId: vendor.id });
  const redemptions = await couponRedemptions(coupons.map((coupon) => coupon.id));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Vendor portal"
        title="Coupons"
        description="Discount codes for your store. Your store pays for the discount and commission is charged on the discounted price. Codes apply only to your items that aren't on flash sale; customers can use one code per order."
        actions={canManage ? <CouponFormDialog scope="vendor" /> : null}
      />
      {!canManage ? (
        <Alert variant="info">
          <AlertTitle>Read-only</AlertTitle>
          <AlertDescription>Only owners and managers can create or change codes.</AlertDescription>
        </Alert>
      ) : null}
      {coupons.length ? (
        <CouponList coupons={coupons} redemptions={redemptions} viewer="vendor" canManage={canManage} />
      ) : (
        <EmptyState
          icon={<TicketPercent />}
          title="No codes yet"
          description="Create a code to offer a percentage or amount off your items."
        />
      )}
    </div>
  );
}
