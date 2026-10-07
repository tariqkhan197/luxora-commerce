import type { Metadata } from "next";
import { CONTACT_EMAIL, LEGAL_COMPANY_NAME, REGISTERED_BUSINESS_ADDRESS } from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { LegalDocument, LegalSection, LegalValue } from "@/features/legal/components/legal-document";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What personal data Luxora collects, why, and the choices you have.",
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      summary="This policy explains what personal data Luxora collects when you use the marketplace, how it is used and shared, and how to contact us about it."
      current={ROUTES.legal.privacy}
    >
      <LegalSection title="Who is responsible for your data">
        <p>
          <LegalValue value={LEGAL_COMPANY_NAME} />, <LegalValue value={REGISTERED_BUSINESS_ADDRESS} />. Contact:{" "}
          <LegalValue value={CONTACT_EMAIL} />.
        </p>
      </LegalSection>

      <LegalSection title="What we collect">
        <ul>
          <li>
            <strong className="text-ink">Account details:</strong> your email address and password (stored only as a
            secure hash by our authentication provider), and your name and phone number if you add them.
          </li>
          <li>
            <strong className="text-ink">Addresses:</strong> the shipping and billing addresses you save. Each order
            keeps a copy of the addresses used for it.
          </li>
          <li>
            <strong className="text-ink">Shopping activity:</strong> the contents of your bag and the orders you place.
          </li>
          <li>
            <strong className="text-ink">Reviews:</strong> the ratings, text and photos you submit about products you
            bought.
          </li>
          <li>
            <strong className="text-ink">Vendor information:</strong> if you apply to sell, your business name, contact
            details, website and description, the date and version of the Vendor Terms you accepted, and the images and
            product information you upload.
          </li>
          <li>
            <strong className="text-ink">Security records:</strong> a log of significant account and administrative
            actions, used to protect the marketplace and investigate misuse.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="How we use it">
        <ul>
          <li>to provide your account, your bag and checkout;</li>
          <li>to pass each order to the vendor who fulfils it;</li>
          <li>to calculate shipping for your delivery address;</li>
          <li>to review vendor applications and products before they go live;</li>
          <li>to keep the marketplace secure and meet our legal obligations.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Who we share it with">
        <ul>
          <li>
            <strong className="text-ink">Vendors</strong> receive the information needed to fulfil their part of your
            order: the items and the name, address and phone number on your shipping address. Vendors cannot see the
            parts of your order placed with other vendors, or your payment details.
          </li>
          <li>
            <strong className="text-ink">Published reviews</strong> are public. They show your first name and last
            initial, the option you bought and the date, never your full name or email address. The vendor of the
            product can reply publicly.
          </li>
          <li>
            <strong className="text-ink">Our payment processor, Stripe,</strong> receives your payment details, your
            email address and the order&rsquo;s shipping address to take the payment and prevent fraud. Luxora does not
            receive or store your full card number; we keep the payment reference, amount and status.
          </li>
          <li>
            <strong className="text-ink">Service providers</strong> that host our database, authentication and file
            storage process data on our behalf.
          </li>
          <li>We do not sell your personal data.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Cookies">
        <p>
          Luxora uses cookies that are strictly necessary to keep you signed in and to secure your session. We do not
          use advertising or analytics cookies.
        </p>
      </LegalSection>

      <LegalSection title="Retention and your choices">
        <ul>
          <li>You can edit or delete your saved addresses and update your profile at any time from your account.</li>
          <li>You can edit or delete your reviews and their photos at any time from your account.</li>
          <li>
            Order records are kept for as long as needed for accounting, tax and legal purposes, even if you close your
            account.
          </li>
          <li>
            To request a copy of your data, a correction or the deletion of your account, contact{" "}
            <LegalValue value={CONTACT_EMAIL} />. Depending on where you live, you may have further rights under data
            protection law.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Changes">
        <p>We will update this page when our practices change. The date at the top shows the latest revision.</p>
      </LegalSection>
    </LegalDocument>
  );
}
