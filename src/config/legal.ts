/**
 * Legal and policy configuration.
 *
 * ⚠️ PLACEHOLDERS — REPLACE BEFORE LAUNCH ⚠️
 * The company details below are deliberately NOT filled in. They must be
 * supplied by the business (and reviewed by a lawyer) before Luxora goes live.
 * While any value is still a placeholder, every legal page shows a
 * "draft — pending legal review" notice (see `LEGAL_DETAILS_PENDING`).
 *
 * Nothing in this file is real company information.
 */

/** Marker shared by every unresolved placeholder value. */
const PLACEHOLDER_PREFIX = "[PLACEHOLDER:";

/** Registered legal name of the operating company. */
export const LEGAL_COMPANY_NAME = "[PLACEHOLDER: LEGAL_COMPANY_NAME]";

/** Registered business address of the operating company. */
export const REGISTERED_BUSINESS_ADDRESS = "[PLACEHOLDER: REGISTERED_BUSINESS_ADDRESS]";

/** Contact email for legal, privacy and customer-care requests. */
export const CONTACT_EMAIL = "[PLACEHOLDER: CONTACT_EMAIL]";

/** Governing law and jurisdiction for the Terms. */
export const GOVERNING_LAW = "[PLACEHOLDER: GOVERNING_LAW]";

export function isPlaceholder(value: string): boolean {
  return value.startsWith(PLACEHOLDER_PREFIX);
}

/** True while any company detail above is still a placeholder. */
export const LEGAL_DETAILS_PENDING = [
  LEGAL_COMPANY_NAME,
  REGISTERED_BUSINESS_ADDRESS,
  CONTACT_EMAIL,
  GOVERNING_LAW,
].some(isPlaceholder);

// -----------------------------------------------------------------------------
// Policy decisions (confirmed for Release 4a)
// -----------------------------------------------------------------------------

/** Days after delivery within which a customer may request a return. */
export const RETURN_WINDOW_DAYS = 14;

/** Who pays to send a returned item back. */
export const RETURN_SHIPPING_PAID_BY = "customer" as const;

/** Shown wherever totals are displayed until tax calculation ships (Release 4b). */
export const DUTIES_AND_TAXES_NOTICE = "Duties and taxes may apply on delivery.";

/** Currency all prices are shown and charged in. */
export const STORE_CURRENCY = "USD";

// -----------------------------------------------------------------------------
// Document versions
// -----------------------------------------------------------------------------

/**
 * Version of the Vendor Terms a vendor accepts when applying. Stored on the
 * application with the acceptance timestamp. Bump it whenever the Vendor Terms
 * change materially. Format must match the database check: [A-Za-z0-9._-]{1,40}.
 */
export const VENDOR_TERMS_VERSION = "2026-10-07-draft";

/** Date shown as "Last updated" on the legal pages (ISO yyyy-mm-dd). */
export const LEGAL_LAST_UPDATED = "2026-10-07";
