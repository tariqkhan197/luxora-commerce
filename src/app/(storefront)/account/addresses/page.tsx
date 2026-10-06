import type { Metadata } from "next";
import { MapPin, Plus } from "lucide-react";
import { ActionButton } from "@/components/shared/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { deleteAddress } from "@/features/addresses/actions";
import { AddressSummary } from "@/features/addresses/components/address-card";
import { AddressDialog } from "@/features/addresses/components/address-dialog";
import { listAddresses } from "@/features/addresses/queries";
import { requireUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Addresses" };

export default async function AddressesPage() {
  const { profile } = await requireUser(ROUTES.account.addresses);
  const addresses = await listAddresses(profile.id);
  const addButton = (
    <AddressDialog
      defaultCountry={addresses[0]?.country_code ?? "US"}
      trigger={
        <Button>
          <Plus /> Add address
        </Button>
      }
    />
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Account"
        title="Addresses"
        description="Saved addresses for shipping and billing. Past orders keep the address they were placed with."
        actions={addresses.length ? addButton : null}
      />
      {addresses.length === 0 ? (
        <EmptyState
          icon={<MapPin />}
          title="No saved addresses"
          description="Add an address to speed up checkout."
          action={addButton}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {addresses.map((address) => (
            <li
              key={address.id}
              className="flex flex-col justify-between gap-4 rounded-lg border border-line bg-surface p-5"
            >
              <AddressSummary address={address} />
              <div className="flex flex-wrap items-center gap-2">
                <AddressDialog
                  address={address}
                  trigger={
                    <Button size="sm" variant="outline">
                      Edit
                    </Button>
                  }
                />
                <ActionButton
                  size="sm"
                  variant="ghost"
                  className="text-danger hover:bg-danger-soft"
                  confirmMessage="Delete this address?"
                  action={deleteAddress.bind(null, address.id)}
                >
                  Delete
                </ActionButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
