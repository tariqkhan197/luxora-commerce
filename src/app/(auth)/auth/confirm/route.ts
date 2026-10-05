import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { ROUTES, safeRedirectPath } from "@/config/routes";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

/**
 * Target of the links in Supabase email templates:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}&next=/account
 * Verifies the token server-side (PKCE-safe) and establishes the session cookie.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeRedirectPath(searchParams.get("next"), ROUTES.account.root);

  if (!tokenHash || !type || !OTP_TYPES.has(type)) {
    return NextResponse.redirect(new URL(`${ROUTES.auth.error}?reason=invalid_link`, request.url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    const reason = error.code === "otp_expired" ? "expired_link" : "invalid_link";
    return NextResponse.redirect(new URL(`${ROUTES.auth.error}?reason=${reason}`, request.url));
  }

  const destination =
    type === "recovery" ? ROUTES.auth.resetPassword : type === "signup" ? `${ROUTES.auth.login}?notice=verified` : next;
  return NextResponse.redirect(new URL(destination, request.url));
}
