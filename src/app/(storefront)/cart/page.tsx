import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ShoppingBag } from "lucide-react";
import { ActionButton } from "@/components/shared/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StorageImage } from "@/components/shared/storage-image";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { clearCart } from "@/features/cart/actions";
import { CartLineControls } from "@/features/cart/components/cart-line-controls";
import { CouponForm } from "@/features/cart/components/coupon-form";
import { getCartLines, getPromotionQuote } from "@/features/cart/queries";
import { OrderSummary } from "@/features/checkout/components/order-summary";
import {
  buildCheckoutQuote,
  flashSaleEndsLabel,
  flashSaleShortLabel,
  unavailableLabel,
} from "@/features/checkout/quote";
import { getCurrentUser } from "@/lib/auth/dal";
import { formatMoney } from "@/lib/money";
import { STORAGE_BUCKETS } from "@/lib/storage";

export const metadata: Metadata = { title: "Your bag" };

export default async function CartPage() {
  const current = await getCurrentUser();
  if (!current) {
    return (
      <div className="container-editorial py-12 md:py-16">
        <PageHeader eyebrow="Bag" title="Your bag" />
        <EmptyState
          className="mt-8"
          icon={<ShoppingBag />}
          title="Sign in to see your bag"
          description="Your bag is saved to your account so it follows you across devices."
          action={
            <Button asChild>
              <Link href={`${ROUTES.auth.login}?next=${encodeURIComponent(ROUTES.cart)}`}>Sign in</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const [lines, promotion] = await Promise.all([getCartLines(), getPromotionQuote()]);
  const quote = buildCheckoutQuote(lines, undefined, promotion);
  const { currency } = quote;

  return (
    <div className="container-editorial flex flex-col gap-8 py-12 md:py-16">
      <PageHeader
        eyebrow="Bag"
        title="Your bag"
        actions={
          quote.groups.length > 0 ? (
            <ActionButton
              variant="ghost"
              size="sm"
              confirmMessage="Remove everything from your bag?"
              action={clearCart}
            >
              Clear bag
            </ActionButton>
          ) : null
        }
      />

      {quote.groups.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag />}
          title="Your bag is empty"
          description="Pieces you add from any brand on Luxora gather here, ready for a single checkout."
          action={
            <Button asChild>
              <Link href={ROUTES.shop}>Explore the shop</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-10 lg:grid-cols-[1fr_22rem] lg:items-start">
          <div className="flex flex-col gap-8">
            {quote.hasPriceChanges ? (
              <Alert variant="info">
                <AlertTriangle />
                <AlertTitle>Some prices have changed</AlertTitle>
                <AlertDescription>
                  Prices are always taken from the current catalog. The amounts below are what you would be charged.
                </AlertDescription>
              </Alert>
            ) : null}
            {quote.blockingLines.length > 0 ? (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>Some items need your attention</AlertTitle>
                <AlertDescription>Remove or adjust the items marked below to continue to checkout.</AlertDescription>
              </Alert>
            ) : null}

            {quote.groups.map((group) => (
              <section key={group.vendorId} className="rounded-lg border border-line bg-surface">
                <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
                  {group.storeSlug ? (
                    <Link href={ROUTES.store(group.storeSlug)} className="eyebrow hover:text-ink">
                      {group.vendorName}
                    </Link>
                  ) : (
                    <p className="eyebrow">{group.vendorName}</p>
                  )}
                  <p className="text-sm text-ink-soft tabular-nums">
                    {formatMoney(group.subtotal.amountMinor, currency)}
                  </p>
                </header>
                <ul className="divide-y divide-line">
                  {group.lines.map((line) => {
                    const issue = unavailableLabel(line);
                    const saleShort = flashSaleShortLabel(line);
                    return (
                      <li key={line.cartItemId} className="flex gap-4 p-5">
                        <Link href={ROUTES.product(line.productSlug)} className="shrink-0">
                          <StorageImage
                            bucket={STORAGE_BUCKETS.productImages}
                            path={line.imagePath}
                            alt=""
                            className="aspect-[4/5] w-20 rounded-md sm:w-24"
                            sizes="96px"
                          />
                        </Link>
                        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:justify-between">
                          <div className="flex flex-col gap-1">
                            <Link
                              href={ROUTES.product(line.productSlug)}
                              className="text-sm font-medium text-ink hover:underline"
                            >
                              {line.productName}
                            </Link>
                            <p className="text-sm text-ink-soft">
                              {line.variantTitle}
                              {Object.keys(line.options).length
                                ? ` · ${Object.entries(line.options)
                                    .map(([key, value]) => `${key}: ${value}`)
                                    .join(" · ")}`
                                : ""}
                            </p>
                            <p className="text-xs text-ink-faint">
                              {formatMoney(line.unitPriceMinor, currency)} each
                              {line.onFlashSale && line.listPriceMinor && line.listPriceMinor > line.unitPriceMinor ? (
                                <span className="ml-2 line-through">{formatMoney(line.listPriceMinor, currency)}</span>
                              ) : null}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {line.onFlashSale ? (
                                <Badge variant="accent">Flash sale · {flashSaleEndsLabel(line.flashSaleEndsAt)}</Badge>
                              ) : null}
                              {saleShort ? <Badge variant="warning">{saleShort}</Badge> : null}
                              {line.discount.amountMinor > 0 ? (
                                <Badge variant="success">
                                  Code −{formatMoney(line.discount.amountMinor, currency)}
                                </Badge>
                              ) : null}
                              {issue ? <Badge variant="danger">{issue}</Badge> : null}
                              {line.priceChanged ? (
                                <Badge variant="warning">Was {formatMoney(line.addedPriceMinor, currency)}</Badge>
                              ) : null}
                            </div>
                            <CartLineControls
                              cartItemId={line.cartItemId}
                              quantity={line.quantity}
                              maxQuantity={line.maxQuantity}
                              productName={line.productName}
                            />
                          </div>
                          <p className="text-sm tabular-nums sm:text-right">
                            {formatMoney(line.lineTotal.amountMinor, currency)}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          <aside className="lg:sticky lg:top-28">
            <OrderSummary
              quote={quote}
              coupon={
                <CouponForm
                  current={
                    promotion ? { code: promotion.code, applied: promotion.applied, message: promotion.message } : null
                  }
                />
              }
            >
              {quote.canCheckout ? (
                <Button asChild size="lg" className="w-full">
                  <Link href={ROUTES.checkout}>Continue to checkout</Link>
                </Button>
              ) : (
                <Button size="lg" className="w-full" disabled>
                  Continue to checkout
                </Button>
              )}
            </OrderSummary>
          </aside>
        </div>
      )}
    </div>
  );
}
