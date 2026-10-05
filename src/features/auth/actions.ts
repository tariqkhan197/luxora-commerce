"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { homeForRole, ROUTES, safeRedirectPath } from "@/config/routes";
import { assertUser } from "@/lib/auth/dal";
import { getClientEnv } from "@/lib/env";
import { AppError, fromAuthError, fromPostgrestError, runAction, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  updateProfileSchema,
} from "@/lib/validation";

/**
 * Authentication Server Actions.
 * Every action re-validates its input with the shared Zod schema — client-side
 * validation is a convenience, never a security boundary.
 */

export async function signUp(input: unknown): Promise<ActionResult<{ requiresEmailVerification: boolean }>> {
  return runAction(async () => {
    const { fullName, email, password } = signUpSchema.parse(input);
    const supabase = await createClient();
    const { NEXT_PUBLIC_SITE_URL } = getClientEnv();

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${NEXT_PUBLIC_SITE_URL}${ROUTES.auth.confirm}?next=${encodeURIComponent(ROUTES.account.root)}`,
      },
    });
    if (error) throw fromAuthError(error);

    // With email confirmation enabled Supabase returns an obfuscated user with no
    // identities when the address is already registered.
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      throw AppError.conflict("An account with this email already exists.");
    }
    return { requiresEmailVerification: !data.session };
  });
}

export async function signIn(input: unknown, next?: string | null): Promise<ActionResult<void>> {
  let destination: string = ROUTES.account.root;
  const result = await runAction(async () => {
    const { email, password } = signInSchema.parse(input);
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw fromAuthError(error);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, status")
      .eq("user_id", data.user.id)
      .single();
    if (profileError) throw fromPostgrestError(profileError);
    if (profile.status !== "active") {
      await supabase.auth.signOut();
      throw AppError.forbidden("This account has been suspended. Please contact support.");
    }
    destination = safeRedirectPath(next, homeForRole(profile.role));
  });
  if (!result.ok) return result;
  redirect(destination);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(ROUTES.home);
}

export async function requestPasswordReset(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const { email } = forgotPasswordSchema.parse(input);
    const supabase = await createClient();
    const { NEXT_PUBLIC_SITE_URL } = getClientEnv();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${NEXT_PUBLIC_SITE_URL}${ROUTES.auth.confirm}?next=${encodeURIComponent(ROUTES.auth.resetPassword)}`,
    });
    // Do not reveal whether the address exists; only surface operational errors.
    if (error && (error.status === 429 || error.code?.includes("rate_limit"))) throw fromAuthError(error);
  });
}

export async function updatePassword(input: unknown): Promise<ActionResult<void>> {
  const result = await runAction(async () => {
    const { password } = resetPasswordSchema.parse(input);
    await assertUser();
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw fromAuthError(error);
  });
  if (!result.ok) return result;
  redirect(`${ROUTES.account.root}?updated=password`);
}

export async function resendVerificationEmail(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const { email } = forgotPasswordSchema.parse(input);
    const supabase = await createClient();
    const { NEXT_PUBLIC_SITE_URL } = getClientEnv();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${NEXT_PUBLIC_SITE_URL}${ROUTES.auth.confirm}` },
    });
    if (error) throw fromAuthError(error);
  });
}

export async function updateProfile(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const { fullName, phone } = updateProfileSchema.parse(input);
    const { profile } = await assertUser();
    const supabase = await createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName, phone: phone ?? null })
      .eq("id", profile.id);
    if (error) throw fromPostgrestError(error);
    revalidatePath(ROUTES.account.root);
  });
}
