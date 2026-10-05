export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      addresses: {
        Row: {
          city: string;
          country_code: string;
          created_at: string;
          full_name: string;
          id: string;
          is_default_billing: boolean;
          is_default_shipping: boolean;
          label: string | null;
          line1: string;
          line2: string | null;
          phone: string | null;
          postal_code: string;
          profile_id: string;
          state: string | null;
          type: Database["public"]["Enums"]["address_type"];
          updated_at: string;
        };
        Insert: {
          city: string;
          country_code: string;
          created_at?: string;
          full_name: string;
          id?: string;
          is_default_billing?: boolean;
          is_default_shipping?: boolean;
          label?: string | null;
          line1: string;
          line2?: string | null;
          phone?: string | null;
          postal_code: string;
          profile_id: string;
          state?: string | null;
          type?: Database["public"]["Enums"]["address_type"];
          updated_at?: string;
        };
        Update: {
          city?: string;
          country_code?: string;
          created_at?: string;
          full_name?: string;
          id?: string;
          is_default_billing?: boolean;
          is_default_shipping?: boolean;
          label?: string | null;
          line1?: string;
          line2?: string | null;
          phone?: string | null;
          postal_code?: string;
          profile_id?: string;
          state?: string | null;
          type?: Database["public"]["Enums"]["address_type"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "addresses_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      analytics_events: {
        Row: {
          event_name: string;
          id: number;
          occurred_at: string;
          path: string | null;
          product_id: string | null;
          profile_id: string | null;
          properties: NonNullable<Json>;
          referrer: string | null;
          session_id: string | null;
          vendor_id: string | null;
        };
        Insert: {
          event_name: string;
          id?: never;
          occurred_at?: string;
          path?: string | null;
          product_id?: string | null;
          profile_id?: string | null;
          properties?: NonNullable<Json>;
          referrer?: string | null;
          session_id?: string | null;
          vendor_id?: string | null;
        };
        Update: {
          event_name?: string;
          id?: never;
          occurred_at?: string;
          path?: string | null;
          product_id?: string | null;
          profile_id?: string | null;
          properties?: NonNullable<Json>;
          referrer?: string | null;
          session_id?: string | null;
          vendor_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "analytics_events_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product_listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "analytics_events_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "analytics_events_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "analytics_events_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_role: Database["public"]["Enums"]["user_role"] | null;
          created_at: string;
          entity_id: string | null;
          entity_type: string;
          id: number;
          ip_address: unknown;
          metadata: NonNullable<Json>;
          user_agent: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_role?: Database["public"]["Enums"]["user_role"] | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type: string;
          id?: never;
          ip_address?: unknown;
          metadata?: NonNullable<Json>;
          user_agent?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_role?: Database["public"]["Enums"]["user_role"] | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string;
          id?: never;
          ip_address?: unknown;
          metadata?: NonNullable<Json>;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      banners: {
        Row: {
          created_at: string;
          created_by: string | null;
          cta_label: string | null;
          ends_at: string | null;
          id: string;
          image_path: string;
          is_active: boolean;
          link_url: string | null;
          mobile_image_path: string | null;
          placement: string;
          position: number;
          starts_at: string | null;
          subtitle: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          cta_label?: string | null;
          ends_at?: string | null;
          id?: string;
          image_path: string;
          is_active?: boolean;
          link_url?: string | null;
          mobile_image_path?: string | null;
          placement: string;
          position?: number;
          starts_at?: string | null;
          subtitle?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          cta_label?: string | null;
          ends_at?: string | null;
          id?: string;
          image_path?: string;
          is_active?: boolean;
          link_url?: string | null;
          mobile_image_path?: string | null;
          placement?: string;
          position?: number;
          starts_at?: string | null;
          subtitle?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "banners_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      brands: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          is_active: boolean;
          is_verified: boolean;
          logo_path: string | null;
          name: string;
          owner_vendor_id: string | null;
          slug: string;
          updated_at: string;
          website_url: string | null;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          is_verified?: boolean;
          logo_path?: string | null;
          name: string;
          owner_vendor_id?: string | null;
          slug: string;
          updated_at?: string;
          website_url?: string | null;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          is_verified?: boolean;
          logo_path?: string | null;
          name?: string;
          owner_vendor_id?: string | null;
          slug?: string;
          updated_at?: string;
          website_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "brands_owner_vendor_id_fkey";
            columns: ["owner_vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      cart_items: {
        Row: {
          cart_id: string;
          created_at: string;
          id: string;
          quantity: number;
          unit_price_minor: number;
          updated_at: string;
          variant_id: string;
        };
        Insert: {
          cart_id: string;
          created_at?: string;
          id?: string;
          quantity: number;
          unit_price_minor: number;
          updated_at?: string;
          variant_id: string;
        };
        Update: {
          cart_id?: string;
          created_at?: string;
          id?: string;
          quantity?: number;
          unit_price_minor?: number;
          updated_at?: string;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cart_items_cart_id_fkey";
            columns: ["cart_id"];
            isOneToOne: false;
            referencedRelation: "carts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cart_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variant_availability";
            referencedColumns: ["variant_id"];
          },
          {
            foreignKeyName: "cart_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      carts: {
        Row: {
          created_at: string;
          currency: string;
          expires_at: string | null;
          guest_token: string | null;
          id: string;
          profile_id: string | null;
          status: Database["public"]["Enums"]["cart_status"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          currency?: string;
          expires_at?: string | null;
          guest_token?: string | null;
          id?: string;
          profile_id?: string | null;
          status?: Database["public"]["Enums"]["cart_status"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          currency?: string;
          expires_at?: string | null;
          guest_token?: string | null;
          id?: string;
          profile_id?: string | null;
          status?: Database["public"]["Enums"]["cart_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "carts_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      categories: {
        Row: {
          commission_rate_bps: number | null;
          created_at: string;
          description: string | null;
          id: string;
          image_path: string | null;
          is_active: boolean;
          name: string;
          parent_id: string | null;
          position: number;
          slug: string;
          updated_at: string;
        };
        Insert: {
          commission_rate_bps?: number | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_path?: string | null;
          is_active?: boolean;
          name: string;
          parent_id?: string | null;
          position?: number;
          slug: string;
          updated_at?: string;
        };
        Update: {
          commission_rate_bps?: number | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_path?: string | null;
          is_active?: boolean;
          name?: string;
          parent_id?: string | null;
          position?: number;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      collection_products: {
        Row: {
          collection_id: string;
          created_at: string;
          position: number;
          product_id: string;
        };
        Insert: {
          collection_id: string;
          created_at?: string;
          position?: number;
          product_id: string;
        };
        Update: {
          collection_id?: string;
          created_at?: string;
          position?: number;
          product_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "collection_products_collection_id_fkey";
            columns: ["collection_id"];
            isOneToOne: false;
            referencedRelation: "collections";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "collection_products_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product_listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "collection_products_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      collections: {
        Row: {
          created_at: string;
          description: string | null;
          ends_at: string | null;
          id: string;
          image_path: string | null;
          is_active: boolean;
          name: string;
          position: number;
          rules: NonNullable<Json>;
          slug: string;
          starts_at: string | null;
          type: Database["public"]["Enums"]["collection_type"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          ends_at?: string | null;
          id?: string;
          image_path?: string | null;
          is_active?: boolean;
          name: string;
          position?: number;
          rules?: NonNullable<Json>;
          slug: string;
          starts_at?: string | null;
          type?: Database["public"]["Enums"]["collection_type"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          ends_at?: string | null;
          id?: string;
          image_path?: string | null;
          is_active?: boolean;
          name?: string;
          position?: number;
          rules?: NonNullable<Json>;
          slug?: string;
          starts_at?: string | null;
          type?: Database["public"]["Enums"]["collection_type"];
          updated_at?: string;
        };
        Relationships: [];
      };
      commission_rules: {
        Row: {
          category_id: string | null;
          created_at: string;
          created_by: string | null;
          ends_at: string | null;
          id: string;
          is_active: boolean;
          name: string;
          rate_bps: number;
          scope: Database["public"]["Enums"]["commission_rule_scope"];
          starts_at: string;
          updated_at: string;
          vendor_id: string | null;
        };
        Insert: {
          category_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          ends_at?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          rate_bps: number;
          scope: Database["public"]["Enums"]["commission_rule_scope"];
          starts_at?: string;
          updated_at?: string;
          vendor_id?: string | null;
        };
        Update: {
          category_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          ends_at?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          rate_bps?: number;
          scope?: Database["public"]["Enums"]["commission_rule_scope"];
          starts_at?: string;
          updated_at?: string;
          vendor_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "commission_rules_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commission_rules_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commission_rules_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      commissions: {
        Row: {
          base_minor: number;
          commission_minor: number;
          created_at: string;
          currency: string;
          id: string;
          rate_bps: number;
          reversal_of: string | null;
          rule_id: string | null;
          settled_at: string | null;
          status: Database["public"]["Enums"]["commission_status"];
          updated_at: string;
          vendor_id: string;
          vendor_order_id: string;
        };
        Insert: {
          base_minor: number;
          commission_minor: number;
          created_at?: string;
          currency: string;
          id?: string;
          rate_bps: number;
          reversal_of?: string | null;
          rule_id?: string | null;
          settled_at?: string | null;
          status?: Database["public"]["Enums"]["commission_status"];
          updated_at?: string;
          vendor_id: string;
          vendor_order_id: string;
        };
        Update: {
          base_minor?: number;
          commission_minor?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          rate_bps?: number;
          reversal_of?: string | null;
          rule_id?: string | null;
          settled_at?: string | null;
          status?: Database["public"]["Enums"]["commission_status"];
          updated_at?: string;
          vendor_id?: string;
          vendor_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "commissions_reversal_of_fkey";
            columns: ["reversal_of"];
            isOneToOne: false;
            referencedRelation: "commissions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commissions_rule_id_fkey";
            columns: ["rule_id"];
            isOneToOne: false;
            referencedRelation: "commission_rules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commissions_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commissions_vendor_order_id_fkey";
            columns: ["vendor_order_id"];
            isOneToOne: false;
            referencedRelation: "vendor_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      content_sections: {
        Row: {
          body: NonNullable<Json>;
          created_at: string;
          ends_at: string | null;
          id: string;
          is_active: boolean;
          key: string;
          placement: string;
          position: number;
          starts_at: string | null;
          title: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          body?: NonNullable<Json>;
          created_at?: string;
          ends_at?: string | null;
          id?: string;
          is_active?: boolean;
          key: string;
          placement: string;
          position?: number;
          starts_at?: string | null;
          title?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          body?: NonNullable<Json>;
          created_at?: string;
          ends_at?: string | null;
          id?: string;
          is_active?: boolean;
          key?: string;
          placement?: string;
          position?: number;
          starts_at?: string | null;
          title?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "content_sections_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      coupon_usages: {
        Row: {
          coupon_id: string;
          created_at: string;
          customer_id: string;
          discount_minor: number;
          id: string;
          order_id: string;
        };
        Insert: {
          coupon_id: string;
          created_at?: string;
          customer_id: string;
          discount_minor: number;
          id?: string;
          order_id: string;
        };
        Update: {
          coupon_id?: string;
          created_at?: string;
          customer_id?: string;
          discount_minor?: number;
          id?: string;
          order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "coupon_usages_coupon_id_fkey";
            columns: ["coupon_id"];
            isOneToOne: false;
            referencedRelation: "coupons";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coupon_usages_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coupon_usages_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      coupons: {
        Row: {
          code: string;
          created_at: string;
          created_by: string | null;
          description: string | null;
          discount_type: Database["public"]["Enums"]["discount_type"];
          discount_value: number;
          ends_at: string | null;
          id: string;
          is_active: boolean;
          max_discount_minor: number | null;
          min_subtotal_minor: number;
          name: string;
          scope: Database["public"]["Enums"]["coupon_scope"];
          starts_at: string;
          updated_at: string;
          usage_limit: number | null;
          usage_limit_per_customer: number | null;
          used_count: number;
          vendor_id: string | null;
        };
        Insert: {
          code: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          discount_type: Database["public"]["Enums"]["discount_type"];
          discount_value: number;
          ends_at?: string | null;
          id?: string;
          is_active?: boolean;
          max_discount_minor?: number | null;
          min_subtotal_minor?: number;
          name: string;
          scope: Database["public"]["Enums"]["coupon_scope"];
          starts_at?: string;
          updated_at?: string;
          usage_limit?: number | null;
          usage_limit_per_customer?: number | null;
          used_count?: number;
          vendor_id?: string | null;
        };
        Update: {
          code?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          discount_type?: Database["public"]["Enums"]["discount_type"];
          discount_value?: number;
          ends_at?: string | null;
          id?: string;
          is_active?: boolean;
          max_discount_minor?: number | null;
          min_subtotal_minor?: number;
          name?: string;
          scope?: Database["public"]["Enums"]["coupon_scope"];
          starts_at?: string;
          updated_at?: string;
          usage_limit?: number | null;
          usage_limit_per_customer?: number | null;
          used_count?: number;
          vendor_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "coupons_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coupons_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      featured_brands: {
        Row: {
          brand_id: string;
          created_at: string;
          created_by: string | null;
          currency: string;
          ends_at: string | null;
          id: string;
          placement: string;
          position: number;
          price_paid_minor: number;
          starts_at: string;
          status: Database["public"]["Enums"]["placement_status"];
          updated_at: string;
          vendor_id: string | null;
        };
        Insert: {
          brand_id: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          ends_at?: string | null;
          id?: string;
          placement: string;
          position?: number;
          price_paid_minor?: number;
          starts_at?: string;
          status?: Database["public"]["Enums"]["placement_status"];
          updated_at?: string;
          vendor_id?: string | null;
        };
        Update: {
          brand_id?: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          ends_at?: string | null;
          id?: string;
          placement?: string;
          position?: number;
          price_paid_minor?: number;
          starts_at?: string;
          status?: Database["public"]["Enums"]["placement_status"];
          updated_at?: string;
          vendor_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "featured_brands_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "featured_brands_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "featured_brands_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      featured_products: {
        Row: {
          created_at: string;
          created_by: string | null;
          currency: string;
          ends_at: string | null;
          id: string;
          placement: string;
          position: number;
          price_paid_minor: number;
          product_id: string;
          starts_at: string;
          status: Database["public"]["Enums"]["placement_status"];
          updated_at: string;
          vendor_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          ends_at?: string | null;
          id?: string;
          placement: string;
          position?: number;
          price_paid_minor?: number;
          product_id: string;
          starts_at?: string;
          status?: Database["public"]["Enums"]["placement_status"];
          updated_at?: string;
          vendor_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          ends_at?: string | null;
          id?: string;
          placement?: string;
          position?: number;
          price_paid_minor?: number;
          product_id?: string;
          starts_at?: string;
          status?: Database["public"]["Enums"]["placement_status"];
          updated_at?: string;
          vendor_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "featured_products_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "featured_products_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product_listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "featured_products_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "featured_products_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      flash_sale_items: {
        Row: {
          created_at: string;
          flash_sale_id: string;
          id: string;
          quantity_limit: number | null;
          sale_price_minor: number;
          sold_count: number;
          variant_id: string;
        };
        Insert: {
          created_at?: string;
          flash_sale_id: string;
          id?: string;
          quantity_limit?: number | null;
          sale_price_minor: number;
          sold_count?: number;
          variant_id: string;
        };
        Update: {
          created_at?: string;
          flash_sale_id?: string;
          id?: string;
          quantity_limit?: number | null;
          sale_price_minor?: number;
          sold_count?: number;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "flash_sale_items_flash_sale_id_fkey";
            columns: ["flash_sale_id"];
            isOneToOne: false;
            referencedRelation: "flash_sales";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "flash_sale_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variant_availability";
            referencedColumns: ["variant_id"];
          },
          {
            foreignKeyName: "flash_sale_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      flash_sales: {
        Row: {
          created_at: string;
          created_by: string | null;
          description: string | null;
          ends_at: string;
          id: string;
          name: string;
          starts_at: string;
          status: Database["public"]["Enums"]["flash_sale_status"];
          updated_at: string;
          vendor_id: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          ends_at: string;
          id?: string;
          name: string;
          starts_at: string;
          status?: Database["public"]["Enums"]["flash_sale_status"];
          updated_at?: string;
          vendor_id?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          ends_at?: string;
          id?: string;
          name?: string;
          starts_at?: string;
          status?: Database["public"]["Enums"]["flash_sale_status"];
          updated_at?: string;
          vendor_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "flash_sales_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "flash_sales_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory: {
        Row: {
          allow_backorder: boolean;
          available_quantity: number | null;
          created_at: string;
          id: string;
          low_stock_threshold: number;
          reserved_quantity: number;
          stock_quantity: number;
          track_inventory: boolean;
          updated_at: string;
          variant_id: string;
          vendor_id: string;
        };
        Insert: {
          allow_backorder?: boolean;
          available_quantity?: never;
          created_at?: string;
          id?: string;
          low_stock_threshold?: number;
          reserved_quantity?: number;
          stock_quantity?: number;
          track_inventory?: boolean;
          updated_at?: string;
          variant_id: string;
          vendor_id: string;
        };
        Update: {
          allow_backorder?: boolean;
          available_quantity?: never;
          created_at?: string;
          id?: string;
          low_stock_threshold?: number;
          reserved_quantity?: number;
          stock_quantity?: number;
          track_inventory?: boolean;
          updated_at?: string;
          variant_id?: string;
          vendor_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: true;
            referencedRelation: "product_variant_availability";
            referencedColumns: ["variant_id"];
          },
          {
            foreignKeyName: "inventory_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: true;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_movements: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: number;
          inventory_id: string;
          quantity_after: number;
          quantity_delta: number;
          reason: string | null;
          reference_id: string | null;
          reference_type: string | null;
          type: Database["public"]["Enums"]["inventory_movement_type"];
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: never;
          inventory_id: string;
          quantity_after: number;
          quantity_delta: number;
          reason?: string | null;
          reference_id?: string | null;
          reference_type?: string | null;
          type: Database["public"]["Enums"]["inventory_movement_type"];
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: never;
          inventory_id?: string;
          quantity_after?: number;
          quantity_delta?: number;
          reason?: string | null;
          reference_id?: string | null;
          reference_type?: string | null;
          type?: Database["public"]["Enums"]["inventory_movement_type"];
        };
        Relationships: [
          {
            foreignKeyName: "inventory_movements_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_inventory_id_fkey";
            columns: ["inventory_id"];
            isOneToOne: false;
            referencedRelation: "inventory";
            referencedColumns: ["id"];
          },
        ];
      };
      loyalty_accounts: {
        Row: {
          created_at: string;
          id: string;
          lifetime_points: number;
          points_balance: number;
          profile_id: string;
          tier: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          lifetime_points?: number;
          points_balance?: number;
          profile_id: string;
          tier?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          lifetime_points?: number;
          points_balance?: number;
          profile_id?: string;
          tier?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "loyalty_accounts_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      loyalty_transactions: {
        Row: {
          account_id: string;
          balance_after: number;
          created_at: string;
          created_by: string | null;
          description: string | null;
          expires_at: string | null;
          id: number;
          order_id: string | null;
          points_delta: number;
          type: Database["public"]["Enums"]["loyalty_transaction_type"];
        };
        Insert: {
          account_id: string;
          balance_after: number;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          expires_at?: string | null;
          id?: never;
          order_id?: string | null;
          points_delta: number;
          type: Database["public"]["Enums"]["loyalty_transaction_type"];
        };
        Update: {
          account_id?: string;
          balance_after?: number;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          expires_at?: string | null;
          id?: never;
          order_id?: string | null;
          points_delta?: number;
          type?: Database["public"]["Enums"]["loyalty_transaction_type"];
        };
        Relationships: [
          {
            foreignKeyName: "loyalty_transactions_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "loyalty_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "loyalty_transactions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "loyalty_transactions_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          body: string | null;
          created_at: string;
          data: NonNullable<Json>;
          id: string;
          profile_id: string;
          read_at: string | null;
          title: string;
          type: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          data?: NonNullable<Json>;
          id?: string;
          profile_id: string;
          read_at?: string | null;
          title: string;
          type: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          data?: NonNullable<Json>;
          id?: string;
          profile_id?: string;
          read_at?: string | null;
          title?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          created_at: string;
          discount_minor: number;
          fulfilled_quantity: number;
          id: string;
          image_path: string | null;
          order_id: string;
          product_id: string | null;
          product_name: string;
          quantity: number;
          refunded_quantity: number;
          returned_quantity: number;
          sku: string;
          tax_minor: number;
          total_minor: number;
          unit_price_minor: number;
          updated_at: string;
          variant_id: string | null;
          variant_title: string;
          vendor_id: string;
          vendor_order_id: string;
        };
        Insert: {
          created_at?: string;
          discount_minor?: number;
          fulfilled_quantity?: number;
          id?: string;
          image_path?: string | null;
          order_id: string;
          product_id?: string | null;
          product_name: string;
          quantity: number;
          refunded_quantity?: number;
          returned_quantity?: number;
          sku: string;
          tax_minor?: number;
          total_minor: number;
          unit_price_minor: number;
          updated_at?: string;
          variant_id?: string | null;
          variant_title: string;
          vendor_id: string;
          vendor_order_id: string;
        };
        Update: {
          created_at?: string;
          discount_minor?: number;
          fulfilled_quantity?: number;
          id?: string;
          image_path?: string | null;
          order_id?: string;
          product_id?: string | null;
          product_name?: string;
          quantity?: number;
          refunded_quantity?: number;
          returned_quantity?: number;
          sku?: string;
          tax_minor?: number;
          total_minor?: number;
          unit_price_minor?: number;
          updated_at?: string;
          variant_id?: string | null;
          variant_title?: string;
          vendor_id?: string;
          vendor_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product_listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variant_availability";
            referencedColumns: ["variant_id"];
          },
          {
            foreignKeyName: "order_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_vendor_order_id_fkey";
            columns: ["vendor_order_id"];
            isOneToOne: false;
            referencedRelation: "vendor_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          billing_address: NonNullable<Json>;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          completed_at: string | null;
          confirmed_at: string | null;
          coupon_code: string | null;
          created_at: string;
          currency: string;
          customer_email: string;
          customer_id: string;
          customer_note: string | null;
          discount_minor: number;
          id: string;
          metadata: NonNullable<Json>;
          order_number: string;
          payment_status: Database["public"]["Enums"]["payment_status"];
          placed_at: string;
          shipping_address: NonNullable<Json>;
          shipping_minor: number;
          status: Database["public"]["Enums"]["order_status"];
          subtotal_minor: number;
          tax_minor: number;
          total_minor: number;
          updated_at: string;
        };
        Insert: {
          billing_address: NonNullable<Json>;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          completed_at?: string | null;
          confirmed_at?: string | null;
          coupon_code?: string | null;
          created_at?: string;
          currency: string;
          customer_email: string;
          customer_id: string;
          customer_note?: string | null;
          discount_minor?: number;
          id?: string;
          metadata?: NonNullable<Json>;
          order_number?: string;
          payment_status?: Database["public"]["Enums"]["payment_status"];
          placed_at?: string;
          shipping_address: NonNullable<Json>;
          shipping_minor?: number;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal_minor?: number;
          tax_minor?: number;
          total_minor?: number;
          updated_at?: string;
        };
        Update: {
          billing_address?: NonNullable<Json>;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          completed_at?: string | null;
          confirmed_at?: string | null;
          coupon_code?: string | null;
          created_at?: string;
          currency?: string;
          customer_email?: string;
          customer_id?: string;
          customer_note?: string | null;
          discount_minor?: number;
          id?: string;
          metadata?: NonNullable<Json>;
          order_number?: string;
          payment_status?: Database["public"]["Enums"]["payment_status"];
          placed_at?: string;
          shipping_address?: NonNullable<Json>;
          shipping_minor?: number;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal_minor?: number;
          tax_minor?: number;
          total_minor?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_transactions: {
        Row: {
          amount_minor: number;
          created_at: string;
          currency: string;
          id: number;
          payment_id: string;
          provider_transaction_id: string | null;
          raw_payload: Json | null;
          status: Database["public"]["Enums"]["payment_transaction_status"];
          type: Database["public"]["Enums"]["payment_transaction_type"];
        };
        Insert: {
          amount_minor: number;
          created_at?: string;
          currency: string;
          id?: never;
          payment_id: string;
          provider_transaction_id?: string | null;
          raw_payload?: Json | null;
          status?: Database["public"]["Enums"]["payment_transaction_status"];
          type: Database["public"]["Enums"]["payment_transaction_type"];
        };
        Update: {
          amount_minor?: number;
          created_at?: string;
          currency?: string;
          id?: never;
          payment_id?: string;
          provider_transaction_id?: string | null;
          raw_payload?: Json | null;
          status?: Database["public"]["Enums"]["payment_transaction_status"];
          type?: Database["public"]["Enums"]["payment_transaction_type"];
        };
        Relationships: [
          {
            foreignKeyName: "payment_transactions_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          amount_minor: number;
          authorized_at: string | null;
          captured_at: string | null;
          created_at: string;
          currency: string;
          failed_at: string | null;
          failure_code: string | null;
          failure_message: string | null;
          fee_minor: number;
          id: string;
          metadata: NonNullable<Json>;
          order_id: string;
          provider: Database["public"]["Enums"]["payment_provider"];
          provider_payment_id: string | null;
          refunded_minor: number;
          status: Database["public"]["Enums"]["payment_status"];
          updated_at: string;
        };
        Insert: {
          amount_minor: number;
          authorized_at?: string | null;
          captured_at?: string | null;
          created_at?: string;
          currency: string;
          failed_at?: string | null;
          failure_code?: string | null;
          failure_message?: string | null;
          fee_minor?: number;
          id?: string;
          metadata?: NonNullable<Json>;
          order_id: string;
          provider: Database["public"]["Enums"]["payment_provider"];
          provider_payment_id?: string | null;
          refunded_minor?: number;
          status?: Database["public"]["Enums"]["payment_status"];
          updated_at?: string;
        };
        Update: {
          amount_minor?: number;
          authorized_at?: string | null;
          captured_at?: string | null;
          created_at?: string;
          currency?: string;
          failed_at?: string | null;
          failure_code?: string | null;
          failure_message?: string | null;
          fee_minor?: number;
          id?: string;
          metadata?: NonNullable<Json>;
          order_id?: string;
          provider?: Database["public"]["Enums"]["payment_provider"];
          provider_payment_id?: string | null;
          refunded_minor?: number;
          status?: Database["public"]["Enums"]["payment_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      payout_items: {
        Row: {
          amount_minor: number;
          created_at: string;
          description: string | null;
          id: string;
          payout_id: string;
          refund_id: string | null;
          type: Database["public"]["Enums"]["payout_item_type"];
          vendor_order_id: string | null;
        };
        Insert: {
          amount_minor: number;
          created_at?: string;
          description?: string | null;
          id?: string;
          payout_id: string;
          refund_id?: string | null;
          type: Database["public"]["Enums"]["payout_item_type"];
          vendor_order_id?: string | null;
        };
        Update: {
          amount_minor?: number;
          created_at?: string;
          description?: string | null;
          id?: string;
          payout_id?: string;
          refund_id?: string | null;
          type?: Database["public"]["Enums"]["payout_item_type"];
          vendor_order_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payout_items_payout_id_fkey";
            columns: ["payout_id"];
            isOneToOne: false;
            referencedRelation: "payouts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payout_items_refund_id_fkey";
            columns: ["refund_id"];
            isOneToOne: false;
            referencedRelation: "refunds";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payout_items_vendor_order_id_fkey";
            columns: ["vendor_order_id"];
            isOneToOne: false;
            referencedRelation: "vendor_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      payouts: {
        Row: {
          adjustments_minor: number;
          commission_minor: number;
          created_at: string;
          currency: string;
          fees_minor: number;
          gross_minor: number;
          id: string;
          method: string | null;
          net_minor: number;
          notes: string | null;
          paid_at: string | null;
          period_end: string;
          period_start: string;
          processed_by: string | null;
          reference: string | null;
          refunds_minor: number;
          scheduled_for: string | null;
          status: Database["public"]["Enums"]["payout_status"];
          updated_at: string;
          vendor_id: string;
        };
        Insert: {
          adjustments_minor?: number;
          commission_minor?: number;
          created_at?: string;
          currency: string;
          fees_minor?: number;
          gross_minor?: number;
          id?: string;
          method?: string | null;
          net_minor?: number;
          notes?: string | null;
          paid_at?: string | null;
          period_end: string;
          period_start: string;
          processed_by?: string | null;
          reference?: string | null;
          refunds_minor?: number;
          scheduled_for?: string | null;
          status?: Database["public"]["Enums"]["payout_status"];
          updated_at?: string;
          vendor_id: string;
        };
        Update: {
          adjustments_minor?: number;
          commission_minor?: number;
          created_at?: string;
          currency?: string;
          fees_minor?: number;
          gross_minor?: number;
          id?: string;
          method?: string | null;
          net_minor?: number;
          notes?: string | null;
          paid_at?: string | null;
          period_end?: string;
          period_start?: string;
          processed_by?: string | null;
          reference?: string | null;
          refunds_minor?: number;
          scheduled_for?: string | null;
          status?: Database["public"]["Enums"]["payout_status"];
          updated_at?: string;
          vendor_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payouts_processed_by_fkey";
            columns: ["processed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payouts_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_settings: {
        Row: {
          created_at: string;
          description: string | null;
          is_public: boolean;
          key: string;
          updated_at: string;
          updated_by: string | null;
          value: NonNullable<Json>;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          is_public?: boolean;
          key: string;
          updated_at?: string;
          updated_by?: string | null;
          value: NonNullable<Json>;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          is_public?: boolean;
          key?: string;
          updated_at?: string;
          updated_by?: string | null;
          value?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: "platform_settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      product_images: {
        Row: {
          alt_text: string | null;
          created_at: string;
          id: string;
          is_primary: boolean;
          position: number;
          product_id: string;
          storage_path: string;
          variant_id: string | null;
        };
        Insert: {
          alt_text?: string | null;
          created_at?: string;
          id?: string;
          is_primary?: boolean;
          position?: number;
          product_id: string;
          storage_path: string;
          variant_id?: string | null;
        };
        Update: {
          alt_text?: string | null;
          created_at?: string;
          id?: string;
          is_primary?: boolean;
          position?: number;
          product_id?: string;
          storage_path?: string;
          variant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product_listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_images_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_images_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variant_availability";
            referencedColumns: ["variant_id"];
          },
          {
            foreignKeyName: "product_images_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      product_variants: {
        Row: {
          barcode: string | null;
          compare_at_price_minor: number | null;
          cost_minor: number | null;
          created_at: string;
          id: string;
          is_active: boolean;
          is_default: boolean;
          options: NonNullable<Json>;
          position: number;
          price_minor: number;
          product_id: string;
          sku: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          barcode?: string | null;
          compare_at_price_minor?: number | null;
          cost_minor?: number | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_default?: boolean;
          options?: NonNullable<Json>;
          position?: number;
          price_minor: number;
          product_id: string;
          sku: string;
          title?: string;
          updated_at?: string;
        };
        Update: {
          barcode?: string | null;
          compare_at_price_minor?: number | null;
          cost_minor?: number | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_default?: boolean;
          options?: NonNullable<Json>;
          position?: number;
          price_minor?: number;
          product_id?: string;
          sku?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product_listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_variants_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          attributes: NonNullable<Json>;
          brand_id: string | null;
          category_id: string | null;
          created_at: string;
          currency: string;
          description: string | null;
          id: string;
          name: string;
          published_at: string | null;
          rejection_reason: string | null;
          requires_shipping: boolean;
          search_vector: unknown;
          seo_description: string | null;
          seo_title: string | null;
          short_description: string | null;
          slug: string;
          status: Database["public"]["Enums"]["product_status"];
          tags: string[];
          updated_at: string;
          vendor_id: string;
          weight_grams: number | null;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          attributes?: NonNullable<Json>;
          brand_id?: string | null;
          category_id?: string | null;
          created_at?: string;
          currency?: string;
          description?: string | null;
          id?: string;
          name: string;
          published_at?: string | null;
          rejection_reason?: string | null;
          requires_shipping?: boolean;
          search_vector?: never;
          seo_description?: string | null;
          seo_title?: string | null;
          short_description?: string | null;
          slug: string;
          status?: Database["public"]["Enums"]["product_status"];
          tags?: string[];
          updated_at?: string;
          vendor_id: string;
          weight_grams?: number | null;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          attributes?: NonNullable<Json>;
          brand_id?: string | null;
          category_id?: string | null;
          created_at?: string;
          currency?: string;
          description?: string | null;
          id?: string;
          name?: string;
          published_at?: string | null;
          rejection_reason?: string | null;
          requires_shipping?: boolean;
          search_vector?: never;
          seo_description?: string | null;
          seo_title?: string | null;
          short_description?: string | null;
          slug?: string;
          status?: Database["public"]["Enums"]["product_status"];
          tags?: string[];
          updated_at?: string;
          vendor_id?: string;
          weight_grams?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "products_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          full_name: string | null;
          id: string;
          phone: string | null;
          role: Database["public"]["Enums"]["user_role"];
          status: Database["public"]["Enums"]["account_status"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id?: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          status?: Database["public"]["Enums"]["account_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id?: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          status?: Database["public"]["Enums"]["account_status"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_role_fkey";
            columns: ["role"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["key"];
          },
        ];
      };
      refunds: {
        Row: {
          amount_minor: number;
          approved_at: string | null;
          approved_by: string | null;
          commission_reversed_minor: number;
          created_at: string;
          currency: string;
          failure_message: string | null;
          id: string;
          order_id: string;
          payment_id: string;
          processed_at: string | null;
          provider_refund_id: string | null;
          reason: string;
          requested_by: string | null;
          return_id: string | null;
          status: Database["public"]["Enums"]["refund_status"];
          updated_at: string;
          vendor_debit_minor: number;
          vendor_order_id: string | null;
        };
        Insert: {
          amount_minor: number;
          approved_at?: string | null;
          approved_by?: string | null;
          commission_reversed_minor?: number;
          created_at?: string;
          currency: string;
          failure_message?: string | null;
          id?: string;
          order_id: string;
          payment_id: string;
          processed_at?: string | null;
          provider_refund_id?: string | null;
          reason: string;
          requested_by?: string | null;
          return_id?: string | null;
          status?: Database["public"]["Enums"]["refund_status"];
          updated_at?: string;
          vendor_debit_minor?: number;
          vendor_order_id?: string | null;
        };
        Update: {
          amount_minor?: number;
          approved_at?: string | null;
          approved_by?: string | null;
          commission_reversed_minor?: number;
          created_at?: string;
          currency?: string;
          failure_message?: string | null;
          id?: string;
          order_id?: string;
          payment_id?: string;
          processed_at?: string | null;
          provider_refund_id?: string | null;
          reason?: string;
          requested_by?: string | null;
          return_id?: string | null;
          status?: Database["public"]["Enums"]["refund_status"];
          updated_at?: string;
          vendor_debit_minor?: number;
          vendor_order_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "refunds_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refunds_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refunds_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refunds_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refunds_return_id_fkey";
            columns: ["return_id"];
            isOneToOne: false;
            referencedRelation: "returns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refunds_vendor_order_id_fkey";
            columns: ["vendor_order_id"];
            isOneToOne: false;
            referencedRelation: "vendor_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      returns: {
        Row: {
          created_at: string;
          customer_id: string;
          customer_images: NonNullable<Json>;
          id: string;
          inspection_notes: string | null;
          order_id: string;
          order_item_id: string;
          quantity: number;
          reason: string;
          received_at: string | null;
          rejection_reason: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database["public"]["Enums"]["return_status"];
          updated_at: string;
          vendor_id: string;
          vendor_order_id: string;
        };
        Insert: {
          created_at?: string;
          customer_id: string;
          customer_images?: NonNullable<Json>;
          id?: string;
          inspection_notes?: string | null;
          order_id: string;
          order_item_id: string;
          quantity: number;
          reason: string;
          received_at?: string | null;
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["return_status"];
          updated_at?: string;
          vendor_id: string;
          vendor_order_id: string;
        };
        Update: {
          created_at?: string;
          customer_id?: string;
          customer_images?: NonNullable<Json>;
          id?: string;
          inspection_notes?: string | null;
          order_id?: string;
          order_item_id?: string;
          quantity?: number;
          reason?: string;
          received_at?: string | null;
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["return_status"];
          updated_at?: string;
          vendor_id?: string;
          vendor_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "returns_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "returns_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "returns_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "returns_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "returns_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "returns_vendor_order_id_fkey";
            columns: ["vendor_order_id"];
            isOneToOne: false;
            referencedRelation: "vendor_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      review_images: {
        Row: {
          created_at: string;
          id: string;
          position: number;
          review_id: string;
          storage_path: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          position?: number;
          review_id: string;
          storage_path: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          position?: number;
          review_id?: string;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: "review_images_review_id_fkey";
            columns: ["review_id"];
            isOneToOne: false;
            referencedRelation: "reviews";
            referencedColumns: ["id"];
          },
        ];
      };
      reviews: {
        Row: {
          body: string;
          created_at: string;
          customer_id: string;
          helpful_count: number;
          id: string;
          moderated_at: string | null;
          moderated_by: string | null;
          order_item_id: string | null;
          product_id: string;
          rating: number;
          status: Database["public"]["Enums"]["review_status"];
          title: string | null;
          updated_at: string;
          vendor_replied_at: string | null;
          vendor_reply: string | null;
        };
        Insert: {
          body: string;
          created_at?: string;
          customer_id: string;
          helpful_count?: number;
          id?: string;
          moderated_at?: string | null;
          moderated_by?: string | null;
          order_item_id?: string | null;
          product_id: string;
          rating: number;
          status?: Database["public"]["Enums"]["review_status"];
          title?: string | null;
          updated_at?: string;
          vendor_replied_at?: string | null;
          vendor_reply?: string | null;
        };
        Update: {
          body?: string;
          created_at?: string;
          customer_id?: string;
          helpful_count?: number;
          id?: string;
          moderated_at?: string | null;
          moderated_by?: string | null;
          order_item_id?: string | null;
          product_id?: string;
          rating?: number;
          status?: Database["public"]["Enums"]["review_status"];
          title?: string | null;
          updated_at?: string;
          vendor_replied_at?: string | null;
          vendor_reply?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "reviews_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_moderated_by_fkey";
            columns: ["moderated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: true;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product_listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      roles: {
        Row: {
          created_at: string;
          description: string;
          key: Database["public"]["Enums"]["user_role"];
          name: string;
          permissions: NonNullable<Json>;
        };
        Insert: {
          created_at?: string;
          description: string;
          key: Database["public"]["Enums"]["user_role"];
          name: string;
          permissions?: NonNullable<Json>;
        };
        Update: {
          created_at?: string;
          description?: string;
          key?: Database["public"]["Enums"]["user_role"];
          name?: string;
          permissions?: NonNullable<Json>;
        };
        Relationships: [];
      };
      stores: {
        Row: {
          cover_path: string | null;
          created_at: string;
          description: string | null;
          id: string;
          logo_path: string | null;
          name: string;
          published_at: string | null;
          return_policy: string | null;
          seo_description: string | null;
          seo_title: string | null;
          shipping_policy: string | null;
          slug: string;
          social_links: NonNullable<Json>;
          status: Database["public"]["Enums"]["store_status"];
          tagline: string | null;
          updated_at: string;
          vendor_id: string;
        };
        Insert: {
          cover_path?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          logo_path?: string | null;
          name: string;
          published_at?: string | null;
          return_policy?: string | null;
          seo_description?: string | null;
          seo_title?: string | null;
          shipping_policy?: string | null;
          slug: string;
          social_links?: NonNullable<Json>;
          status?: Database["public"]["Enums"]["store_status"];
          tagline?: string | null;
          updated_at?: string;
          vendor_id: string;
        };
        Update: {
          cover_path?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          logo_path?: string | null;
          name?: string;
          published_at?: string | null;
          return_policy?: string | null;
          seo_description?: string | null;
          seo_title?: string | null;
          shipping_policy?: string | null;
          slug?: string;
          social_links?: NonNullable<Json>;
          status?: Database["public"]["Enums"]["store_status"];
          tagline?: string | null;
          updated_at?: string;
          vendor_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stores_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: true;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      subscription_plans: {
        Row: {
          billing_interval: Database["public"]["Enums"]["billing_interval"];
          commission_rate_bps: number | null;
          created_at: string;
          currency: string;
          description: string | null;
          features: NonNullable<Json>;
          id: string;
          is_active: boolean;
          name: string;
          position: number;
          price_minor: number;
          product_limit: number | null;
          slug: string;
          updated_at: string;
        };
        Insert: {
          billing_interval: Database["public"]["Enums"]["billing_interval"];
          commission_rate_bps?: number | null;
          created_at?: string;
          currency?: string;
          description?: string | null;
          features?: NonNullable<Json>;
          id?: string;
          is_active?: boolean;
          name: string;
          position?: number;
          price_minor: number;
          product_limit?: number | null;
          slug: string;
          updated_at?: string;
        };
        Update: {
          billing_interval?: Database["public"]["Enums"]["billing_interval"];
          commission_rate_bps?: number | null;
          created_at?: string;
          currency?: string;
          description?: string | null;
          features?: NonNullable<Json>;
          id?: string;
          is_active?: boolean;
          name?: string;
          position?: number;
          price_minor?: number;
          product_limit?: number | null;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      vendor_applications: {
        Row: {
          business_email: string;
          business_name: string;
          business_phone: string | null;
          created_at: string;
          description: string;
          documents: NonNullable<Json>;
          id: string;
          product_categories: string[];
          profile_id: string;
          rejection_reason: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database["public"]["Enums"]["vendor_application_status"];
          updated_at: string;
          vendor_id: string | null;
          website_url: string | null;
        };
        Insert: {
          business_email: string;
          business_name: string;
          business_phone?: string | null;
          created_at?: string;
          description: string;
          documents?: NonNullable<Json>;
          id?: string;
          product_categories?: string[];
          profile_id: string;
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["vendor_application_status"];
          updated_at?: string;
          vendor_id?: string | null;
          website_url?: string | null;
        };
        Update: {
          business_email?: string;
          business_name?: string;
          business_phone?: string | null;
          created_at?: string;
          description?: string;
          documents?: NonNullable<Json>;
          id?: string;
          product_categories?: string[];
          profile_id?: string;
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["vendor_application_status"];
          updated_at?: string;
          vendor_id?: string | null;
          website_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "vendor_applications_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vendor_applications_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vendor_applications_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      vendor_orders: {
        Row: {
          cancelled_at: string | null;
          carrier: string | null;
          commission_minor: number;
          commission_rate_bps: number;
          completed_at: string | null;
          created_at: string;
          currency: string;
          delivered_at: string | null;
          discount_minor: number;
          id: string;
          order_id: string;
          payment_fee_minor: number;
          shipped_at: string | null;
          shipping_minor: number;
          status: Database["public"]["Enums"]["vendor_order_status"];
          subtotal_minor: number;
          tax_minor: number;
          total_minor: number;
          tracking_number: string | null;
          tracking_url: string | null;
          updated_at: string;
          vendor_earnings_minor: number;
          vendor_id: string;
          vendor_note: string | null;
          vendor_order_number: string;
        };
        Insert: {
          cancelled_at?: string | null;
          carrier?: string | null;
          commission_minor?: number;
          commission_rate_bps: number;
          completed_at?: string | null;
          created_at?: string;
          currency: string;
          delivered_at?: string | null;
          discount_minor?: number;
          id?: string;
          order_id: string;
          payment_fee_minor?: number;
          shipped_at?: string | null;
          shipping_minor?: number;
          status?: Database["public"]["Enums"]["vendor_order_status"];
          subtotal_minor?: number;
          tax_minor?: number;
          total_minor?: number;
          tracking_number?: string | null;
          tracking_url?: string | null;
          updated_at?: string;
          vendor_earnings_minor?: number;
          vendor_id: string;
          vendor_note?: string | null;
          vendor_order_number: string;
        };
        Update: {
          cancelled_at?: string | null;
          carrier?: string | null;
          commission_minor?: number;
          commission_rate_bps?: number;
          completed_at?: string | null;
          created_at?: string;
          currency?: string;
          delivered_at?: string | null;
          discount_minor?: number;
          id?: string;
          order_id?: string;
          payment_fee_minor?: number;
          shipped_at?: string | null;
          shipping_minor?: number;
          status?: Database["public"]["Enums"]["vendor_order_status"];
          subtotal_minor?: number;
          tax_minor?: number;
          total_minor?: number;
          tracking_number?: string | null;
          tracking_url?: string | null;
          updated_at?: string;
          vendor_earnings_minor?: number;
          vendor_id?: string;
          vendor_note?: string | null;
          vendor_order_number?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vendor_orders_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vendor_orders_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      vendor_subscriptions: {
        Row: {
          cancel_at_period_end: boolean;
          cancelled_at: string | null;
          created_at: string;
          current_period_end: string;
          current_period_start: string;
          id: string;
          plan_id: string;
          provider: Database["public"]["Enums"]["payment_provider"] | null;
          provider_subscription_id: string | null;
          status: Database["public"]["Enums"]["subscription_status"];
          trial_ends_at: string | null;
          updated_at: string;
          vendor_id: string;
        };
        Insert: {
          cancel_at_period_end?: boolean;
          cancelled_at?: string | null;
          created_at?: string;
          current_period_end: string;
          current_period_start?: string;
          id?: string;
          plan_id: string;
          provider?: Database["public"]["Enums"]["payment_provider"] | null;
          provider_subscription_id?: string | null;
          status?: Database["public"]["Enums"]["subscription_status"];
          trial_ends_at?: string | null;
          updated_at?: string;
          vendor_id: string;
        };
        Update: {
          cancel_at_period_end?: boolean;
          cancelled_at?: string | null;
          created_at?: string;
          current_period_end?: string;
          current_period_start?: string;
          id?: string;
          plan_id?: string;
          provider?: Database["public"]["Enums"]["payment_provider"] | null;
          provider_subscription_id?: string | null;
          status?: Database["public"]["Enums"]["subscription_status"];
          trial_ends_at?: string | null;
          updated_at?: string;
          vendor_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vendor_subscriptions_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "subscription_plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vendor_subscriptions_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      vendor_users: {
        Row: {
          created_at: string;
          id: string;
          profile_id: string;
          role: Database["public"]["Enums"]["vendor_member_role"];
          updated_at: string;
          vendor_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          profile_id: string;
          role?: Database["public"]["Enums"]["vendor_member_role"];
          updated_at?: string;
          vendor_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          profile_id?: string;
          role?: Database["public"]["Enums"]["vendor_member_role"];
          updated_at?: string;
          vendor_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vendor_users_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vendor_users_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      vendors: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          commission_rate_bps: number | null;
          contact_email: string;
          contact_phone: string | null;
          created_at: string;
          default_currency: string;
          display_name: string;
          id: string;
          legal_name: string;
          slug: string;
          status: Database["public"]["Enums"]["vendor_status"];
          suspended_at: string | null;
          suspension_reason: string | null;
          tax_id: string | null;
          updated_at: string;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          commission_rate_bps?: number | null;
          contact_email: string;
          contact_phone?: string | null;
          created_at?: string;
          default_currency?: string;
          display_name: string;
          id?: string;
          legal_name: string;
          slug: string;
          status?: Database["public"]["Enums"]["vendor_status"];
          suspended_at?: string | null;
          suspension_reason?: string | null;
          tax_id?: string | null;
          updated_at?: string;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          commission_rate_bps?: number | null;
          contact_email?: string;
          contact_phone?: string | null;
          created_at?: string;
          default_currency?: string;
          display_name?: string;
          id?: string;
          legal_name?: string;
          slug?: string;
          status?: Database["public"]["Enums"]["vendor_status"];
          suspended_at?: string | null;
          suspension_reason?: string | null;
          tax_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vendors_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      wishlist_items: {
        Row: {
          created_at: string;
          id: string;
          product_id: string;
          variant_id: string | null;
          wishlist_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          product_id: string;
          variant_id?: string | null;
          wishlist_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          product_id?: string;
          variant_id?: string | null;
          wishlist_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wishlist_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product_listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wishlist_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wishlist_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variant_availability";
            referencedColumns: ["variant_id"];
          },
          {
            foreignKeyName: "wishlist_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wishlist_items_wishlist_id_fkey";
            columns: ["wishlist_id"];
            isOneToOne: false;
            referencedRelation: "wishlists";
            referencedColumns: ["id"];
          },
        ];
      };
      wishlists: {
        Row: {
          created_at: string;
          id: string;
          is_default: boolean;
          is_public: boolean;
          name: string;
          profile_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_default?: boolean;
          is_public?: boolean;
          name?: string;
          profile_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_default?: boolean;
          is_public?: boolean;
          name?: string;
          profile_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wishlists_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      product_listings: {
        Row: {
          brand_id: string | null;
          brand_name: string | null;
          brand_slug: string | null;
          category_id: string | null;
          category_name: string | null;
          category_slug: string | null;
          compare_at_price_minor: number | null;
          created_at: string | null;
          currency: string | null;
          id: string | null;
          in_stock: boolean | null;
          max_price_minor: number | null;
          min_price_minor: number | null;
          name: string | null;
          primary_image_alt: string | null;
          primary_image_path: string | null;
          published_at: string | null;
          search_vector: unknown;
          short_description: string | null;
          slug: string | null;
          store_name: string | null;
          store_slug: string | null;
          tags: string[] | null;
          vendor_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      product_variant_availability: {
        Row: {
          compare_at_price_minor: number | null;
          in_stock: boolean | null;
          is_default: boolean | null;
          is_low_stock: boolean | null;
          options: Json | null;
          position: number | null;
          price_minor: number | null;
          product_id: string | null;
          sku: string | null;
          title: string | null;
          variant_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product_listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_variants_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      adjust_inventory: {
        Args: {
          p_quantity_delta: number;
          p_reason?: string;
          p_reference_id?: string;
          p_reference_type?: string;
          p_type: Database["public"]["Enums"]["inventory_movement_type"];
          p_variant_id: string;
        };
        Returns: {
          allow_backorder: boolean;
          available_quantity: number | null;
          created_at: string;
          id: string;
          low_stock_threshold: number;
          reserved_quantity: number;
          stock_quantity: number;
          track_inventory: boolean;
          updated_at: string;
          variant_id: string;
          vendor_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "inventory";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      approve_vendor_application: {
        Args: { p_application_id: string; p_commission_rate_bps?: number; p_slug: string };
        Returns: string;
      };
      calculate_commission_minor: { Args: { p_base_minor: number; p_rate_bps: number }; Returns: number };
      cart_owner_profile_id: { Args: { p_cart_id: string }; Returns: string };
      commit_reserved_inventory: {
        Args: { p_quantity: number; p_reference_id: string; p_variant_id: string };
        Returns: {
          allow_backorder: boolean;
          available_quantity: number | null;
          created_at: string;
          id: string;
          low_stock_threshold: number;
          reserved_quantity: number;
          stock_quantity: number;
          track_inventory: boolean;
          updated_at: string;
          variant_id: string;
          vendor_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "inventory";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      current_account_status: {
        Args: Record<PropertyKey, never>;
        Returns: Database["public"]["Enums"]["account_status"];
      };
      current_profile_id: { Args: Record<PropertyKey, never>; Returns: string };
      current_user_role: { Args: Record<PropertyKey, never>; Returns: Database["public"]["Enums"]["user_role"] };
      current_vendor_ids: { Args: Record<PropertyKey, never>; Returns: string[] };
      flash_sale_is_live: { Args: { p_flash_sale_id: string }; Returns: boolean };
      flash_sale_vendor_id: { Args: { p_flash_sale_id: string }; Returns: string };
      generate_order_number: { Args: Record<PropertyKey, never>; Returns: string };
      has_vendor_role: {
        Args: { p_roles: Database["public"]["Enums"]["vendor_member_role"][]; p_vendor_id: string };
        Returns: boolean;
      };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_privileged_session: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_super_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_vendor_member: { Args: { p_vendor_id: string }; Returns: boolean };
      log_audit_event: {
        Args: {
          p_action: string;
          p_entity_id?: string;
          p_entity_type: string;
          p_ip_address?: unknown;
          p_metadata?: Json;
          p_user_agent?: string;
        };
        Returns: number;
      };
      loyalty_account_profile_id: { Args: { p_account_id: string }; Returns: string };
      moderate_product: {
        Args: { p_approve: boolean; p_product_id: string; p_reason?: string };
        Returns: {
          approved_at: string | null;
          approved_by: string | null;
          attributes: NonNullable<Json>;
          brand_id: string | null;
          category_id: string | null;
          created_at: string;
          currency: string;
          description: string | null;
          id: string;
          name: string;
          published_at: string | null;
          rejection_reason: string | null;
          requires_shipping: boolean;
          search_vector: unknown;
          seo_description: string | null;
          seo_title: string | null;
          short_description: string | null;
          slug: string;
          status: Database["public"]["Enums"]["product_status"];
          tags: string[];
          updated_at: string;
          vendor_id: string;
          weight_grams: number | null;
        };
        SetofOptions: {
          from: "*";
          to: "products";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      order_customer_id: { Args: { p_order_id: string }; Returns: string };
      payout_vendor_id: { Args: { p_payout_id: string }; Returns: string };
      product_is_public: { Args: { p_product_id: string }; Returns: boolean };
      product_search_text: {
        Args: { p_description: string; p_name: string; p_short_description: string; p_tags: string[] };
        Returns: string;
      };
      product_vendor_id: { Args: { p_product_id: string }; Returns: string };
      reject_vendor_application: { Args: { p_application_id: string; p_reason: string }; Returns: undefined };
      release_inventory: {
        Args: { p_quantity: number; p_variant_id: string };
        Returns: {
          allow_backorder: boolean;
          available_quantity: number | null;
          created_at: string;
          id: string;
          low_stock_threshold: number;
          reserved_quantity: number;
          stock_quantity: number;
          track_inventory: boolean;
          updated_at: string;
          variant_id: string;
          vendor_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "inventory";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      reserve_inventory: {
        Args: { p_quantity: number; p_variant_id: string };
        Returns: {
          allow_backorder: boolean;
          available_quantity: number | null;
          created_at: string;
          id: string;
          low_stock_threshold: number;
          reserved_quantity: number;
          stock_quantity: number;
          track_inventory: boolean;
          updated_at: string;
          variant_id: string;
          vendor_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "inventory";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      resolve_commission_rate_bps: { Args: { p_category_id?: string; p_vendor_id: string }; Returns: number };
      review_customer_id: { Args: { p_review_id: string }; Returns: string };
      review_is_public: { Args: { p_review_id: string }; Returns: boolean };
      set_vendor_status: {
        Args: { p_reason?: string; p_status: Database["public"]["Enums"]["vendor_status"]; p_vendor_id: string };
        Returns: {
          approved_at: string | null;
          approved_by: string | null;
          commission_rate_bps: number | null;
          contact_email: string;
          contact_phone: string | null;
          created_at: string;
          default_currency: string;
          display_name: string;
          id: string;
          legal_name: string;
          slug: string;
          status: Database["public"]["Enums"]["vendor_status"];
          suspended_at: string | null;
          suspension_reason: string | null;
          tax_id: string | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "vendors";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      storage_owner_segment: { Args: { p_name: string }; Returns: string };
      unpublish_product: {
        Args: { p_product_id: string };
        Returns: {
          approved_at: string | null;
          approved_by: string | null;
          attributes: NonNullable<Json>;
          brand_id: string | null;
          category_id: string | null;
          created_at: string;
          currency: string;
          description: string | null;
          id: string;
          name: string;
          published_at: string | null;
          rejection_reason: string | null;
          requires_shipping: boolean;
          search_vector: unknown;
          seo_description: string | null;
          seo_title: string | null;
          short_description: string | null;
          slug: string;
          status: Database["public"]["Enums"]["product_status"];
          tags: string[];
          updated_at: string;
          vendor_id: string;
          weight_grams: number | null;
        };
        SetofOptions: {
          from: "*";
          to: "products";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      vendor_order_vendor_id: { Args: { p_vendor_order_id: string }; Returns: string };
      wishlist_is_public: { Args: { p_wishlist_id: string }; Returns: boolean };
      wishlist_owner_profile_id: { Args: { p_wishlist_id: string }; Returns: string };
    };
    Enums: {
      account_status: "active" | "suspended" | "deactivated";
      address_type: "shipping" | "billing" | "both";
      billing_interval: "monthly" | "yearly";
      cart_status: "active" | "converted" | "abandoned";
      collection_type: "manual" | "automatic";
      commission_rule_scope: "global" | "vendor" | "category";
      commission_status: "pending" | "settled" | "reversed";
      coupon_scope: "platform" | "vendor";
      discount_type: "percentage" | "fixed_amount" | "free_shipping";
      flash_sale_status: "scheduled" | "active" | "ended" | "cancelled";
      inventory_movement_type:
        "purchase" | "sale" | "return" | "cancellation" | "manual_adjustment" | "damaged" | "restock";
      loyalty_transaction_type: "earn" | "redeem" | "expire" | "adjust";
      order_status:
        | "pending"
        | "confirmed"
        | "processing"
        | "partially_fulfilled"
        | "fulfilled"
        | "completed"
        | "cancelled"
        | "refunded";
      payment_provider: "stripe" | "paypal" | "cash_on_delivery" | "manual";
      payment_status: "pending" | "authorized" | "paid" | "partially_refunded" | "refunded" | "failed" | "cancelled";
      payment_transaction_status: "pending" | "succeeded" | "failed";
      payment_transaction_type: "authorization" | "capture" | "refund" | "fee" | "adjustment";
      payout_item_type: "vendor_order_earnings" | "refund_debit" | "adjustment";
      payout_status: "pending" | "scheduled" | "processing" | "paid" | "failed" | "cancelled";
      placement_status: "scheduled" | "active" | "ended" | "cancelled";
      product_status: "draft" | "pending_review" | "active" | "rejected" | "archived";
      refund_status: "requested" | "approved" | "rejected" | "processing" | "completed" | "failed";
      return_status:
        "requested" | "approved" | "rejected" | "in_transit" | "received" | "inspected" | "completed" | "cancelled";
      review_status: "pending" | "approved" | "rejected";
      store_status: "draft" | "published" | "unpublished";
      subscription_status: "trialing" | "active" | "past_due" | "cancelled" | "expired";
      user_role: "customer" | "vendor" | "admin" | "super_admin";
      vendor_application_status: "submitted" | "under_review" | "approved" | "rejected";
      vendor_member_role: "owner" | "manager" | "staff";
      vendor_order_status:
        "pending" | "confirmed" | "processing" | "shipped" | "delivered" | "completed" | "cancelled" | "refunded";
      vendor_status: "pending" | "approved" | "suspended" | "rejected" | "closed";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      account_status: ["active", "suspended", "deactivated"],
      address_type: ["shipping", "billing", "both"],
      billing_interval: ["monthly", "yearly"],
      cart_status: ["active", "converted", "abandoned"],
      collection_type: ["manual", "automatic"],
      commission_rule_scope: ["global", "vendor", "category"],
      commission_status: ["pending", "settled", "reversed"],
      coupon_scope: ["platform", "vendor"],
      discount_type: ["percentage", "fixed_amount", "free_shipping"],
      flash_sale_status: ["scheduled", "active", "ended", "cancelled"],
      inventory_movement_type: [
        "purchase",
        "sale",
        "return",
        "cancellation",
        "manual_adjustment",
        "damaged",
        "restock",
      ],
      loyalty_transaction_type: ["earn", "redeem", "expire", "adjust"],
      order_status: [
        "pending",
        "confirmed",
        "processing",
        "partially_fulfilled",
        "fulfilled",
        "completed",
        "cancelled",
        "refunded",
      ],
      payment_provider: ["stripe", "paypal", "cash_on_delivery", "manual"],
      payment_status: ["pending", "authorized", "paid", "partially_refunded", "refunded", "failed", "cancelled"],
      payment_transaction_status: ["pending", "succeeded", "failed"],
      payment_transaction_type: ["authorization", "capture", "refund", "fee", "adjustment"],
      payout_item_type: ["vendor_order_earnings", "refund_debit", "adjustment"],
      payout_status: ["pending", "scheduled", "processing", "paid", "failed", "cancelled"],
      placement_status: ["scheduled", "active", "ended", "cancelled"],
      product_status: ["draft", "pending_review", "active", "rejected", "archived"],
      refund_status: ["requested", "approved", "rejected", "processing", "completed", "failed"],
      return_status: [
        "requested",
        "approved",
        "rejected",
        "in_transit",
        "received",
        "inspected",
        "completed",
        "cancelled",
      ],
      review_status: ["pending", "approved", "rejected"],
      store_status: ["draft", "published", "unpublished"],
      subscription_status: ["trialing", "active", "past_due", "cancelled", "expired"],
      user_role: ["customer", "vendor", "admin", "super_admin"],
      vendor_application_status: ["submitted", "under_review", "approved", "rejected"],
      vendor_member_role: ["owner", "manager", "staff"],
      vendor_order_status: [
        "pending",
        "confirmed",
        "processing",
        "shipped",
        "delivered",
        "completed",
        "cancelled",
        "refunded",
      ],
      vendor_status: ["pending", "approved", "suspended", "rejected", "closed"],
    },
  },
} as const;
