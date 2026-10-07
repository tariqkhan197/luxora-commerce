import type { Metadata } from "next";
import { FolderTree, Plus } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { CategoryDialog } from "@/features/admin/taxonomy/components/category-dialog";
import { CategoryTree } from "@/features/admin/taxonomy/components/category-tree";
import { getAdminCategories } from "@/features/admin/taxonomy/queries";
import { requireRole } from "@/lib/auth/dal";
import { getClientEnv } from "@/lib/env";
import { STORAGE_BUCKETS, storagePublicUrl } from "@/lib/storage";

export const metadata: Metadata = { title: "Categories" };

export default async function AdminCategoriesPage() {
  await requireRole(["admin", "super_admin"], ROUTES.admin.categories);
  const categories = await getAdminCategories();
  const supabaseUrl = getClientEnv().NEXT_PUBLIC_SUPABASE_URL;
  const imageUrls = Object.fromEntries(
    categories.map((category) => [
      category.id,
      storagePublicUrl(supabaseUrl, STORAGE_BUCKETS.catalogAssets, category.imagePath),
    ]),
  );
  const treeInput = categories.map(({ id, parentId, name }) => ({ id, parentId, name }));
  const newButton = (
    <Button>
      <Plus /> New category
    </Button>
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Catalog"
        title="Categories"
        description="The category tree shoppers browse and vendors file products under — up to three levels deep. A category commission rate applies to its products and subcategories unless the vendor has its own negotiated rate. Categories in use can be deactivated but not deleted."
        actions={<CategoryDialog categories={treeInput} trigger={newButton} />}
      />
      {categories.length > 0 ? (
        <CategoryTree categories={categories} imageUrls={imageUrls} />
      ) : (
        <EmptyState
          icon={<FolderTree />}
          title="No categories yet"
          description="Create the top-level departments first, then add categories and subcategories beneath them."
          action={<CategoryDialog categories={treeInput} trigger={newButton} />}
        />
      )}
    </div>
  );
}
