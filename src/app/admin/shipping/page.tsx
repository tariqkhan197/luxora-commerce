import type { Metadata } from "next";
import { Pencil, Plus, Truck } from "lucide-react";
import { ActionButton } from "@/components/shared/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { deleteShippingZone, setShippingZoneActive } from "@/features/shipping/actions";
import { ZoneDialog } from "@/features/shipping/components/zone-dialog";
import { getShippingZones } from "@/features/shipping/queries";
import { requireRole } from "@/lib/auth/dal";
import { countryName } from "@/lib/countries";

export const metadata: Metadata = { title: "Shipping zones" };

export default async function AdminShippingPage() {
  await requireRole(["admin", "super_admin"], ROUTES.admin.shipping);
  const zones = await getShippingZones();
  const takenFor = (zoneId: string | null): Record<string, string> =>
    Object.fromEntries(
      zones.filter((zone) => zone.id !== zoneId).flatMap((zone) => zone.countries.map((code) => [code, zone.name])),
    );
  const newButton = (
    <Button>
      <Plus /> New zone
    </Button>
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Operations"
        title="Shipping zones"
        description="Zones define where Luxora ships. Vendors set a price per zone: first item, each additional item and an optional free-shipping threshold. Checkout is blocked for any country outside an active zone, and for vendors without a rate for it."
        actions={<ZoneDialog takenBy={takenFor(null)} trigger={newButton} />}
      />
      {zones.length > 0 ? (
        <ul className="grid gap-4">
          {zones.map((zone) => (
            <li
              key={zone.id}
              className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5 md:flex-row md:items-start md:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium text-ink">{zone.name}</h2>
                  <Badge variant={zone.isActive ? "success" : "neutral"}>{zone.isActive ? "Active" : "Inactive"}</Badge>
                </div>
                {zone.description ? <p className="text-sm text-ink-soft">{zone.description}</p> : null}
                <p className="text-sm text-ink-soft">
                  {zone.countries.length
                    ? zone.countries.map((code) => countryName(code)).join(", ")
                    : "No countries yet. Add some so vendors can ship here."}
                </p>
                <p className="text-xs text-ink-faint">
                  {zone.countries.length} countr{zone.countries.length === 1 ? "y" : "ies"} · {zone.vendorCount} vendor
                  {zone.vendorCount === 1 ? "" : "s"} shipping here
                </p>
              </div>
              <div className="flex flex-wrap items-start gap-2">
                <ZoneDialog
                  zone={zone}
                  takenBy={takenFor(zone.id)}
                  trigger={
                    <Button size="sm" variant="outline">
                      <Pencil /> Edit
                    </Button>
                  }
                />
                <ActionButton
                  size="sm"
                  variant="ghost"
                  confirmMessage={
                    zone.isActive
                      ? `Stop shipping to ${zone.name}? Shoppers there will not be able to check out.`
                      : undefined
                  }
                  action={setShippingZoneActive.bind(null, { id: zone.id, active: !zone.isActive })}
                >
                  {zone.isActive ? "Deactivate" : "Activate"}
                </ActionButton>
                {zone.hasRates ? null : (
                  <ActionButton
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    confirmMessage={`Delete the ${zone.name} zone permanently?`}
                    action={deleteShippingZone.bind(null, zone.id)}
                  >
                    Delete
                  </ActionButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<Truck />}
          title="No shipping zones yet"
          description="Luxora does not ship anywhere until you create a zone and add countries to it. Vendors then set their rates for each zone."
          action={<ZoneDialog takenBy={{}} trigger={newButton} />}
        />
      )}
    </div>
  );
}
