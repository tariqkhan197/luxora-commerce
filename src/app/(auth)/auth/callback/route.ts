import { NextResponse, type NextRequest } from "next/server";
import { ROUTES, safeRedirectPath } from "@/config/routes";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth / PKCE code exchange endpoint. Not used by the email+password flow
 * today, but wired so that adding OAuth providers only requires enabling them
 * in Supabase and rendering a button.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"), ROUTES.account.root);

  if (!code) {
    return NextResponse.redirect(new URL(`${ROUTES.auth.error}?reason=invalid_link`, request.url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL(`${ROUTES.auth.error}?reason=exchange_failed`, request.url));
  }
  return NextResponse.redirect(new URL(next, request.url));
}
