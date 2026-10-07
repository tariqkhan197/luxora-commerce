/**
 * Pure helpers for the admin category tree. The database enforces the same
 * depth limit (`enforce_category_hierarchy`); these only shape the UI so that
 * invalid choices are never offered.
 */

/** Maximum category depth: department → category → subcategory. */
export const MAX_CATEGORY_DEPTH = 3;

export interface TreeCategory {
  id: string;
  parentId: string | null;
  name: string;
}

export interface CategoryNode<T extends TreeCategory> {
  category: T;
  depth: number;
  children: CategoryNode<T>[];
}

/** Builds the forest in input order. Orphans (parent not in the list) become roots. */
export function buildCategoryTree<T extends TreeCategory>(categories: readonly T[]): CategoryNode<T>[] {
  const ids = new Set(categories.map((category) => category.id));
  const byParent = new Map<string | null, T[]>();
  for (const category of categories) {
    const key = category.parentId && ids.has(category.parentId) ? category.parentId : null;
    const list = byParent.get(key) ?? [];
    list.push(category);
    byParent.set(key, list);
  }
  const visit = (parentId: string | null, depth: number, seen: Set<string>): CategoryNode<T>[] =>
    (byParent.get(parentId) ?? [])
      .filter((category) => !seen.has(category.id))
      .map((category) => {
        const next = new Set(seen).add(category.id);
        return { category, depth, children: visit(category.id, depth + 1, next) };
      });
  return visit(null, 0, new Set());
}

/** Depth-first flattening of a tree. */
export function flattenTree<T extends TreeCategory>(nodes: readonly CategoryNode<T>[]): CategoryNode<T>[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

/** Number of levels in a node's subtree, counting the node itself (leaf = 1). */
export function subtreeHeight<T extends TreeCategory>(node: CategoryNode<T>): number {
  return 1 + Math.max(0, ...node.children.map(subtreeHeight));
}

/**
 * Categories that `categoryId` (or a new category when null) may be placed
 * under without exceeding `MAX_CATEGORY_DEPTH` or creating a cycle.
 */
export function allowedParents<T extends TreeCategory>(
  categories: readonly T[],
  categoryId: string | null,
): { id: string; name: string; depth: number }[] {
  const flat = flattenTree(buildCategoryTree(categories));
  const self = categoryId ? flat.find((node) => node.category.id === categoryId) : undefined;
  const height = self ? subtreeHeight(self) : 1;
  const excluded = new Set(self ? flattenTree([self]).map((node) => node.category.id) : []);
  return flat
    .filter((node) => !excluded.has(node.category.id) && node.depth + 1 + height <= MAX_CATEGORY_DEPTH)
    .map((node) => ({ id: node.category.id, name: node.category.name, depth: node.depth }));
}
