import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ROUTES } from "@/config/routes";
import { categoryOptions } from "@/features/catalog/category-options";
import { ProductDetailsForm } from "@/features/catalog/components/product-details-form";
import { getBrands, getCategories } from "@/features/catalog/queries";
import { requireVendorContext } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "New product" };

export default async function VendorNewProductPage() {
  const { vendor } = await requireVendorContext(ROUTES.vendor.newProduct);
  if (vendor.status !== "approved") redirect(ROUTES.vendor.products);
  const [categories, brands] = await Promise.all([getCategories(), getBrands()]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Catalog"
        title="New product"
        description="Start with the essentials. You'll add variants, pricing and images next."
      />
      <Card>
        <CardContent className="pt-6">
          <ProductDetailsForm
            product={null}
            categories={categoryOptions(categories)}
            brands={brands}
            defaultCurrency={vendor.default_currency}
          />
        </CardContent>
      </Card>
    </div>
  );
}
