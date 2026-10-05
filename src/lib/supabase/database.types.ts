/**
 * Database type definitions for the tables the application currently touches.
 *
 * This file follows the shape produced by `supabase gen types typescript` so it
 * can be replaced wholesale once the Supabase CLI is available in the
 * environment (`npm run db:types`). Keep it in sync with supabase/migrations.
 */

export type UserRole = "customer" | "vendor" | "admin" | "super_admin";
export type AccountStatus = "active" | "suspended" | "deactivated";
export type VendorStatus = "pending" | "approved" | "suspended" | "rejected" | "closed";
export type VendorMemberRole = "owner" | "manager" | "staff";
export type VendorApplicationStatus = "submitted" | "under_review" | "approved" | "rejected";

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          user_id: string;
          full_name: string | null;
          phone: string | null;
          avatar_url: string | null;
          role: UserRole;
          status: AccountStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: {
          full_name?: string | null;
          phone?: string | null;
          avatar_url?: string | null;
        };
        Relationships: [];
      };
      roles: {
        Row: {
          key: UserRole;
          name: string;
          description: string;
          permissions: Json;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      vendors: {
        Row: {
          id: string;
          slug: string;
          legal_name: string;
          display_name: string;
          contact_email: string;
          contact_phone: string | null;
          status: VendorStatus;
          commission_rate_bps: number | null;
          default_currency: string;
          tax_id: string | null;
          approved_at: string | null;
          approved_by: string | null;
          suspended_at: string | null;
          suspension_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          slug: string;
          legal_name: string;
          display_name: string;
          contact_email: string;
          contact_phone?: string | null;
          default_currency?: string;
        };
        Update: Partial<Database["public"]["Tables"]["vendors"]["Insert"]>;
        Relationships: [];
      };
      vendor_users: {
        Row: {
          id: string;
          vendor_id: string;
          profile_id: string;
          role: VendorMemberRole;
          created_at: string;
          updated_at: string;
        };
        Insert: { vendor_id: string; profile_id: string; role?: VendorMemberRole };
        Update: { role?: VendorMemberRole };
        Relationships: [];
      };
      vendor_applications: {
        Row: {
          id: string;
          profile_id: string;
          business_name: string;
          business_email: string;
          business_phone: string | null;
          website_url: string | null;
          description: string;
          product_categories: string[];
          documents: Json;
          status: VendorApplicationStatus;
          reviewed_by: string | null;
          reviewed_at: string | null;
          rejection_reason: string | null;
          vendor_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          business_name: string;
          business_email: string;
          business_phone?: string | null;
          website_url?: string | null;
          description: string;
          product_categories?: string[];
        };
        Update: Partial<Database["public"]["Tables"]["vendor_applications"]["Insert"]>;
        Relationships: [];
      };
      categories: {
        Row: {
          id: string;
          parent_id: string | null;
          slug: string;
          name: string;
          description: string | null;
          image_path: string | null;
          position: number;
          is_active: boolean;
          commission_rate_bps: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          parent_id?: string | null;
          slug: string;
          name: string;
          description?: string | null;
          image_path?: string | null;
          position?: number;
          is_active?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["categories"]["Insert"]>;
        Relationships: [];
      };
      brands: {
        Row: {
          id: string;
          slug: string;
          name: string;
          description: string | null;
          logo_path: string | null;
          website_url: string | null;
          owner_vendor_id: string | null;
          is_verified: boolean;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          slug: string;
          name: string;
          description?: string | null;
          logo_path?: string | null;
          website_url?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["brands"]["Insert"]>;
        Relationships: [];
      };
      stores: {
        Row: {
          id: string;
          vendor_id: string;
          slug: string;
          name: string;
          tagline: string | null;
          description: string | null;
          logo_path: string | null;
          cover_path: string | null;
          status: "draft" | "published" | "unpublished";
          return_policy: string | null;
          shipping_policy: string | null;
          social_links: Json;
          seo_title: string | null;
          seo_description: string | null;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: { vendor_id: string; slug: string; name: string; tagline?: string | null; description?: string | null };
        Update: Partial<Omit<Database["public"]["Tables"]["stores"]["Insert"], "vendor_id">>;
        Relationships: [];
      };
      collections: {
        Row: {
          id: string;
          slug: string;
          name: string;
          description: string | null;
          type: "manual" | "automatic";
          rules: Json;
          image_path: string | null;
          is_active: boolean;
          position: number;
          starts_at: string | null;
          ends_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: { slug: string; name: string; description?: string | null; type?: "manual" | "automatic" };
        Update: Partial<Database["public"]["Tables"]["collections"]["Insert"]>;
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          vendor_id: string;
          category_id: string | null;
          brand_id: string | null;
          slug: string;
          name: string;
          short_description: string | null;
          description: string | null;
          status: "draft" | "pending_review" | "active" | "rejected" | "archived";
          currency: string;
          attributes: Json;
          tags: string[];
          weight_grams: number | null;
          requires_shipping: boolean;
          seo_title: string | null;
          seo_description: string | null;
          approved_at: string | null;
          approved_by: string | null;
          rejection_reason: string | null;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          vendor_id: string;
          slug: string;
          name: string;
          category_id?: string | null;
          brand_id?: string | null;
        };
        Update: Partial<Omit<Database["public"]["Tables"]["products"]["Insert"], "vendor_id">>;
        Relationships: [];
      };
      subscription_plans: {
        Row: {
          id: string;
          slug: string;
          name: string;
          description: string | null;
          currency: string;
          price_minor: number;
          billing_interval: "monthly" | "yearly";
          commission_rate_bps: number | null;
          product_limit: number | null;
          features: Json;
          is_active: boolean;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          slug: string;
          name: string;
          description?: string | null;
          currency?: string;
          price_minor: number;
          billing_interval: "monthly" | "yearly";
          commission_rate_bps?: number | null;
          product_limit?: number | null;
          features?: Json;
          is_active?: boolean;
          position?: number;
        };
        Update: Partial<Database["public"]["Tables"]["subscription_plans"]["Insert"]>;
        Relationships: [];
      };
      platform_settings: {
        Row: {
          key: string;
          value: Json;
          description: string | null;
          is_public: boolean;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: { key: string; value: Json; description?: string | null; is_public?: boolean };
        Update: Partial<Database["public"]["Tables"]["platform_settings"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      current_profile_id: { Args: Record<string, never>; Returns: string | null };
      current_user_role: { Args: Record<string, never>; Returns: UserRole | null };
      is_admin: { Args: Record<string, never>; Returns: boolean };
      log_audit_event: {
        Args: {
          p_action: string;
          p_entity_type: string;
          p_entity_id?: string | null;
          p_metadata?: Json;
          p_ip_address?: string | null;
          p_user_agent?: string | null;
        };
        Returns: number;
      };
    };
    Enums: {
      user_role: UserRole;
      account_status: AccountStatus;
      vendor_status: VendorStatus;
      vendor_member_role: VendorMemberRole;
      vendor_application_status: VendorApplicationStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type Profile = Tables<"profiles">;
export type Vendor = Tables<"vendors">;
export type VendorUser = Tables<"vendor_users">;
export type VendorApplication = Tables<"vendor_applications">;
export type Category = Tables<"categories">;
export type Brand = Tables<"brands">;
export type Store = Tables<"stores">;
export type Collection = Tables<"collections">;
export type Product = Tables<"products">;
export type SubscriptionPlan = Tables<"subscription_plans">;
