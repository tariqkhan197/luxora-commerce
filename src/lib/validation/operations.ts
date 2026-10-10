import { z } from "zod";
import { optionalText, percentageInputSchema, uuidSchema } from "./common";
import { dateTimeInputToIso, optionalDateTime } from "./promotions";

/**
 * Operations (Phase 7): commission rules and customer account status. Mirrors
 * the checks in save_commission_rule / set_account_status (migration 0025);
 * the database stays the final authority.
 */

export const COMMISSION_RULE_SCOPES = ["global", "category", "vendor"] as const;
export type CommissionRuleScope = (typeof COMMISSION_RULE_SCOPES)[number];

export const commissionRuleFormSchema = z
  .object({
    ruleId: optionalText(uuidSchema),
    scope: z.enum(COMMISSION_RULE_SCOPES, { error: "Choose global, category or vendor." }),
    vendorId: optionalText(uuidSchema),
    categoryId: optionalText(uuidSchema),
    name: z
      .string()
      .trim()
      .min(2, { error: "Give the rule a name (2–120 characters)." })
      .max(120, { error: "Give the rule a name (2–120 characters)." }),
    /** Percentage, e.g. "12.5"; 0 to 100. */
    rate: percentageInputSchema,
    startsAt: optionalDateTime,
    endsAt: optionalDateTime,
  })
  .superRefine((data, ctx) => {
    if (data.scope === "vendor" && !data.vendorId) {
      ctx.addIssue({ code: "custom", message: "Choose the vendor this rule applies to.", path: ["vendorId"] });
    }
    if (data.scope === "category" && !data.categoryId) {
      ctx.addIssue({ code: "custom", message: "Choose the category this rule applies to.", path: ["categoryId"] });
    }
    if (data.startsAt && data.endsAt && dateTimeInputToIso(data.endsAt)! <= dateTimeInputToIso(data.startsAt)!) {
      ctx.addIssue({ code: "custom", message: "The end must be after the start.", path: ["endsAt"] });
    }
  })
  .transform((data) => ({
    ...data,
    // Only the target that matches the scope is sent.
    vendorId: data.scope === "vendor" ? data.vendorId : undefined,
    categoryId: data.scope === "category" ? data.categoryId : undefined,
  }));
export type CommissionRuleFormInput = z.input<typeof commissionRuleFormSchema>;
export type CommissionRuleFormValues = z.output<typeof commissionRuleFormSchema>;

export const commissionRuleActiveSchema = z.object({ ruleId: uuidSchema, active: z.boolean() });

export const ACCOUNT_STATUS_CHANGES = ["active", "suspended"] as const;

export const accountStatusSchema = z.object({
  profileId: uuidSchema,
  status: z.enum(ACCOUNT_STATUS_CHANGES),
  reason: z
    .string()
    .trim()
    .min(3, { error: "Give a reason (at least 3 characters)." })
    .max(500, { error: "Keep the reason under 500 characters." }),
  /** The admin ticked "I understand" in the dialog. */
  confirmed: z.literal(true, { error: "Confirm the change." }),
});
export type AccountStatusInput = z.input<typeof accountStatusSchema>;
