"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo, cx } from "@ablavo/ui";

const product = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Ablavo";
const NAV = [
  ["/#product", "Product"],
  ["/#how-it-works", "How it works"],
  ["/pricing", "Pricing"],
  ["/developers", "Developers"],
  ["/security", "Security"],
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    fetch("/api/v1/auth/me", { credentials: "include" })
      .then((r) => setSignedIn(r.ok))
      .catch(() => setSignedIn(false));
  }, []);
  if (["/login", "/signup", "/forgot-password", "/reset-password"].includes(pathname)) return null;
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <a href="/" className="text-ink" aria-label={`${product} home`}>
          <Logo name={product} />
        </a>
        <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Main">
          {NAV.map(([href, label]) => (
            <a key={href} href={href} className={cx("rounded-lg px-3 py-2 text-sm font-medium hover:text-ink", pathname === href ? "text-ink" : "text-ink-2")}>
              {label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {signedIn ? (
            <a href="/console" className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-ink hover:bg-brand/90">
              Open console
            </a>
          ) : (
            <>
              <a href="/login" className="hidden h-9 items-center rounded-lg px-3 text-sm font-semibold text-ink-2 hover:text-ink sm:inline-flex">
                Sign in
              </a>
              <a href="/signup" className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-ink hover:bg-brand/90">
                Start free
              </a>
            </>
          )}
          <button className="rounded-lg p-2 text-ink-2 md:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
            ☰
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-line px-4 py-3 md:hidden" aria-label="Mobile">
          {[...NAV, ["/login", "Sign in"] as const].map(([href, label]) => (
            <a key={href} href={href} className="block rounded-lg px-3 py-2 text-sm font-medium text-ink-2" onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  const pathname = usePathname();
  if (["/login", "/signup", "/forgot-password", "/reset-password"].includes(pathname)) return null;
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div>
          <Logo name={product} className="text-ink" />
          <p className="mt-3 text-sm text-ink-3">AI onboarding, training and in-app assistance for any application.</p>
        </div>
        {[
          ["Product", [["/#product", "Features"], ["/pricing", "Pricing"], ["/#demo", "Live demo"], ["/security", "Security"]]],
          ["Developers", [["/developers", "Developer platform"], ["/api/docs", "API reference"], ["/developers#sdks", "SDKs"], ["/console", "Console"]]],
          ["Company", [["/contact", "Contact sales"], ["/privacy", "Privacy policy"], ["/terms", "Terms of service"]]],
        ].map(([title, links]) => (
          <div key={title as string}>
            <div className="text-sm font-semibold text-ink">{title as string}</div>
            <ul className="mt-3 space-y-2">
              {(links as string[][]).map(([href, label]) => (
                <li key={href}>
                  <a className="text-sm text-ink-3 hover:text-ink" href={href}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line py-6 text-center text-[13px] text-ink-3">
        © {new Date().getFullYear()} {product}. All rights reserved.
      </div>
    </footer>
  );
}
