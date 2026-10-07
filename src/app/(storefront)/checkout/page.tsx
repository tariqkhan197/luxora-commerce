import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StorageImage } from "@/components/shared/storage-image";
import { ROUTES } from "@/config/routes";
import { listAddresses } from "@/features/addresses/queries";
import { addressLines } from "@/features/addresses/format";
import { getCartLines } from "@/features/cart/queries";
import { CheckoutForm } from "@/features/checkout/components/checkout-form";
import { getShippingQuotes, MAX_QUOTED_ADDRESSES } from "@/features/checkout/queries";
import { buildCheckoutQuote, type CheckoutQuote } from "@/features/checkout/quote";
import { requireUser } from "@/lib/auth/dal";
import { formatMoney } from "@/lib/money";
import { STORAGE_BUCKETS } from "@/lib/storage";

export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const { profile } = await requireUser(ROUTES.checkout);
  const [lines, addresses] = await Promise.all([getCartLines(), listAddresses(profile.id)]);
  const quote = buildCheckoutQuote(lines);
  // Unavailable or out-of-stock lines must be resolved in the bag first.
  if (!quote.canCheckout) redirect(ROUTES.cart);

  const defaultShipping = addresses.find((a) => a.is_default_shipping && a.type !== "billing") ?? null;
  const defaultBilling = addresses.find((a) => a.is_default_billing && a.type !== "shipping") ?? null;

  // Shipping is quoted by the database for each address the customer can ship to.
  const shippingAddresses = addresses
    .filter((address) => address.type !== "billing")
    .sort((a, b) => Number(b.is_default_shipping) - Number(a.is_default_shipping))
    .slice(0, MAX_QUOTED_ADDRESSES);
  const shippingByAddress = await getShippingQuotes(shippingAddresses.map((address) => address.id));
  const quotesByAddress: Record<string, CheckoutQuote> = Object.fromEntries(
    Object.entries(shippingByAddress).map(([id, rows]) => [id, buildCheckoutQuote(lines, rows)]),
  );

  return (
    <div className="container-editorial flex flex-col gap-8 py-12 md:py-16">
      <PageHeader eyebrow="Checkout" title="Review and place your order" />
      <CheckoutForm
        addresses={addresses.map((address) => ({
          id: address.id,
          type: address.type,
          label: address.label,
          lines: addressLines(address),
        }))}
        defaultShippingId={defaultShipping?.id ?? null}
        defaultBillingId={defaultBilling?.id ?? null}
        checkoutToken={randomUUID()}
        baseQuote={quote}
        quotesByAddress={quotesByAddress}
        defaultCountry={addresses[0]?.country_code ?? "US"}
        items={
          <div className="flex flex-col gap-5 border-t border-line pt-5">
            {quote.groups.map((group) => (
              <div key={group.vendorId} className="flex flex-col gap-3">
                <p className="eyebrow">{group.vendorName}</p>
                <ul className="flex flex-col gap-3">
                  {group.lines.map((line) => (
                    <li key={line.cartItemId} className="flex items-center gap-3 text-sm">
                      <StorageImage
                        bucket={STORAGE_BUCKETS.productImages}
                        path={line.imagePath}
                        alt=""
                        className="aspect-[4/5] w-11 shrink-0 rounded"
                        sizes="44px"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ink">{line.productName}</span>
                        <span className="block text-xs text-ink-faint">
                          {line.variantTitle} · Qty {line.quantity}
                        </span>
                      </span>
                      <span className="tabular-nums">{formatMoney(line.lineTotal.amountMinor, quote.currency)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <Link href={ROUTES.cart} className="text-xs text-ink-soft underline-offset-4 hover:underline">
              Edit bag
            </Link>
          </div>
        }
      />
    </div>
  );
}
