import type { Category } from "@/lib/supabase/database.types";

/** Pure helpers shared by server queries and unit tests (no server-only imports). */

/** Builds a prefix-matching tsquery: "wool co" → 'wool':* & 'co':* */
export function toPrefixTsQuery(input: string): string | null {
  const terms = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .slice(0, 8);
  if (terms.length === 0) return null;
  return terms.map((term) => `'${term.replace(/'/g, "")}':*`).join(" & ");
}

/** Returns the id of `category` plus all its descendants. */
export function categorySubtreeIds(categories: Category[], rootId: string): string[] {
  const byParent = new Map<string | null, Category[]>();
  for (const category of categories) {
    const list = byParent.get(category.parent_id) ?? [];
    list.push(category);
    byParent.set(category.parent_id, list);
  }
  const result: string[] = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    result.push(id);
    for (const child of byParent.get(id) ?? []) stack.push(child.id);
  }
  return result;
}
