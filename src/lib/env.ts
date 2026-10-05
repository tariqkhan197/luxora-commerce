import { z } from "zod";

/**
 * Environment variable access with validation.
 *
 * - Client-safe variables MUST be prefixed NEXT_PUBLIC_ and are read through
 *   literal `process.env.X` references so Next.js can inline them.
 * - Server-only variables are only read in server modules. The service-role
 *   secret must never be imported into client code; `src/lib/supabase/admin.ts`
 *   guards this with `server-only`.
 *
 * Validation is lazy (on first access) so that `next build` does not require a
 * configured Supabase project for static parts of the application.
 */

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ error: "NEXT_PUBLIC_SUPABASE_URL must be a valid URL" }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(20, { error: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required" }),
  NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
});

const serverSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(20, { error: "SUPABASE_SECRET_KEY is required on the server" }),
});

export type ClientEnv = z.infer<typeof clientSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

export class EnvironmentError extends Error {
  constructor(issues: string[]) {
    super(
      `Invalid environment configuration:\n  - ${issues.join("\n  - ")}\n  See .env.example for the required variables.`,
    );
    this.name = "EnvironmentError";
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

let clientEnv: ClientEnv | undefined;
let serverEnv: ServerEnv | undefined;

export function getClientEnv(): ClientEnv {
  if (clientEnv) return clientEnv;
  const parsed = clientSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
  });
  if (!parsed.success) throw new EnvironmentError(formatIssues(parsed.error));
  clientEnv = parsed.data;
  return clientEnv;
}

export function getServerEnv(): ServerEnv {
  if (serverEnv) return serverEnv;
  const parsed = serverSchema.safeParse({ SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY });
  if (!parsed.success) throw new EnvironmentError(formatIssues(parsed.error));
  serverEnv = parsed.data;
  return serverEnv;
}

/** Returns true when the public Supabase variables are present (used for graceful degradation). */
export function hasSupabaseClientEnv(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

/** Test seam: clears memoised values. */
export function resetEnvCache(): void {
  clientEnv = undefined;
  serverEnv = undefined;
}
