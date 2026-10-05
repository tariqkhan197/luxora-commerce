import { z } from "zod";
import { emailSchema, optionalText, phoneSchema, urlSchema } from "./common";

export const vendorApplicationSchema = z.object({
  businessName: z
    .string()
    .trim()
    .min(2, { error: "Business name must be at least 2 characters." })
    .max(160, { error: "Business name is too long." }),
  businessEmail: emailSchema,
  businessPhone: optionalText(phoneSchema),
  websiteUrl: optionalText(urlSchema),
  description: z
    .string()
    .trim()
    .min(20, { error: "Tell us a little more — at least 20 characters." })
    .max(4000, { error: "Description is too long." }),
  productCategories: z
    .array(z.string().trim().min(1).max(60))
    .max(10, { error: "Choose up to 10 categories." })
    .default([]),
});

export type VendorApplicationInput = z.input<typeof vendorApplicationSchema>;
export type VendorApplicationValues = z.output<typeof vendorApplicationSchema>;
