import type { Metadata } from "next";
import Link from "next/link";
import { Pencil, Plus, Tags } from "lucide-react";
import { ActionButton } from "@/components/shared/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StorageImage } from "@/components/shared/storage-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROUTES } from "@/config/routes";
import { deleteBrand, setBrandActive } from "@/features/admin/taxonomy/actions";
import { BrandDialog } from "@/features/admin/taxonomy/components/brand-dialog";
import { getAdminBrands, getVendorOptions } from "@/features/admin/taxonomy/queries";
import { requireRole } from "@/lib/auth/dal";
import { getClientEnv } from "@/lib/env";
import { STORAGE_BUCKETS, storagePublicUrl } from "@/lib/storage";

export const metadata: Metadata = { title: "Brands" };

export default async function AdminBrandsPage() {
  await requireRole(["admin", "super_admin"], ROUTES.admin.brands);
  const [brands, vendors] = await Promise.all([getAdminBrands(), getVendorOptions()]);
  const supabaseUrl = getClientEnv().NEXT_PUBLIC_SUPABASE_URL;
  const newButton = (
    <Button>
      <Plus /> New brand
    </Button>
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Catalog"
        title="Brands"
        description="Each approved vendor gets a brand in their name automatically. Vendors can use their own brand and any brand without an owner. Brands in use can be deactivated but not deleted."
        actions={<BrandDialog vendors={vendors} trigger={newButton} />}
      />
      {brands.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Brand</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead className="text-right">Products</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {brands.map((brand) => (
              <TableRow key={brand.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <StorageImage
                      bucket={STORAGE_BUCKETS.catalogAssets}
                      path={brand.logoPath}
                      alt=""
                      className="size-10 shrink-0 rounded-md"
                      sizes="40px"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {brand.isActive ? (
                          <Link
                            href={ROUTES.brand(brand.slug)}
                            className="font-medium text-ink underline-offset-4 hover:underline"
                          >
                            {brand.name}
                          </Link>
                        ) : (
                          <span className="font-medium text-ink-faint">{brand.name}</span>
                        )}
                        {brand.isVerified ? <Badge variant="accent">Verified</Badge> : null}
                      </div>
                      <p className="text-xs text-ink-faint">/{brand.slug}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-ink-soft">{brand.ownerVendorName ?? "No owner"}</TableCell>
                <TableCell className="text-right tabular-nums">{brand.productCount}</TableCell>
                <TableCell>
                  <Badge variant={brand.isActive ? "success" : "neutral"}>
                    {brand.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-start justify-end gap-2">
                    <BrandDialog
                      vendors={vendors}
                      brand={brand}
                      logoUrl={storagePublicUrl(supabaseUrl, STORAGE_BUCKETS.catalogAssets, brand.logoPath)}
                      trigger={
                        <Button size="sm" variant="outline">
                          <Pencil /> Edit
                        </Button>
                      }
                    />
                    <ActionButton
                      size="sm"
                      variant="ghost"
                      action={setBrandActive.bind(null, { id: brand.id, active: !brand.isActive })}
                    >
                      {brand.isActive ? "Deactivate" : "Activate"}
                    </ActionButton>
                    {brand.productCount === 0 ? (
                      <ActionButton
                        size="sm"
                        variant="ghost"
                        className="text-danger"
                        confirmMessage={`Delete "${brand.name}" permanently?`}
                        action={deleteBrand.bind(null, brand.id)}
                      >
                        Delete
                      </ActionButton>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <EmptyState
          icon={<Tags />}
          title="No brands yet"
          description="Brands are created automatically when vendors are approved. You can also add brands without an owner for every vendor to use."
          action={<BrandDialog vendors={vendors} trigger={newButton} />}
        />
      )}
    </div>
  );
}
