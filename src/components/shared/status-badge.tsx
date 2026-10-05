import { Badge } from "@/components/ui/badge";
import type { ProductStatus, StoreStatus, VendorApplicationStatus, VendorStatus } from "@/lib/supabase/database.types";

type Variant = "neutral" | "ink" | "accent" | "success" | "warning" | "danger" | "outline";

const VENDOR: Record<VendorStatus, Variant> = {
  pending: "warning",
  approved: "success",
  suspended: "danger",
  rejected: "danger",
  closed: "neutral",
};
const APPLICATION: Record<VendorApplicationStatus, Variant> = {
  submitted: "accent",
  under_review: "warning",
  approved: "success",
  rejected: "danger",
};
const PRODUCT: Record<ProductStatus, Variant> = {
  draft: "neutral",
  pending_review: "warning",
  active: "success",
  rejected: "danger",
  archived: "outline",
};
const STORE: Record<StoreStatus, Variant> = { draft: "neutral", published: "success", unpublished: "warning" };

function label(value: string) {
  return value.replace(/_/g, " ");
}

export function VendorStatusBadge({ status }: { status: VendorStatus }) {
  return <Badge variant={VENDOR[status]}>{label(status)}</Badge>;
}
export function ApplicationStatusBadge({ status }: { status: VendorApplicationStatus }) {
  return <Badge variant={APPLICATION[status]}>{label(status)}</Badge>;
}
export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  return <Badge variant={PRODUCT[status]}>{label(status)}</Badge>;
}
export function StoreStatusBadge({ status }: { status: StoreStatus }) {
  return <Badge variant={STORE[status]}>{label(status)}</Badge>;
}
