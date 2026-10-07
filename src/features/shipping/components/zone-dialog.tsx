"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { COUNTRY_OPTIONS, countryName } from "@/lib/countries";
import { applyActionError } from "@/lib/forms/apply-action-error";
import { shippingZoneSchema, type ShippingZoneInput, type ShippingZoneValues } from "@/lib/validation";
import { saveShippingZone } from "../actions";

const FIELDS = ["name", "description", "position", "countries"] as const;

interface ZoneDialogProps {
  trigger: ReactNode;
  zone?: {
    id: string;
    name: string;
    description: string | null;
    position: number;
    isActive: boolean;
    countries: string[];
  };
  /** Countries assigned to other zones: code → zone name. */
  takenBy: Record<string, string>;
}

export function ZoneDialog({ trigger, zone, takenBy }: ZoneDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const defaults: ShippingZoneInput = {
    id: zone?.id ?? "",
    name: zone?.name ?? "",
    description: zone?.description ?? "",
    position: String(zone?.position ?? 0),
    isActive: zone?.isActive ?? true,
    countries: zone?.countries ?? [],
  };
  const form = useForm<ShippingZoneInput, unknown, ShippingZoneValues>({
    resolver: zodResolver(shippingZoneSchema),
    defaultValues: defaults,
  });
  const { errors } = form.formState;
  const selected = useWatch({ control: form.control, name: "countries" }) ?? [];
  const selectedSet = new Set(selected);
  const id = (name: string) => `${zone?.id ?? "new"}-zone-${name}`;

  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return COUNTRY_OPTIONS;
    return COUNTRY_OPTIONS.filter(
      (country) => country.name.toLowerCase().includes(term) || country.code.toLowerCase() === term,
    );
  }, [filter]);

  function toggle(code: string, checked: boolean) {
    const next = checked ? [...selected, code] : selected.filter((value) => value !== code);
    form.setValue("countries", next, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
  }

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await saveShippingZone(values);
      if (!result.ok) {
        setFormError(applyActionError(form.setError, result.error, FIELDS));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          form.reset(defaults);
          setFormError(null);
          setFilter("");
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{zone ? `Edit ${zone.name}` : "New shipping zone"}</DialogTitle>
          <DialogDescription>
            A zone groups the countries vendors price shipping for. Each country can belong to one zone; countries in no
            active zone cannot be shipped to.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          {formError ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <FormField id={id("name")} label="Name" error={errors.name?.message}>
              <Input placeholder="e.g. Europe" {...form.register("name")} />
            </FormField>
            <FormField id={id("position")} label="Sort position" error={errors.position?.message}>
              <Input inputMode="numeric" {...form.register("position")} />
            </FormField>
          </div>
          <FormField id={id("description")} label="Description (optional)" error={errors.description?.message}>
            <Textarea rows={2} {...form.register("description")} />
          </FormField>

          <div className="grid gap-2">
            <Label htmlFor={id("filter")}>Countries ({selected.length} selected)</Label>
            {selected.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {[...selected].sort().map((code) => (
                  <li key={code}>
                    <button
                      type="button"
                      onClick={() => toggle(code, false)}
                      className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-muted px-2.5 py-0.5 text-xs text-ink hover:border-ink"
                      aria-label={`Remove ${countryName(code)}`}
                    >
                      {countryName(code)} <X className="size-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <Input
              id={id("filter")}
              placeholder="Search countries"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <div className="max-h-60 overflow-y-auto rounded-md border border-line">
              <ul className="divide-y divide-line">
                {visible.map((country) => {
                  const otherZone = takenBy[country.code];
                  return (
                    <li key={country.code} className="px-3 py-2">
                      <CheckboxField
                        label={`${country.name} (${country.code})`}
                        description={otherZone ? `In ${otherZone}` : undefined}
                        checked={selectedSet.has(country.code)}
                        disabled={Boolean(otherZone)}
                        onChange={(event) => toggle(country.code, event.target.checked)}
                      />
                    </li>
                  );
                })}
                {visible.length === 0 ? <li className="px-3 py-2 text-sm text-ink-faint">No matches.</li> : null}
              </ul>
            </div>
            {errors.countries?.message ? (
              <p role="alert" className="text-xs text-danger">
                {errors.countries.message}
              </p>
            ) : null}
          </div>

          <CheckboxField
            label="Active"
            description="Inactive zones are not shipped to, whatever rates vendors have set."
            {...form.register("isActive")}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              {zone ? "Save zone" : "Create zone"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
