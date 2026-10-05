import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getClientEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Refreshes the Supabase session cookie on every matched request and returns
 * the (validated) user. Must be called from `src/proxy.ts` so that expired
 * access tokens are rotated before Server Components run.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = getClientEnv();

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // getUser() validates the JWT with the Auth server; never trust getSession() here.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
