import { ROUTES } from "@/config/routes";
import { requireUser } from "@/lib/auth/dal";
import { AccountNav } from "@/features/account/components/account-nav";

export default async function AccountLayout({ children }: LayoutProps<"/account">) {
  await requireUser(ROUTES.account.root);
  return (
    <div className="container-editorial grid gap-10 py-12 md:py-16 lg:grid-cols-[14rem_1fr] lg:gap-16">
      <AccountNav />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
