import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/shared/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROUTES } from "@/config/routes";
import { getAdminCategories } from "@/features/admin/taxonomy/queries";
import { buildCategoryTree, flattenTree } from "@/features/admin/taxonomy/tree";
import { setCommissionRuleActive } from "@/features/operations/actions";
import { CommissionRuleFormDialog } from "@/features/operations/components/commission-rule-form-dialog";
import { explainCommission, listCommissionRules, listCommissionVendors } from "@/features/operations/queries";
import {
  COMMISSION_RULE_STATE_LABELS,
  COMMISSION_SCOPE_LABELS,
  commissionRuleState,
  commissionSourceLabel,
  type CommissionRuleState,
} from "@/features/operations/state";
import { requireRole } from "@/lib/auth/dal";
import { formatDateTimeUtc } from "@/lib/format";
import { formatBasisPoints } from "@/lib/money";
import { basisPointsToPercentInput, isoToDateTimeInput, uuidSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Commissions" };

const STATE_VARIANT: Record<CommissionRuleState, "success" | "accent" | "neutral" | "outline"> = {
  in_effect: "success",
  scheduled: "accent",
  ended: "neutral",
  inactive: "outline",
};

const PRECEDENCE = [
  "An active vendor rule for the product's vendor",
  "The vendor's own rate (set when approving or editing the vendor)",
  "For the product's category, then each parent category in turn: an active category rule, then the category's own rate",
  "An active global rule",
  "The platform default (setting commission.default_bps)",
];

export default async function AdminCommissionsPage({ searchParams }: PageProps<"/admin/commissions">) {
  await requireRole(["admin", "super_admin"], ROUTES.admin.commissions);
  const params = await searchParams;
  const previewVendor =
    typeof params.vendor === "string" && uuidSchema.safeParse(params.vendor).success ? params.vendor : null;
  const previewCategory =
    typeof params.category === "string" && uuidSchema.safeParse(params.category).success ? params.category : null;

  const [rules, vendors, categories] = await Promise.all([
    listCommissionRules(),
    listCommissionVendors(),
    getAdminCategories(),
  ]);
  const preview = previewVendor ? await explainCommission(previewVendor, previewCategory) : null;

  const categoryOptions = flattenTree(buildCategoryTree(categories)).map((node) => ({
    id: node.category.id,
    name: `${"— ".repeat(node.depth)}${node.category.name}${node.category.isActive ? "" : " (inactive)"}`,
  }));
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const vendorOptions = vendors.map((v) => ({ id: v.id, name: v.name }));
  const overrides = vendors.filter((v) => v.commissionRateBps !== null);
  const categoryRates = categories.filter((c) => c.commissionRateBps !== null);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Finance"
        title="Commissions"
        description="Rules decide Luxora's commission on orders placed while they are in effect. Each order keeps the rate it was placed with; changes are never applied retroactively. Every change is recorded in the audit log."
        actions={<CommissionRuleFormDialog vendors={vendorOptions} categories={categoryOptions} />}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">Which rate applies</h2>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink-soft">
            {PRECEDENCE.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="text-xs text-ink-faint">
            The first match wins. Two active rules for the same target never overlap.
          </p>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">Preview the rate for a new order today</h2>
          <form
            method="get"
            action={ROUTES.admin.commissions}
            className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          >
            <label className="flex flex-col gap-1 text-xs text-ink-soft">
              Vendor
              <Select name="vendor" defaultValue={previewVendor ?? ""} required>
                <option value="">Choose a vendor</option>
                {vendorOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-soft">
              Product category
              <Select name="category" defaultValue={previewCategory ?? ""}>
                <option value="">No category</option>
                {categoryOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </label>
            <Button type="submit" size="sm" variant="outline">
              Preview
            </Button>
          </form>
          {preview ? (
            <div className="rounded-md bg-surface-muted p-3 text-sm" role="status">
              <p className="font-display text-2xl text-ink tabular-nums">{formatBasisPoints(preview.rateBps)}</p>
              <p className="text-ink-soft">
                From: {commissionSourceLabel(preview.source)}
                {preview.categoryId ? ` · ${categoryNames.get(preview.categoryId) ?? "category"}` : ""}
                {preview.ruleId ? ` · ${rules.find((r) => r.id === preview.ruleId)?.name ?? "rule"}` : ""}
              </p>
            </div>
          ) : (
            <p className="text-xs text-ink-faint">
              Uses the same order of precedence as checkout, at the current time.
            </p>
          )}
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="display-3">Rules</h2>
        {rules.length === 0 ? (
          <EmptyState
            title="No commission rules"
            description="Without rules, vendor and category rates apply, then the platform default."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rule</TableHead>
                <TableHead>Applies to</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>In effect</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule) => {
                const state = commissionRuleState({
                  is_active: rule.isActive,
                  starts_at: rule.startsAt,
                  ends_at: rule.endsAt,
                });
                return (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium text-ink">{rule.name}</TableCell>
                    <TableCell className="text-ink-soft">
                      {COMMISSION_SCOPE_LABELS[rule.scope]} · {rule.targetName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatBasisPoints(rule.rateBps)}</TableCell>
                    <TableCell className="text-xs text-ink-soft">
                      From {formatDateTimeUtc(rule.startsAt)}
                      <br />
                      {rule.endsAt ? `Until ${formatDateTimeUtc(rule.endsAt)}` : "No end date"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATE_VARIANT[state]}>{COMMISSION_RULE_STATE_LABELS[state]}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        <CommissionRuleFormDialog
                          vendors={vendorOptions}
                          categories={categoryOptions}
                          initial={{
                            ruleId: rule.id,
                            targetName: rule.targetName,
                            scope: rule.scope,
                            vendorId: rule.vendorId ?? "",
                            categoryId: rule.categoryId ?? "",
                            name: rule.name,
                            rate: basisPointsToPercentInput(rule.rateBps),
                            startsAt: isoToDateTimeInput(rule.startsAt),
                            endsAt: isoToDateTimeInput(rule.endsAt),
                          }}
                        />
                        <ActionButton
                          size="sm"
                          variant="ghost"
                          action={setCommissionRuleActive.bind(null, { ruleId: rule.id, active: !rule.isActive })}
                          confirmMessage={
                            rule.isActive
                              ? "Deactivate this rule? New orders stop using it at once; existing orders keep their rate."
                              : "Activate this rule? New orders in its date window will use it."
                          }
                        >
                          {rule.isActive ? "Deactivate" : "Activate"}
                        </ActionButton>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">Vendors with their own rate ({overrides.length})</h2>
          {overrides.length ? (
            <ul className="divide-y divide-line text-sm">
              {overrides.map((v) => (
                <li key={v.id} className="flex justify-between gap-2 py-1.5">
                  <Link href={ROUTES.admin.vendor(v.id)} className="text-ink hover:underline">
                    {v.name}
                  </Link>
                  <span className="tabular-nums">{formatBasisPoints(v.commissionRateBps ?? 0)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">No vendor has its own rate.</p>
          )}
        </section>
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-ink">Categories with their own rate ({categoryRates.length})</h2>
            <Button asChild size="sm" variant="ghost">
              <Link href={ROUTES.admin.categories}>Edit categories</Link>
            </Button>
          </div>
          {categoryRates.length ? (
            <ul className="divide-y divide-line text-sm">
              {categoryRates.map((c) => (
                <li key={c.id} className="flex justify-between gap-2 py-1.5">
                  <span className="text-ink">{c.name}</span>
                  <span className="tabular-nums">{formatBasisPoints(c.commissionRateBps ?? 0)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">No category has its own rate.</p>
          )}
        </section>
      </div>
    </div>
  );
}
