import type { Metadata } from "next";
import { ROUTES } from "@/config/routes";
import { requireUser } from "@/lib/auth/dal";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

/** Reached from the recovery link after /auth/confirm establishes a session. */
export default async function ResetPasswordPage() {
  await requireUser(ROUTES.auth.resetPassword);
  return <ResetPasswordForm />;
}
