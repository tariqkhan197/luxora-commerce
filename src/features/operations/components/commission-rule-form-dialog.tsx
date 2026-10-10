"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import {
  commissionRuleFormSchema,
  type CommissionRuleFormInput,
  type CommissionRuleFormValues,
} from "@/lib/validation";
import { saveCommissionRule } from "../actions";
import { COMMISSION_SCOPE_LABELS } from "../state";

export interface TargetOption {
  id: string;
  name: string;
}

interface CommissionRuleFormDialogProps {
  vendors: TargetOption[];
  /** Categories in tree order, names already indented. */
  categories: TargetOption[];
  /** Existing rule (form values) to edit; omitted to create one. */
  initial?: CommissionRuleFormInput & { ruleId: string; targetName: string };
}

const EMPTY: CommissionRuleFormInput = {
  scope: "category",
  vendorId: "",
  categoryId: "",
  name: "",
  rate: "",
  startsAt: "",
  endsAt: "",
};

const FIELDS = ["scope", "vendorId", "categoryId", "name", "rate", "startsAt", "endsAt"] as const;

/** Create or edit a commission rule. The database re-checks every rule, including overlaps. */
export function CommissionRuleFormDialog({ vendors, categories, initial }: CommissionRuleFormDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const defaults: CommissionRuleFormInput = initial ?? EMPTY;
  const form = useForm<CommissionRuleFormInput, unknown, CommissionRuleFormValues>({
    resolver: zodResolver(commissionRuleFormSchema),
    defaultValues: defaults,
  });
  const { errors } = form.formState;
  const scope = useWatch({ control: form.control, name: "scope" });
  const id = initial?.ruleId ?? "new-rule";

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await saveCommissionRule(values);
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
        }
      }}
    >
      <DialogTrigger asChild>
        {initial ? (
          <Button size="sm" variant="outline">
            Edit
          </Button>
        ) : (
          <Button size="sm">
            <Plus /> New rule
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit commission rule" : "New commission rule"}</DialogTitle>
          <DialogDescription>
            The rate applies to orders placed while the rule is in effect. Orders already placed keep the rate they were
            placed with. Two active rules for the same target cannot overlap.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          {formError ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          {initial ? (
            <>
              <input type="hidden" {...form.register("scope")} />
              <input type="hidden" {...form.register("vendorId")} />
              <input type="hidden" {...form.register("categoryId")} />
              <p className="text-sm text-ink-soft">
                Applies to: <span className="text-ink">{COMMISSION_SCOPE_LABELS[initial.scope ?? "global"]}</span> ·{" "}
                <span className="text-ink">{initial.targetName}</span>. A rule&rsquo;s target cannot change; deactivate
                it and create a new rule instead.
              </p>
            </>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id={`${id}-scope`} label="Applies to" error={errors.scope?.message}>
                <Select {...form.register("scope")}>
                  <option value="category">A category (and its subcategories)</option>
                  <option value="vendor">A vendor</option>
                  <option value="global">All products</option>
                </Select>
              </FormField>
              {scope === "vendor" ? (
                <FormField id={`${id}-vendor`} label="Vendor" error={errors.vendorId?.message}>
                  <Select {...form.register("vendorId")}>
                    <option value="">Choose a vendor</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>
                        {vendor.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : scope === "category" ? (
                <FormField id={`${id}-category`} label="Category" error={errors.categoryId?.message}>
                  <Select {...form.register("categoryId")}>
                    <option value="">Choose a category</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : null}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id={`${id}-name`} label="Name (internal)" error={errors.name?.message}>
              <Input maxLength={120} {...form.register("name")} />
            </FormField>
            <FormField id={`${id}-rate`} label="Commission (%)" hint="0 to 100, e.g. 12.5" error={errors.rate?.message}>
              <Input inputMode="decimal" {...form.register("rate")} />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id={`${id}-starts`}
              label="Starts (UTC)"
              hint={initial ? undefined : "Leave empty to start now"}
              error={errors.startsAt?.message}
            >
              <Input type="datetime-local" {...form.register("startsAt")} />
            </FormField>
            <FormField id={`${id}-ends`} label="Ends (UTC, optional)" error={errors.endsAt?.message}>
              <Input type="datetime-local" {...form.register("endsAt")} />
            </FormField>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              {initial ? "Save changes" : "Create rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
