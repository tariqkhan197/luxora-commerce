import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnvironmentError, getClientEnv, getServerEnv, hasSupabaseClientEnv, resetEnvCache } from "@/lib/env";

const ORIGINAL = { ...process.env };

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("environment validation", () => {
  beforeEach(() => {
    resetEnvCache();
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: undefined,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
      NEXT_PUBLIC_SITE_URL: undefined,
      SUPABASE_SECRET_KEY: undefined,
    });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
    resetEnvCache();
  });

  it("reports every missing public variable at once", () => {
    expect(hasSupabaseClientEnv()).toBe(false);
    expect(() => getClientEnv()).toThrow(EnvironmentError);
    try {
      getClientEnv();
    } catch (error) {
      expect((error as Error).message).toContain("NEXT_PUBLIC_SUPABASE_URL");
      expect((error as Error).message).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    }
  });

  it("parses valid public configuration and defaults the site URL", () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_1234567890abcdef",
    });
    expect(hasSupabaseClientEnv()).toBe(true);
    expect(getClientEnv()).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_1234567890abcdef",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    });
  });

  it("requires the secret key on the server", () => {
    expect(() => getServerEnv()).toThrow(EnvironmentError);
    setEnv({ SUPABASE_SECRET_KEY: "sb_secret_1234567890abcdef" });
    expect(getServerEnv().SUPABASE_SECRET_KEY).toBe("sb_secret_1234567890abcdef");
  });
});
