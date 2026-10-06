const dateTimeUtc = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

/**
 * Server-rendered timestamps are formatted in UTC and labelled as such, so the
 * output is deterministic and never silently shifted by the server's zone.
 * (`timeZoneName` cannot be combined with `dateStyle`/`timeStyle`.)
 */
export function formatDateTimeUtc(value: string | Date): string {
  return `${dateTimeUtc.format(typeof value === "string" ? new Date(value) : value)} UTC`;
}
