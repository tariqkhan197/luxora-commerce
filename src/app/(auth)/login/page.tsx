import type { Metadata } from "next";
import { safeRedirectPath, ROUTES } from "@/config/routes";
import { SignInForm } from "@/features/auth/components/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  verified: "Your email is verified. Sign in to continue.",
  password_updated: "Your password was updated. Please sign in again.",
  signed_out: "You have been signed out.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeRedirectPath(typeof params.next === "string" ? params.next : null, ROUTES.account.root);
  const notice = typeof params.notice === "string" ? NOTICES[params.notice] : null;
  return <SignInForm next={next} notice={notice ?? null} />;
}
