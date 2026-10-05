import { describe, expect, it } from "vitest";
import { categorySubtreeIds, toPrefixTsQuery } from "@/features/catalog/helpers";
import type { Category } from "@/lib/supabase/database.types";

describe("toPrefixTsQuery", () => {
  it("builds prefix queries and strips unsafe characters", () => {
    expect(toPrefixTsQuery("Wool co")).toBe("'wool':* & 'co':*");
    expect(toPrefixTsQuery("  o'neil  & (coat)  ")).toBe("'o':* & 'neil':* & 'coat':*");
    expect(toPrefixTsQuery("   ")).toBeNull();
  });
});

describe("categorySubtreeIds", () => {
  const category = (id: string, parent_id: string | null): Category =>
    ({
      id,
      parent_id,
      slug: id,
      name: id,
      description: null,
      image_path: null,
      position: 0,
      is_active: true,
      commission_rate_bps: null,
      created_at: "",
      updated_at: "",
    }) as Category;

  it("returns the root and every descendant", () => {
    const tree = [
      category("women", null),
      category("coats", "women"),
      category("parkas", "coats"),
      category("men", null),
    ];
    expect(categorySubtreeIds(tree, "women").sort()).toEqual(["coats", "parkas", "women"]);
    expect(categorySubtreeIds(tree, "men")).toEqual(["men"]);
  });
});
