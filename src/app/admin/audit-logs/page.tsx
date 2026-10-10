import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ROUTES } from "@/config/routes";
import { listAuditLogs } from "@/features/operations/queries";
import { parseAuditLogFilters, redactedJson, type AuditLogFilters } from "@/features/operations/state";
import { requireRole } from "@/lib/auth/dal";
import { formatDateTimeUtc } from "@/lib/format";

export const metadata: Metadata = { title: "Audit log" };

function filterQuery(filters: AuditLogFilters, page: number): string {
  const query = new URLSearchParams();
  if (filters.action) query.set("action", filters.action);
  if (filters.entityType) query.set("entity", filters.entityType);
  if (filters.entityId) query.set("entityId", filters.entityId);
  if (filters.actorId) query.set("actor", filters.actorId);
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  if (page > 1) query.set("page", String(page));
  const qs = query.toString();
  return qs ? `${ROUTES.admin.auditLogs}?${qs}` : ROUTES.admin.auditLogs;
}

export default async function AdminAuditLogsPage({ searchParams }: PageProps<"/admin/audit-logs">) {
  await requireRole(["admin", "super_admin"], ROUTES.admin.auditLogs);
  const filters = parseAuditLogFilters(await searchParams);
  const result = await listAuditLogs(filters);
  const filtered = Boolean(
    filters.action || filters.entityType || filters.entityId || filters.actorId || filters.from || filters.to,
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Security"
        title="Audit log"
        description="A read-only record of sensitive actions. Entries cannot be edited or deleted. Times are UTC."
      />
      <form
        method="get"
        action={ROUTES.admin.auditLogs}
        className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-3 lg:grid-cols-6 lg:items-end"
      >
        <label className="flex flex-col gap-1 text-xs text-ink-soft">
          Action
          <Input name="action" defaultValue={filters.action ?? ""} placeholder="e.g. commission." maxLength={80} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-soft">
          Entity type
          <Input name="entity" defaultValue={filters.entityType ?? ""} placeholder="e.g. profile" maxLength={80} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-soft">
          Entity ID
          <Input name="entityId" defaultValue={filters.entityId ?? ""} maxLength={120} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-soft">
          Actor (profile ID)
          <Input name="actor" defaultValue={filters.actorId ?? ""} maxLength={36} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-soft">
          From (UTC)
          <Input type="date" name="from" defaultValue={filters.from ?? ""} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-soft">
          To (UTC)
          <Input type="date" name="to" defaultValue={filters.to ?? ""} />
        </label>
        <div className="flex gap-2 sm:col-span-3 lg:col-span-6">
          <Button type="submit" size="sm">
            Filter
          </Button>
          {filtered ? (
            <Button asChild size="sm" variant="ghost">
              <Link href={ROUTES.admin.auditLogs}>Clear</Link>
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-ink-faint sm:col-span-3 lg:col-span-6">
          An action ending in a dot matches every action with that prefix. Malformed values are ignored.
        </p>
      </form>

      {result.rows.length === 0 ? (
        <EmptyState
          title={filtered ? "No matching entries" : "No entries yet"}
          description={filtered ? "Try wider filters." : "Sensitive actions are recorded here as they happen."}
        />
      ) : (
        <>
          <p className="text-sm text-ink-soft">
            {result.total} entr{result.total === 1 ? "y" : "ies"}
          </p>
          <ol className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
            {result.rows.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-2 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-sm text-ink">{entry.action}</span>
                  <span className="text-xs text-ink-soft">{formatDateTimeUtc(entry.created_at)}</span>
                </div>
                <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                  <div className="flex gap-2">
                    <dt className="text-ink-faint">Entity</dt>
                    <dd className="break-all text-ink-soft">
                      {entry.entity_type}
                      {entry.entity_id ? ` · ${entry.entity_id}` : ""}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-ink-faint">Actor</dt>
                    <dd className="break-all text-ink-soft">
                      {entry.actor_id
                        ? `${entry.actorName ?? "Unnamed"} (${entry.actor_role?.replace(/_/g, " ") ?? "unknown role"}) · ${entry.actor_id}`
                        : "System"}
                    </dd>
                  </div>
                </dl>
                <details>
                  <summary className="cursor-pointer text-xs text-ink-soft">Details</summary>
                  {/* Rendered as text: React escapes it, so metadata can never inject markup. */}
                  <pre className="mt-2 max-h-80 overflow-auto rounded bg-surface-muted p-2 text-xs break-words whitespace-pre-wrap text-ink-soft">
                    {redactedJson(entry.metadata)}
                  </pre>
                </details>
              </li>
            ))}
          </ol>
          <Pagination page={filters.page} pageCount={result.pageCount} hrefFor={(page) => filterQuery(filters, page)} />
        </>
      )}
    </div>
  );
}
