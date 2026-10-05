/**
 * Application-facing database types.
 *
 * `database.generated.ts` is produced by `npm run db:types` (Supabase CLI) from
 * the migrated schema — never edit it by hand. This module re-exports it and
 * adds the short aliases the application uses.
 */
import type { Database, Enums, Json, Tables } from "./database.generated";

export type { Database, Json, Tables, TablesInsert, TablesUpdate, Enums } from "./database.generated";

export type UserRole = Enums<"user_role">;
export type AccountStatus = Enums<"account_status">;
export type VendorStatus = Enums<"vendor_status">;
export type VendorMemberRole = Enums<"vendor_member_role">;
export type VendorApplicationStatus = Enums<"vendor_application_status">;
export type StoreStatus = Enums<"store_status">;
export type ProductStatus = Enums<"product_status">;
export type InventoryMovementType = Enums<"inventory_movement_type">;

export type Profile = Tables<"profiles">;
export type Vendor = Tables<"vendors">;
export type VendorUser = Tables<"vendor_users">;
export type VendorApplication = Tables<"vendor_applications">;
export type Store = Tables<"stores">;
export type Category = Tables<"categories">;
export type Brand = Tables<"brands">;
export type Collection = Tables<"collections">;
export type Product = Tables<"products">;
export type ProductVariant = Tables<"product_variants">;
export type ProductImage = Tables<"product_images">;
export type Inventory = Tables<"inventory">;
export type InventoryMovement = Tables<"inventory_movements">;
export type SubscriptionPlan = Tables<"subscription_plans">;

export type ProductListing = Database["public"]["Views"]["product_listings"]["Row"];
export type ProductVariantAvailability = Database["public"]["Views"]["product_variant_availability"]["Row"];

/** Type guard for jsonb columns that hold string→string option maps (variant options). */
export function asOptionRecord(value: Json | null | undefined): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") result[key] = entry;
  }
  return result;
}
