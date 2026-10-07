import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { isPlaceholder, LEGAL_DETAILS_PENDING, LEGAL_LAST_UPDATED } from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const LEGAL_NAV = [
  { label: "Terms of Service", href: ROUTES.legal.terms },
  { label: "Privacy Policy", href: ROUTES.legal.privacy },
  { label: "Shipping Policy", href: ROUTES.legal.shipping },
  { label: "Returns Policy", href: ROUTES.legal.returns },
  { label: "Vendor Terms", href: ROUTES.legal.vendorTerms },
] as const;

interface LegalDocumentProps {
  title: string;
  summary: string;
  current: (typeof LEGAL_NAV)[number]["href"];
  version?: string;
  children: ReactNode;
}

/**
 * Shared layout for the policy pages. While the company details in
 * `src/config/legal.ts` are placeholders, a prominent draft notice is shown.
 */
export function LegalDocument({ title, summary, current, version, children }: LegalDocumentProps) {
  return (
    <div className="container-editorial grid gap-10 py-12 md:grid-cols-[14rem_1fr] md:py-16">
      <nav aria-label="Legal" className="md:sticky md:top-28 md:self-start">
        <p className="mb-3 eyebrow">Legal</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-2 md:flex-col">
          {LEGAL_NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={item.href === current ? "page" : undefined}
                className={cn(
                  "text-sm transition-colors hover:text-ink",
                  item.href === current ? "font-medium text-ink" : "text-ink-soft",
                )}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <article className="flex max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-3">
          <h1 className="display-2 text-balance">{title}</h1>
          <p className="text-base leading-relaxed text-ink-soft">{summary}</p>
          <p className="text-xs text-ink-faint">
            Last updated {formatDate(LEGAL_LAST_UPDATED)}
            {version ? ` · Version ${version}` : ""}
          </p>
        </header>
        {LEGAL_DETAILS_PENDING ? (
          <Alert variant="info">
            <AlertTriangle />
            <AlertTitle>Draft — pending legal review</AlertTitle>
            <AlertDescription>
              This document is a working draft. Company details marked as placeholders will be completed before launch.
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-col gap-8 text-sm leading-relaxed text-ink-soft [&_a]:text-ink [&_a]:underline [&_a]:underline-offset-4 [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
          {children}
        </div>
      </article>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="display-3 text-ink">{title}</h2>
      {children}
    </section>
  );
}

/** Renders a configured legal value, visibly marking unresolved placeholders. */
export function LegalValue({ value }: { value: string }) {
  if (!isPlaceholder(value)) return <>{value}</>;
  return <mark className="rounded-sm bg-warning/20 px-1 text-ink">{value}</mark>;
}
