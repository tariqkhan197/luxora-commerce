import type { Metadata } from "next";
import Link from "next/link";
import {
  CONTACT_EMAIL,
  DUTIES_AND_TAXES_NOTICE,
  GOVERNING_LAW,
  LEGAL_COMPANY_NAME,
  REGISTERED_BUSINESS_ADDRESS,
  RETURN_WINDOW_DAYS,
  STORE_CURRENCY,
} from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { LegalDocument, LegalSection, LegalValue } from "@/features/legal/components/legal-document";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that apply when you use Luxora and buy from its independent vendors.",
};

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Service"
      summary="These terms apply when you browse Luxora, create an account or place an order. Please read them together with our Privacy, Shipping and Returns policies."
      current={ROUTES.legal.terms}
    >
      <LegalSection title="1. About Luxora">
        <p>
          Luxora is an online marketplace where independent fashion and lifestyle brands (&ldquo;vendors&rdquo;) list
          and sell their products. Luxora is operated by <LegalValue value={LEGAL_COMPANY_NAME} />, registered at{" "}
          <LegalValue value={REGISTERED_BUSINESS_ADDRESS} /> (&ldquo;Luxora&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;).
        </p>
      </LegalSection>

      <LegalSection title="2. Your account">
        <ul>
          <li>You need an account to place an order. The details you give us must be accurate and kept up to date.</li>
          <li>You must verify your email address before signing in, and keep your password confidential.</li>
          <li>
            We may suspend or close an account that is used fraudulently, breaches these terms or puts other users at
            risk.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Products and vendors">
        <p>
          Every product on Luxora is listed by an independent vendor, named on the product page. The vendor is
          responsible for the product description, its quality and for shipping it to you. Products are reviewed by
          Luxora before they go live, but we do not manufacture or hold stock of them.
        </p>
      </LegalSection>

      <LegalSection title="4. Prices, duties and taxes">
        <ul>
          <li>Prices are shown and charged in {STORE_CURRENCY}.</li>
          <li>
            The price you pay is always the current catalog price. If a price changes after you add an item to your bag,
            the bag shows the new price and you are asked to review your order before it is placed.
          </li>
          <li>Shipping is calculated at checkout for your delivery address and shown before you place your order.</li>
          <li>
            {DUTIES_AND_TAXES_NOTICE} Import duties, taxes and customs fees are not included in the price and are
            payable by the recipient where charged.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Orders">
        <ul>
          <li>
            Placing an order reserves the items for a limited time. An order containing items from several vendors is
            split into one order per vendor, and each vendor ships its items separately.
          </li>
          <li>
            We or the vendor may cancel an order, for example if an item is no longer available or a price was listed in
            error. If you have been charged for a cancelled order, you will be refunded.
          </li>
          <li>
            Payment is taken at checkout on a secure page provided by our payment processor, Stripe. Your order is
            confirmed once the payment succeeds; if you do not complete payment before the payment window closes, the
            order is cancelled automatically and the items are released.
          </li>
          <li>
            While Luxora is being prepared for launch, payments run in Stripe&rsquo;s test environment: no real money is
            charged and orders placed this way are not fulfilled.
          </li>
          <li>Refunds are made to the original payment method.</li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Shipping and returns">
        <p>
          Delivery is described in our <Link href={ROUTES.legal.shipping}>Shipping Policy</Link>. You can request a
          return within {RETURN_WINDOW_DAYS} days of delivery as described in our{" "}
          <Link href={ROUTES.legal.returns}>Returns Policy</Link>.
        </p>
      </LegalSection>

      <LegalSection title="7. Acceptable use">
        <p>You agree not to:</p>
        <ul>
          <li>use Luxora for fraudulent orders or to impersonate anyone;</li>
          <li>interfere with the security or operation of the site, or access other users&rsquo; data;</li>
          <li>copy or scrape the catalog or vendors&rsquo; content by automated means without our permission.</li>
        </ul>
      </LegalSection>

      <LegalSection title="8. Changes to these terms">
        <p>
          We may update these terms. The date at the top of this page shows when they last changed. Orders placed before
          a change remain subject to the terms in force when they were placed.
        </p>
      </LegalSection>

      <LegalSection title="9. Governing law">
        <p>
          These terms are governed by <LegalValue value={GOVERNING_LAW} />. Nothing in these terms affects your
          statutory rights as a consumer.
        </p>
      </LegalSection>

      <LegalSection title="10. Contact">
        <p>
          Questions about these terms: <LegalValue value={CONTACT_EMAIL} />.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
