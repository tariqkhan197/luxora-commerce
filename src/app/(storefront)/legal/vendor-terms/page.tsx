import type { Metadata } from "next";
import Link from "next/link";
import {
  CONTACT_EMAIL,
  GOVERNING_LAW,
  LEGAL_COMPANY_NAME,
  RETURN_WINDOW_DAYS,
  STORE_CURRENCY,
  VENDOR_TERMS_VERSION,
} from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { LegalDocument, LegalSection, LegalValue } from "@/features/legal/components/legal-document";

export const metadata: Metadata = {
  title: "Vendor Terms",
  description: "The terms that apply to brands selling on Luxora.",
};

export default function VendorTermsPage() {
  return (
    <LegalDocument
      title="Vendor Terms"
      summary="These terms apply to brands that sell on Luxora. You accept them, with the version shown below, when you apply to become a vendor."
      current={ROUTES.legal.vendorTerms}
      version={VENDOR_TERMS_VERSION}
    >
      <LegalSection title="1. The parties">
        <p>
          These terms are between you (the &ldquo;vendor&rdquo;) and <LegalValue value={LEGAL_COMPANY_NAME} />, which
          operates Luxora. Our <Link href={ROUTES.legal.terms}>Terms of Service</Link> and{" "}
          <Link href={ROUTES.legal.privacy}>Privacy Policy</Link> also apply to your use of the platform.
        </p>
      </LegalSection>

      <LegalSection title="2. Applying and approval">
        <ul>
          <li>You apply through the vendor application. Luxora reviews each application and may decline it.</li>
          <li>
            When you are approved, Luxora creates your vendor account and a brand in your vendor name. Luxora may edit
            or manage that brand, for example to correct its details.
          </li>
          <li>We record the version of these terms you accepted and when you accepted it.</li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Listings">
        <ul>
          <li>
            You are responsible for your listings: they must be accurate, you must have the right to sell the products,
            and the products must be lawful to sell in the countries you ship to.
          </li>
          <li>Products are reviewed by Luxora before they go live and may be rejected or removed.</li>
          <li>
            You may list products under your own brand or under a brand that no vendor owns. You may not use another
            vendor&rsquo;s brand.
          </li>
          <li>Prices are set by you, in {STORE_CURRENCY}.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Shipping">
        <ul>
          <li>
            Before your store can be published you must set a shipping rate for at least one of Luxora&rsquo;s shipping
            zones. Customers in zones you do not ship to cannot buy your products.
          </li>
          <li>
            You set a price for the first item and for each additional item per zone, and may offer free shipping above
            an order amount. The shipping charged is the rate in effect when the order is placed.
          </li>
          <li>
            You ship each order from your own premises, keep stock levels accurate and add the carrier and tracking
            details when you dispatch an order.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Commission and earnings">
        <ul>
          <li>
            Luxora charges a commission on the merchandise value of each order. Shipping charges are not subject to
            commission and count towards your earnings.
          </li>
          <li>
            The commission rate is the rate that applies to your account or the product&rsquo;s category, as shown in
            your vendor portal. The rate is fixed on each order when it is placed.
          </li>
          <li>
            Payouts are not yet available. The payout schedule and method will be set out in these terms before payments
            are enabled.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Returns">
        <p>
          You agree to accept returns requested within {RETURN_WINDOW_DAYS} days of delivery in line with Luxora&rsquo;s{" "}
          <Link href={ROUTES.legal.returns}>Returns Policy</Link>. Customers pay the cost of return shipping.
        </p>
      </LegalSection>

      <LegalSection title="7. Customer data">
        <p>
          You receive customers&rsquo; names and delivery details only to fulfil their orders. You may not use them for
          any other purpose, including marketing, and must keep them secure.
        </p>
      </LegalSection>

      <LegalSection title="8. Suspension and closure">
        <p>
          Luxora may suspend or close a vendor account that breaches these terms. While suspended, your store and
          products are hidden from customers. Orders already placed are unaffected.
        </p>
      </LegalSection>

      <LegalSection title="9. Changes, law and contact">
        <p>
          When these terms change materially, the version number changes and you may be asked to accept the new version.
          These terms are governed by <LegalValue value={GOVERNING_LAW} />. Contact:{" "}
          <LegalValue value={CONTACT_EMAIL} />.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
