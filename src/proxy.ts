import { NextResponse, type NextRequest } from "next/server";
import { AUTH_ONLY_PATHS, isProtectedPath, ROUTES } from "@/config/routes";
import { hasSupabaseClientEnv } from "@/lib/env";
import { updateSession } from "@/lib/supabase/proxy-session";

/**
 * Edge of the application:
 *  1. refreshes the Supabase auth session cookies,
 *  2. redirects anonymous visitors away from protected areas,
 *  3. redirects signed-in users away from the auth pages.
 *
 * Role-based authorization is NOT decided here. Layouts verify roles against
 * the database (`requireRole`), and the database enforces RLS regardless.
 */
export async function proxy(request: NextRequest) {
  if (!hasSupabaseClientEnv()) {
    // Misconfigured deployment: let the request through so the error boundary
    // can render a meaningful message instead of failing silently here.
    return NextResponse.next({ request });
  }

  const { response, user } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  if (!user && isProtectedPath(pathname)) {
    const loginUrl = new URL(ROUTES.auth.login, request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (user && AUTH_ONLY_PATHS.has(pathname)) {
    return NextResponse.redirect(new URL(ROUTES.account.root, request.url));
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except Next internals, static assets and common files.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};
