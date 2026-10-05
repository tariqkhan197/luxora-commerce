import { Logo } from "@/components/shared/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-ink text-canvas lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,oklch(58%_0.085_75/0.35),transparent_55%),radial-gradient(ellipse_at_bottom_right,oklch(40%_0.03_60/0.6),transparent_60%)]"
        />
        <Logo className="relative text-canvas" />
        <blockquote className="relative max-w-md">
          <p className="display-2 text-canvas">Independent brands. One considered marketplace.</p>
          <p className="mt-6 text-sm leading-relaxed text-canvas/70">
            Luxora brings together ateliers, labels and makers under a single, carefully curated storefront.
          </p>
        </blockquote>
        <p className="relative text-xs tracking-[0.14em] text-canvas/50 uppercase">Est. 2026</p>
      </aside>
      <main className="flex flex-col">
        <div className="container-editorial flex h-16 items-center lg:hidden">
          <Logo />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8 lg:px-16">{children}</div>
      </main>
    </div>
  );
}
