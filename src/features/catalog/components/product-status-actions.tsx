"use client";

import { ActionButton } from "@/components/shared/action-button";
import type { ProductStatus } from "@/lib/supabase/database.types";
import {
  archiveProduct,
  deleteDraftProduct,
  restoreProduct,
  submitProductForReview,
  unpublishProduct,
  withdrawProductFromReview,
} from "../actions";

export function ProductStatusActions({ productId, status }: { productId: string; status: ProductStatus }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {status === "draft" || status === "rejected" ? (
        <ActionButton size="sm" action={() => submitProductForReview(productId)}>
          Submit for review
        </ActionButton>
      ) : null}
      {status === "pending_review" ? (
        <ActionButton size="sm" variant="outline" action={() => withdrawProductFromReview(productId)}>
          Withdraw from review
        </ActionButton>
      ) : null}
      {status === "active" ? (
        <ActionButton
          size="sm"
          variant="outline"
          confirmMessage="Unpublish this product? It will be hidden from the storefront until approved again."
          action={() => unpublishProduct(productId)}
        >
          Unpublish
        </ActionButton>
      ) : null}
      {status === "draft" || status === "rejected" || status === "pending_review" ? (
        <ActionButton
          size="sm"
          variant="ghost"
          confirmMessage="Archive this product?"
          action={() => archiveProduct(productId)}
        >
          Archive
        </ActionButton>
      ) : null}
      {status === "archived" ? (
        <ActionButton size="sm" variant="outline" action={() => restoreProduct(productId)}>
          Restore to draft
        </ActionButton>
      ) : null}
      {status === "draft" ? (
        <ActionButton
          size="sm"
          variant="ghost"
          className="text-danger hover:bg-danger-soft"
          confirmMessage="Delete this draft permanently?"
          action={() => deleteDraftProduct(productId)}
        >
          Delete draft
        </ActionButton>
      ) : null}
    </div>
  );
}
