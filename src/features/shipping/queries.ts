import "server-only";

import { fromPostgrestError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { VendorShippingRate } from "@/lib/supabase/database.types";

export interface ShippingZoneSummary {
  id: string;
  name: string;
  description: string | null;
  position: number;
  isActive: boolean;
  countries: string[];
  /** Vendors with an active rate for this zone (admin view only). */
  vendorCount: number;
  /** Any rate rows at all (active or not) — such a zone cannot be deleted. */
  hasRates: boolean;
}

/** All zones with their countries — admins see inactive zones too. */
export async function getShippingZones(): Promise<ShippingZoneSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shipping_zones")
    .select(
      "id, name, description, position, is_active, shipping_zone_countries(country_code), vendor_shipping_rates(is_active)",
    )
    .order("position")
    .order("name");
  if (error) throw fromPostgrestError(error);
  return (data ?? []).map((zone) => ({
    id: zone.id,
    name: zone.name,
    description: zone.description,
    position: zone.position,
    isActive: zone.is_active,
    countries: zone.shipping_zone_countries.map((country) => country.country_code).sort(),
    vendorCount: zone.vendor_shipping_rates.filter((rate) => rate.is_active).length,
    hasRates: zone.vendor_shipping_rates.length > 0,
  }));
}

export interface VendorShippingSetup {
  zones: ShippingZoneSummary[];
  rates: Map<string, VendorShippingRate>;
  /** True when at least one active rate exists in an active zone (publishing requires it). */
  canShip: boolean;
}

/** Active zones and the vendor's own rates (RLS scopes rates to the vendor's members). */
export async function getVendorShippingSetup(vendorId: string): Promise<VendorShippingSetup> {
  const supabase = await createClient();
  const [{ data: zones, error: zoneError }, { data: rates, error: rateError }] = await Promise.all([
    supabase
      .from("shipping_zones")
      .select("id, name, description, position, is_active, shipping_zone_countries(country_code)")
      .eq("is_active", true)
      .order("position")
      .order("name"),
    supabase.from("vendor_shipping_rates").select("*").eq("vendor_id", vendorId),
  ]);
  if (zoneError) throw fromPostgrestError(zoneError);
  if (rateError) throw fromPostgrestError(rateError);
  const rateMap = new Map((rates ?? []).map((rate) => [rate.zone_id, rate]));
  const zoneList = (zones ?? []).map((zone) => ({
    id: zone.id,
    name: zone.name,
    description: zone.description,
    position: zone.position,
    isActive: zone.is_active,
    countries: zone.shipping_zone_countries.map((country) => country.country_code).sort(),
    vendorCount: 0,
    hasRates: false,
  }));
  const canShip = zoneList.some((zone) => rateMap.get(zone.id)?.is_active);
  return { zones: zoneList, rates: rateMap, canShip };
}
