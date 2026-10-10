import type { Metadata } from "next";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { ROUTES } from "@/config/routes";
import { listPlatformSettings } from "@/features/operations/queries";
import { isSensitiveSettingKey, redactedJson } from "@/features/operations/state";
import { requireRole } from "@/lib/auth/dal";
import { formatDateTimeUtc } from "@/lib/format";

export const metadata: Metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  await requireRole(["admin", "super_admin"], ROUTES.admin.settings);
  const settings = await listPlatformSettings();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Platform"
        title="Settings"
        description="Platform settings stored in the database, read-only here. Values whose keys look like credentials are never shown. Secrets such as API keys live in the server environment, not in this table."
      />
      {settings.length === 0 ? (
        <EmptyState title="No settings" description="No platform settings are stored." />
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
          {settings.map((setting) => {
            const sensitive = isSensitiveSettingKey(setting.key);
            return (
              <li key={setting.key} className="flex flex-col gap-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-ink">{setting.key}</span>
                  <Badge variant={setting.is_public ? "accent" : "neutral"}>
                    {setting.is_public ? "public" : "admins only"}
                  </Badge>
                  {sensitive ? <Badge variant="warning">redacted</Badge> : null}
                </div>
                {setting.description ? <p className="text-sm text-ink-soft">{setting.description}</p> : null}
                <pre className="overflow-x-auto rounded bg-surface-muted p-2 text-xs break-words whitespace-pre-wrap text-ink-soft">
                  {redactedJson(setting.value, setting.key)}
                </pre>
                <p className="text-xs text-ink-faint">Updated {formatDateTimeUtc(setting.updated_at)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
