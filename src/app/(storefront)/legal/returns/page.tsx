import type { Metadata } from "next";
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
        <p>
          Contact us at <LegalValue value={CONTACT_EMAIL} /> with your order number and the items you would like to
          return. We will confirm the return with the vendor and send you the return address. Please do not send items
          back before your return is confirmed.
        </p>
      </LegalSection>

      <LegalSection title="Return shipping">
        <p>
          You pay the cost of sending items back to the vendor. We recommend a tracked service, as the parcel is your
          responsibility until it reaches the vendor.
        </p>
      </LegalSection>

      <LegalSection title="Refunds">
        <p>
          Once the vendor has received the returned items, the refund for them is issued to your original payment
          method.
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
