"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { AddToBagButton } from "@/features/cart/components/add-to-bag-button";
import { formatMoney } from "@/lib/money";
import { asOptionRecord, type ProductVariantAvailability } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

interface VariantSelectorProps {
  variants: ProductVariantAvailability[];
  currency: string;
  /** Product page path, used to return after signing in. */
  returnPath: string;
}

/**
 * Lets the customer pick a variant by its options and add it to their bag.
 * Price and availability shown here are display-only; the cart functions
 * re-read both from the database.
 */
export function VariantSelector({ variants, currency, returnPath }: VariantSelectorProps) {
  const defaultVariant = variants.find((v) => v.is_default) ?? variants[0];
  const [selectedId, setSelectedId] = useState<string | null>(defaultVariant?.variant_id ?? null);
  const selected = variants.find((v) => v.variant_id === selectedId) ?? defaultVariant;

  const optionNames = useMemo(() => {
    const names = new Set<string>();
    for (const variant of variants) for (const name of Object.keys(asOptionRecord(variant.options))) names.add(name);
    return Array.from(names);
  }, [variants]);

  if (!selected) return null;
  const selectedOptions = asOptionRecord(selected.options);

  function pick(name: string, value: string) {
    const target = { ...selectedOptions, [name]: value };
    const exact = variants.find((v) => {
      const options = asOptionRecord(v.options);
      return Object.entries(target).every(([k, val]) => options[k] === val);
    });
    const partial = variants.find((v) => asOptionRecord(v.options)[name] === value);
    setSelectedId((exact ?? partial)?.variant_id ?? selectedId);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline gap-3">
        <p className="font-display text-3xl">{formatMoney(selected.price_minor ?? 0, currency)}</p>
        {selected.compare_at_price_minor &&
        selected.price_minor !== null &&
        selected.compare_at_price_minor > selected.price_minor ? (
          <p className="text-sm text-ink-faint line-through">
            {formatMoney(selected.compare_at_price_minor, currency)}
          </p>
        ) : null}
        {!selected.in_stock ? (
          <Badge variant="neutral">Sold out</Badge>
        ) : selected.is_low_stock ? (
          <Badge variant="warning">Low stock</Badge>
        ) : null}
      </div>

      {optionNames.map((name) => {
        const values = Array.from(new Set(variants.map((v) => asOptionRecord(v.options)[name]).filter(Boolean)));
        return (
          <fieldset key={name} className="flex flex-col gap-2">
            <legend className="eyebrow">{name}</legend>
            <div className="flex flex-wrap gap-2">
              {values.map((value) => {
                const active = selectedOptions[name] === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => pick(name, value)}
                    aria-pressed={active}
                    className={cn(
                      "min-w-11 rounded-md border px-3 py-2 text-sm transition-colors",
                      active ? "border-ink bg-ink text-canvas" : "border-line text-ink hover:border-ink",
                    )}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      {optionNames.length === 0 && variants.length > 1 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="eyebrow">Option</legend>
          <div className="flex flex-wrap gap-2">
            {variants.map((variant) => (
              <button
                key={variant.variant_id}
                type="button"
                onClick={() => setSelectedId(variant.variant_id)}
                aria-pressed={variant.variant_id === selected.variant_id}
                className={cn(
                  "rounded-md border px-3 py-2 text-sm transition-colors",
                  variant.variant_id === selected.variant_id
                    ? "border-ink bg-ink text-canvas"
                    : "border-line text-ink hover:border-ink",
                )}
              >
                {variant.title}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="flex flex-col gap-2">
        {selected.variant_id ? (
          <AddToBagButton
            variantId={selected.variant_id}
            inStock={Boolean(selected.in_stock)}
            returnPath={returnPath}
          />
        ) : null}
        <p className="text-xs text-ink-faint">SKU {selected.sku}</p>
      </div>
    </div>
  );
}
