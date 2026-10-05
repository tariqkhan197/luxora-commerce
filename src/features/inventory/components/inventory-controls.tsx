"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";
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
import { Select } from "@/components/ui/select";
import { applyActionError } from "@/lib/forms/apply-action-error";
import { inventoryAdjustmentSchema, inventorySettingsSchema } from "@/lib/validation";
import type { z } from "zod";
import { adjustInventory, updateInventorySettings } from "@/features/catalog/actions";

const MOVEMENT_TYPES = [
  { value: "restock", label: "Restock (stock received)" },
  { value: "purchase", label: "Purchase from supplier" },
  { value: "return", label: "Customer return accepted" },
  { value: "cancellation", label: "Order cancellation" },
  { value: "manual_adjustment", label: "Manual correction" },
  { value: "damaged", label: "Damaged / written off" },
] as const;

type AdjustInput = z.input<typeof inventoryAdjustmentSchema>;
type AdjustValues = z.output<typeof inventoryAdjustmentSchema>;

export function AdjustStockDialog({ variantId, label, stock }: { variantId: string; label: string; stock: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<AdjustInput, unknown, AdjustValues>({
    resolver: zodResolver(inventoryAdjustmentSchema),
    defaultValues: { variantId, quantityDelta: "", type: "restock", reason: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await adjustInventory(values);
      if (!result.ok) {
        setFormError(applyActionError(form.setError, result.error, ["quantityDelta", "type", "reason"]));
        return;
      }
      form.reset({ variantId, quantityDelta: "", type: "restock", reason: "" });
      setOpen(false);
      router.refresh();
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Adjust stock
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust stock · {label}</DialogTitle>
          <DialogDescription>
            Current stock: {stock}. Use a negative number to remove units. Stock can never go below zero or below
            reserved units.
          </DialogDescription>
        </DialogHeader>
        {formError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id={`delta-${variantId}`}
              label="Change in units"
              error={form.formState.errors.quantityDelta?.message}
            >
              <Input
                type="number"
                inputMode="numeric"
                step={1}
                placeholder="+10 or -2"
                {...form.register("quantityDelta")}
              />
            </FormField>
            <FormField id={`type-${variantId}`} label="Movement type" error={form.formState.errors.type?.message}>
              <Select {...form.register("type")}>
                {MOVEMENT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <FormField id={`reason-${variantId}`} label="Note (optional)" error={form.formState.errors.reason?.message}>
            <Input placeholder="Delivery #4521" {...form.register("reason")} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Apply adjustment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type SettingsInput = z.input<typeof inventorySettingsSchema>;
type SettingsValues = z.output<typeof inventorySettingsSchema>;

interface SettingsProps {
  variantId: string;
  label: string;
  lowStockThreshold: number;
  trackInventory: boolean;
  allowBackorder: boolean;
}

export function InventorySettingsDialog({
  variantId,
  label,
  lowStockThreshold,
  trackInventory,
  allowBackorder,
}: SettingsProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<SettingsInput, unknown, SettingsValues>({
    resolver: zodResolver(inventorySettingsSchema),
    defaultValues: { variantId, lowStockThreshold: String(lowStockThreshold), trackInventory, allowBackorder },
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await updateInventorySettings(values);
      if (!result.ok) {
        setFormError(applyActionError(form.setError, result.error, ["lowStockThreshold"]));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Inventory settings · {label}</DialogTitle>
          <DialogDescription>
            Thresholds drive low-stock alerts; backorders allow sales when stock is exhausted.
          </DialogDescription>
        </DialogHeader>
        {formError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <FormField
            id={`threshold-${variantId}`}
            label="Low-stock threshold"
            error={form.formState.errors.lowStockThreshold?.message}
          >
            <Input type="number" inputMode="numeric" min={0} {...form.register("lowStockThreshold")} />
          </FormField>
          <CheckboxField
            label="Track inventory"
            description="Untracked variants are always purchasable."
            {...form.register("trackInventory")}
          />
          <CheckboxField
            label="Allow backorders"
            description="Customers can buy when stock is zero."
            {...form.register("allowBackorder")}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Save settings
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
