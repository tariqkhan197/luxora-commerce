import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PaginationProps {
  page: number;
  pageCount: number;
  /** Builds the href for a page number, preserving other query params. */
  hrefFor: (page: number) => string;
}

export function Pagination({ page, pageCount, hrefFor }: PaginationProps) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 border-t border-line pt-6">
      <Button asChild variant="outline" size="sm" className={page <= 1 ? "pointer-events-none opacity-40" : undefined}>
        <Link href={hrefFor(Math.max(1, page - 1))} aria-disabled={page <= 1} rel="prev">
          <ChevronLeft /> Previous
        </Link>
      </Button>
      <p className="text-sm text-ink-soft">
        Page {page} of {pageCount}
      </p>
      <Button
        asChild
        variant="outline"
        size="sm"
        className={page >= pageCount ? "pointer-events-none opacity-40" : undefined}
      >
        <Link href={hrefFor(Math.min(pageCount, page + 1))} aria-disabled={page >= pageCount} rel="next">
          Next <ChevronRight />
        </Link>
      </Button>
    </nav>
  );
}
