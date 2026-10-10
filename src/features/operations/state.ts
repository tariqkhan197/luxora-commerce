/**
 * Display helpers for the operations pages (Phase 7). Pure: used by server
 * pages and unit tests. The database decides which rule applies.
 */

interface RuleFields {
  is_active: boolean;
  starts_at: string;
  ends_at: string | null;
}

export type CommissionRuleState = "inactive" | "ended" | "scheduled" | "in_effect";

/** Where a commission rule is in its life, from its flag and dates. */
export function commissionRuleState(rule: RuleFields, now = Date.now()): CommissionRuleState {
  if (!rule.is_active) return "inactive";
  if (rule.ends_at && new Date(rule.ends_at).getTime() <= now) return "ended";
  if (new Date(rule.starts_at).getTime() > now) return "scheduled";
  return "in_effect";
}

export const COMMISSION_RULE_STATE_LABELS: Record<CommissionRuleState, string> = {
  in_effect: "In effect",
  scheduled: "Scheduled",
  ended: "Ended",
  inactive: "Inactive",
};

export const COMMISSION_SCOPE_LABELS = { global: "Global", category: "Category", vendor: "Vendor" } as const;

/** Sources returned by explain_commission_rate(), in precedence order. */
export const COMMISSION_SOURCES = [
  "vendor_rule",
  "vendor_override",
  "category_rule",
  "category_rate",
  "global_rule",
  "platform_default",
] as const;
export type CommissionSource = (typeof COMMISSION_SOURCES)[number];

export const COMMISSION_SOURCE_LABELS: Record<CommissionSource, string> = {
  vendor_rule: "Vendor rule",
  vendor_override: "Vendor's own rate",
  category_rule: "Category rule",
  category_rate: "Category's own rate",
  global_rule: "Global rule",
  platform_default: "Platform default (commission.default_bps)",
};

export function commissionSourceLabel(source: string): string {
  return (COMMISSION_SOURCE_LABELS as Record<string, string>)[source] ?? source;
}

// Settings ---------------------------------------------------------------------

const SENSITIVE_KEY = /(secret|token|password|passwd|api[_-]?key|private|credential|signing|webhook)/i;
export const REDACTED = "•••• redacted";

/** Whether a setting key looks like it holds a credential (its value is never shown). */
export function isSensitiveSettingKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/**
 * A JSON value as display text, with any value under a sensitive-looking key
 * (at any depth) replaced. The result is rendered as text, never as HTML.
 */
export function redactedJson(value: unknown, key = ""): string {
  if (key && isSensitiveSettingKey(key)) return JSON.stringify(REDACTED);
  return JSON.stringify(redactDeep(value), null, 2) ?? "null";
}

function redactDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        isSensitiveSettingKey(k) ? REDACTED : redactDeep(v),
      ]),
    );
  }
  return value;
}

// Audit log filters --------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN = /^[a-z0-9_.:-]{1,80}$/i;

export interface AuditLogFilters {
  /** Exact action, or a prefix ending in "." (e.g. "commission."). */
  action: string | null;
  entityType: string | null;
  entityId: string | null;
  actorId: string | null;
  /** UTC days, inclusive. */
  from: string | null;
  to: string | null;
  page: number;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function day(value: unknown): string | null {
  const v = text(value);
  if (!ISO_DAY.test(v)) return null;
  const ms = Date.parse(`${v}T00:00:00Z`);
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== v ? null : v;
}

/** Search params → filters. Anything malformed is ignored rather than sent to the database. */
export function parseAuditLogFilters(params: Record<string, unknown>): AuditLogFilters {
  const action = text(params.action);
  const entityType = text(params.entity);
  const entityId = text(params.entityId);
  const actorId = text(params.actor);
  const page = Number.parseInt(text(params.page) || "1", 10);
  return {
    action: TOKEN.test(action) ? action : null,
    entityType: TOKEN.test(entityType) ? entityType : null,
    entityId: entityId && entityId.length <= 120 && /^[\w.:-]+$/.test(entityId) ? entityId : null,
    actorId: UUID.test(actorId) ? actorId : null,
    from: day(params.from),
    to: day(params.to),
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1,
  };
}

/** UTC [start, end) instants for the day filters (end is the day after `to`). */
export function auditLogTimeBounds(filters: Pick<AuditLogFilters, "from" | "to">): {
  gte: string | null;
  lt: string | null;
} {
  const lt = filters.to ? new Date(Date.parse(`${filters.to}T00:00:00Z`) + 86_400_000).toISOString() : null;
  return { gte: filters.from ? `${filters.from}T00:00:00.000Z` : null, lt };
}
