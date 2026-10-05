import { describe, expect, it } from "vitest";
import {
  basisPointsSchema,
  emailSchema,
  moneyMinorSchema,
  passwordSchema,
  percentageInputSchema,
  phoneSchema,
  signUpSchema,
  slugSchema,
  statusSchema,
  updateProfileSchema,
  uuidSchema,
  vendorApplicationSchema,
} from "@/lib/validation";

describe("common schemas", () => {
  it("normalises emails", () => {
    expect(emailSchema.parse("  Jane@Example.COM ")).toBe("jane@example.com");
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
  });

  it("validates phone numbers like the database CHECK", () => {
    expect(phoneSchema.safeParse("+44 20 7946 0958").success).toBe(true);
    expect(phoneSchema.safeParse("(555) 010-2030").success).toBe(true);
    expect(phoneSchema.safeParse("12345").success).toBe(false);
    expect(phoneSchema.safeParse("call me").success).toBe(false);
  });

  it("enforces password strength", () => {
    expect(passwordSchema.safeParse("Correct-Horse1").success).toBe(true);
    expect(passwordSchema.safeParse("short1A").success).toBe(false);
    expect(passwordSchema.safeParse("alllowercase123").success).toBe(false);
  });

  it("validates slugs", () => {
    expect(slugSchema.safeParse("wool-coat-2").success).toBe(true);
    expect(slugSchema.safeParse("Wool Coat").success).toBe(false);
    expect(slugSchema.safeParse("double--hyphen").success).toBe(false);
    expect(slugSchema.safeParse("a").success).toBe(false);
  });

  it("validates ids", () => {
    expect(uuidSchema.safeParse("11111111-1111-4111-8111-111111111111").success).toBe(true);
    expect(uuidSchema.safeParse("123").success).toBe(false);
  });

  it("only accepts integer minor units and basis points", () => {
    expect(moneyMinorSchema.safeParse(1999).success).toBe(true);
    expect(moneyMinorSchema.safeParse(19.99).success).toBe(false);
    expect(moneyMinorSchema.safeParse(-1).success).toBe(false);
    expect(basisPointsSchema.safeParse(10_000).success).toBe(true);
    expect(basisPointsSchema.safeParse(10_001).success).toBe(false);
  });

  it("converts percentage input to basis points exactly", () => {
    expect(percentageInputSchema.parse("12.5")).toBe(1250);
    expect(percentageInputSchema.parse("15")).toBe(1500);
    expect(percentageInputSchema.parse("0.07")).toBe(7);
    expect(percentageInputSchema.safeParse("100.5").success).toBe(false);
    expect(percentageInputSchema.safeParse("12.345").success).toBe(false);
  });

  it("builds status enums", () => {
    const schema = statusSchema(["draft", "active"]);
    expect(schema.safeParse("draft").success).toBe(true);
    expect(schema.safeParse("deleted").success).toBe(false);
  });
});

describe("feature schemas", () => {
  it("validates sign-up input", () => {
    const result = signUpSchema.safeParse({
      fullName: " Jane Doe ",
      email: "JANE@example.com",
      password: "Correct-Horse1",
    });
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data).toEqual({ fullName: "Jane Doe", email: "jane@example.com", password: "Correct-Horse1" });
  });

  it("treats blank optional fields as absent", () => {
    expect(updateProfileSchema.parse({ fullName: "Jane", phone: "" })).toEqual({ fullName: "Jane", phone: undefined });
    expect(updateProfileSchema.safeParse({ fullName: "Jane", phone: "nope" }).success).toBe(false);
  });

  it("validates vendor applications", () => {
    const valid = vendorApplicationSchema.safeParse({
      businessName: "Atelier Nord",
      businessEmail: "hello@atelier.test",
      businessPhone: "",
      websiteUrl: "https://atelier.test",
      description: "Small-batch outerwear made in Copenhagen since 2019.",
    });
    expect(valid.success).toBe(true);
    if (valid.success) expect(valid.data.productCategories).toEqual([]);

    const invalid = vendorApplicationSchema.safeParse({
      businessName: "A",
      businessEmail: "x",
      websiteUrl: "ftp://nope",
      description: "too short",
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      const paths = invalid.error.issues.map((i) => i.path.join("."));
      expect(paths).toEqual(expect.arrayContaining(["businessName", "businessEmail", "websiteUrl", "description"]));
    }
  });
});
