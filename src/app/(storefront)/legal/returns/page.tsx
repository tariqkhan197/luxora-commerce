import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, RETURN_WINDOW_DAYS } from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { LegalDocument, LegalSection, LegalValue } from "@/features/legal/components/legal-document";

export const metadata: Metadata = {
  title: "Returns Policy",
  description: `How to return a purchase within ${RETURN_WINDOW_DAYS} days of delivery.`,
};

export default function ReturnsPolicyPage() {
  return (
    <LegalDocument
      title="Returns Policy"
      summary={`You can request a return within ${RETURN_WINDOW_DAYS} days of delivery. This page explains how returns work on Luxora.`}
      current={ROUTES.legal.returns}
    >
      <LegalSection title="Return window">
        <p>
          You can request a return for an item within {RETURN_WINDOW_DAYS} days of the day it was delivered. Some
          vendors publish additional return details on their store page.
        </p>
      </LegalSection>

      <LegalSection title="How to start a return">
        <ul>
          <li>
            Open the order in <Link href={ROUTES.account.orders}>your account</Link> and choose{" "}
            <em>Request a return</em> on the shipment, with the items, quantities and a reason for each.
          </li>
          <li>
            The vendor reviews the request. Once it is approved, the return address and instructions appear on your
            order and on <Link href={ROUTES.account.returns}>your returns page</Link>. Please do not send items back
            before your return is approved.
          </li>
          <li>When you have sent the parcel, add the carrier and tracking number to the return.</li>
          <li>You can cancel a return request until you have sent the items.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Return shipping">
        <p>
          You pay the cost of sending items back to the vendor. We recommend a tracked service, as the parcel is your
          responsibility until it reaches the vendor.
        </p>
      </LegalSection>

      <LegalSection title="Refunds">
        <p>
          Once the vendor has received the returned items, Luxora issues the refund for them to your original payment
          method. The original shipping charge is not refunded for returns. If you used a discount code, the refund is
          the amount you actually paid for the returned items.
        </p>
      </LegalSection>

      <LegalSection title="Faulty or incorrect items">
        <p>
          If an item arrives damaged, faulty or is not what you ordered, contact us at{" "}
          <LegalValue value={CONTACT_EMAIL} /> as soon as possible. This policy does not affect your statutory rights.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
