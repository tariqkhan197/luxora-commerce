import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";

export default function NotFound() {
  return (
    <div className="container-editorial flex min-h-[70vh] flex-col items-start justify-center py-16">
      <p className="mb-4 eyebrow">404</p>
      <h1 className="display-2">We couldn&apos;t find that page.</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-soft">
        The link may be out of date, or the item may no longer be available.
      </p>
      <div className="mt-8 flex gap-3">
        <Button asChild>
          <Link href={ROUTES.home}>Back to home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={ROUTES.shop}>Browse the shop</Link>
        </Button>
      </div>
    </div>
  );
}
