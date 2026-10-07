import { FolderPlus, Pencil } from "lucide-react";
import { ActionButton } from "@/components/shared/action-button";
import { StorageImage } from "@/components/shared/storage-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBasisPoints } from "@/lib/money";
import { STORAGE_BUCKETS } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { deleteCategory, setCategoryActive } from "../actions";
import type { AdminCategory } from "../queries";
import { buildCategoryTree, MAX_CATEGORY_DEPTH, type CategoryNode } from "../tree";
import { CategoryDialog } from "./category-dialog";

interface CategoryTreeProps {
  categories: AdminCategory[];
  imageUrls: Record<string, string | null>;
}

/** The admin category tree with per-row actions. */
export function CategoryTree({ categories, imageUrls }: CategoryTreeProps) {
  const tree = buildCategoryTree(categories);
  const treeInput = categories.map(({ id, parentId, name }) => ({ id, parentId, name }));
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {tree.map((node) => (
        <CategoryRow key={node.category.id} node={node} categories={treeInput} imageUrls={imageUrls} />
      ))}
    </ul>
  );
}

function CategoryRow({
  node,
  categories,
  imageUrls,
}: {
  node: CategoryNode<AdminCategory>;
  categories: { id: string; parentId: string | null; name: string }[];
  imageUrls: Record<string, string | null>;
}) {
  const { category, depth, children } = node;
  const inUse = category.productCount > 0 || children.length > 0;
  return (
    <>
      <li
        className={cn(
          "flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
          !category.isActive && "bg-surface-muted/50",
        )}
      >
        <div className="flex min-w-0 items-center gap-3" style={{ paddingLeft: `${depth * 1.5}rem` }}>
          <StorageImage
            bucket={STORAGE_BUCKETS.catalogAssets}
            path={category.imagePath}
            alt=""
            className="size-10 shrink-0 rounded-md"
            sizes="40px"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("font-medium", category.isActive ? "text-ink" : "text-ink-faint")}>
                {category.name}
              </span>
              {category.isActive ? null : <Badge variant="neutral">Inactive</Badge>}
              {category.commissionRateBps !== null ? (
                <Badge variant="accent">{formatBasisPoints(category.commissionRateBps)} commission</Badge>
              ) : null}
            </div>
            <p className="text-xs text-ink-faint">
              /{category.slug} · {category.productCount} product{category.productCount === 1 ? "" : "s"}
              {children.length ? ` · ${children.length} subcategor${children.length === 1 ? "y" : "ies"}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <CategoryDialog
            categories={categories}
            category={category}
            imageUrl={imageUrls[category.id] ?? null}
            trigger={
              <Button size="sm" variant="outline">
                <Pencil /> Edit
              </Button>
            }
          />
          {depth < MAX_CATEGORY_DEPTH - 1 ? (
            <CategoryDialog
              categories={categories}
              defaultParentId={category.id}
              trigger={
                <Button size="sm" variant="ghost">
                  <FolderPlus /> Add subcategory
                </Button>
              }
            />
          ) : null}
          <ActionButton
            size="sm"
            variant="ghost"
            confirmMessage={
              category.isActive && children.length
                ? `Deactivate "${category.name}" and all of its subcategories?`
                : undefined
            }
            action={setCategoryActive.bind(null, { id: category.id, active: !category.isActive })}
          >
            {category.isActive ? "Deactivate" : "Activate"}
          </ActionButton>
          {inUse ? null : (
            <ActionButton
              size="sm"
              variant="ghost"
              className="text-danger"
              confirmMessage={`Delete "${category.name}" permanently?`}
              action={deleteCategory.bind(null, category.id)}
            >
              Delete
            </ActionButton>
          )}
        </div>
      </li>
      {children.map((child) => (
        <CategoryRow key={child.category.id} node={child} categories={categories} imageUrls={imageUrls} />
      ))}
    </>
  );
}
