import { countryName } from "@/lib/countries";

/** Works for both `addresses` rows and the jsonb snapshots stored on orders. */
export interface AddressLike {
  full_name?: string | null;
  phone?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
}

export function asAddress(value: unknown): AddressLike {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const pick = (key: keyof AddressLike) => (typeof record[key] === "string" ? (record[key] as string) : null);
  return {
    full_name: pick("full_name"),
    phone: pick("phone"),
    line1: pick("line1"),
    line2: pick("line2"),
    city: pick("city"),
    state: pick("state"),
    postal_code: pick("postal_code"),
    country_code: pick("country_code"),
  };
}

export function addressLines(address: AddressLike): string[] {
  const cityLine = [address.postal_code, address.city, address.state].filter(Boolean).join(" ");
  return [
    address.full_name,
    address.line1,
    address.line2,
    cityLine,
    address.country_code ? countryName(address.country_code) : null,
    address.phone,
  ].filter((line): line is string => Boolean(line && line.trim()));
}
