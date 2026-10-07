import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, DUTIES_AND_TAXES_NOTICE, STORE_CURRENCY } from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { LegalDocument, LegalSection, LegalValue } from "@/features/legal/components/legal-document";

export const metadata: Metadata = {
  title: "Shipping Policy",
  description: "Where Luxora ships, how shipping is priced, delivery times and duties and taxes.",
};

export default function ShippingPolicyPage() {
  return (
    <LegalDocument
      title="Shipping Policy"
      summary="Each brand on Luxora ships its own pieces from its own studio. This page explains where we deliver, how shipping is priced and what to expect on arrival."
      current={ROUTES.legal.shipping}
    >
      <LegalSection title="Where we ship">
        <p>
          Luxora delivers to the countries in its active shipping zones. If we do not ship to your country yet, or a
          vendor in your bag does not ship there, checkout tells you before you place your order.
        </p>
      </LegalSection>

      <LegalSection title="Who ships your order">
        <p>
          Every vendor ships its own items. If your order contains pieces from several vendors, they arrive in separate
          parcels and may arrive on different days. When a vendor dispatches your parcel, the carrier and tracking
          details appear on your order page.
        </p>
      </LegalSection>

      <LegalSection title="Shipping costs">
        <ul>
          <li>
            Each vendor sets its shipping price for each zone: a price for the first item and a price for each
            additional item in the same order.
          </li>
          <li>Some vendors offer free shipping when your order with them is over a set amount.</li>
          <li>Items that do not need to be shipped are not charged shipping.</li>
          <li>
            Shipping is charged in {STORE_CURRENCY}, calculated for your delivery address and shown in full at checkout
            before you place your order.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Delivery times">
        <p>
          Where a vendor provides a delivery estimate, it is shown at checkout. Estimates are given in good faith by the
          vendor and are not guaranteed; customs checks and carrier delays can add time.
        </p>
      </LegalSection>

      <LegalSection title="Duties and taxes">
        <p>
          {DUTIES_AND_TAXES_NOTICE} Prices and shipping charges do not include import duties, taxes or customs fees. If
          your country charges them, they are collected by the carrier or customs authority on delivery and are payable
          by the recipient.
        </p>
      </LegalSection>

      <LegalSection title="Problems with a delivery">
        <p>
          If a parcel is late, lost or arrives damaged, contact us at <LegalValue value={CONTACT_EMAIL} /> with your
          order number. For returns, see our <Link href={ROUTES.legal.returns}>Returns Policy</Link>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
