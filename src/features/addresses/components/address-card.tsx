import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { Tables } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { addressLines } from "../format";

const TYPE_LABEL = { both: "Shipping & billing", shipping: "Shipping only", billing: "Billing only" } as const;

export function AddressSummary({ address, className }: { address: Tables<"addresses">; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {address.label ? <span className="text-sm font-medium text-ink">{address.label}</span> : null}
        <Badge variant="neutral">{TYPE_LABEL[address.type]}</Badge>
        {address.is_default_shipping ? <Badge variant="accent">Default shipping</Badge> : null}
        {address.is_default_billing ? <Badge variant="accent">Default billing</Badge> : null}
      </div>
      <address className="text-sm leading-relaxed text-ink-soft not-italic">
        {addressLines(address).map((line, index) => (
          <span key={index} className="block">
            {line}
          </span>
        ))}
      </address>
    </div>
  );
}

export function AddressBlock({ title, lines, footer }: { title: string; lines: string[]; footer?: ReactNode }) {
  return (
    <div>
      <p className="mb-2 eyebrow">{title}</p>
      <address className="text-sm leading-relaxed text-ink-soft not-italic">
        {lines.length
          ? lines.map((line, index) => (
              <span key={index} className="block">
                {line}
              </span>
            ))
          : "—"}
      </address>
      {footer}
    </div>
  );
}
