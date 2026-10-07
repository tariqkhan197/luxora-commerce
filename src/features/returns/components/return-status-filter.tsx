import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { ReturnStatus } from "../queries";

export const RETURN_FILTERS: { value: ReturnStatus | null; label: string }[] = [
  { value: "requested", label: "New" },
  { value: "approved", label: "Approved" },
  { value: "in_transit", label: "On the way" },
  { value: "received", label: "Received" },
  { value: "completed", label: "Refunded" },
  { value: null, label: "All" },
];

export function parseReturnFilter(value: unknown, fallback: ReturnStatus | null): ReturnStatus | null {
  if (value === "all") return null;
  const match = RETURN_FILTERS.find((filter) => filter.value === value);
  return match ? match.value : fallback;
}

export function ReturnStatusFilter({ basePath, active }: { basePath: string; active: ReturnStatus | null }) {
  return (
    <div className="flex flex-wrap gap-1">
      {RETURN_FILTERS.map((filter) => (
        <Button key={filter.label} asChild size="sm" variant={active === filter.value ? "primary" : "ghost"}>
          <Link href={`${basePath}?status=${filter.value ?? "all"}`}>{filter.label}</Link>
        </Button>
      ))}
    </div>
  );
}
