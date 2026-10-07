import type { Category } from "@/lib/supabase/database.types";

/** Flattens the category tree into indented select options (depth-first). */
export function categoryOptions(
  categories: Pick<Category, "id" | "parent_id" | "name">[],
): { id: string; name: string; depth: number }[] {
  const byParent = new Map<string | null, Pick<Category, "id" | "parent_id" | "name">[]>();
  for (const category of categories) {
    const list = byParent.get(category.parent_id) ?? [];
    list.push(category);
    byParent.set(category.parent_id, list);
  }
  const result: { id: string; name: string; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const category of byParent.get(parentId) ?? []) {
      result.push({ id: category.id, name: category.name, depth });
      if (depth < 6) walk(category.id, depth + 1);
    }
  };
  walk(null, 0);
  return result;
}
