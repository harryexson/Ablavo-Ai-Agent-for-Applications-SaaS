"use client";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Field, Input, Logo, Select, cx } from "@ablavo/ui";
import { api, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";

const product = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Ablavo";
const docsUrl = `${process.env.NEXT_PUBLIC_MARKETING_URL ?? ""}/developers`;

interface AppRow {
  id: string;
  name: string;
}

function NavLink({ href, children, active }: { href: string; children: ReactNode; active: boolean }) {
  return (
    <a href={href} aria-current={active ? "page" : undefined} className={cx("flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium", active ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-muted hover:text-ink")}>
      {children}
    </a>
  );
}

function CreateOrganization() {
  const { refresh, setOrgId } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4">
      <Logo name={product} className="mb-6 text-ink" />
      <Card className="p-7">
        <h1 className="font-display text-xl font-bold">Create your workspace</h1>
        <p className="mt-1 text-sm text-ink-2">A workspace holds your applications, assistants, team and billing.</p>
        <form
          className="mt-6 flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            try {
              const org = await api<{ id: string }>("/v1/organizations", { body: { name: f.get("name"), type: f.get("type") } });
              await refresh();
              setOrgId(org.id);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {error && <Alert tone="err">{error}</Alert>}
          <Field label="Workspace name" htmlFor="org-name">
            <Input id="org-name" name="name" placeholder="Acme Inc." required />
          </Field>
          <Field label="What describes you best?" htmlFor="org-type">
            <Select id="org-type" name="type" defaultValue="saas">
              <option value="developer">Independent developer</option>
              <option value="saas">SaaS company</option>
              <option value="enterprise">Enterprise</option>
              <option value="agency">Agency / software studio</option>
            </Select>
          </Field>
          <Button type="submit" size="lg" loading={busy}>
            Create workspace
          </Button>
        </form>
      </Card>
    </main>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { me, loading, org, orgId, setOrgId } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const apps = useApi<{ data: AppRow[] }>(orgId ? `/v1/organizations/${orgId}/applications` : null);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!loading && !me) location.href = `/login?next=${encodeURIComponent(`/console${pathname}`)}`;
    else if (!loading && me && !me.user.emailVerified) router.replace("/verify-email");
  }, [loading, me, pathname, router]);

  if (loading || !me || !me.user.emailVerified) return <div className="grid min-h-screen place-items-center text-sm text-ink-3">Loading…</div>;
  if (!me.organizations.length) return <CreateOrganization />;

  const appMatch = pathname.match(/^\/apps\/(app_[a-z0-9]+)/);
  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label="Main">
      <div className="mb-3 px-2 pt-2">
        <Logo name={product} className="text-ink" />
      </div>
      <label className="sr-only" htmlFor="org-switch">
        Workspace
      </label>
      <Select id="org-switch" value={orgId ?? ""} onChange={(e) => setOrgId(e.target.value)} className="mb-3">
        {me.organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
      <NavLink href="/console" active={pathname === "/"}>
        Overview
      </NavLink>
      <div className="mt-3 px-3 text-[11px] font-bold uppercase tracking-wider text-ink-3">Applications</div>
      {apps.data?.data.map((a) => (
        <NavLink key={a.id} href={`/console/apps/${a.id}`} active={appMatch?.[1] === a.id}>
          <span className="truncate">{a.name}</span>
        </NavLink>
      ))}
      <NavLink href="/console/apps/new" active={pathname === "/apps/new"}>
        <span className="text-brand">+ New application</span>
      </NavLink>
      <div className="mt-3 px-3 text-[11px] font-bold uppercase tracking-wider text-ink-3">Workspace</div>
      <NavLink href="/console/billing" active={pathname.startsWith("/billing")}>
        Billing &amp; usage
      </NavLink>
      <NavLink href="/console/team" active={pathname.startsWith("/team")}>
        Team
      </NavLink>
      <NavLink href="/console/account" active={pathname.startsWith("/account")}>
        Your account
      </NavLink>
      <NavLink href="/console/settings" active={pathname.startsWith("/settings")}>
        Settings
      </NavLink>
      <NavLink href={docsUrl} active={false}>
        Documentation ↗
      </NavLink>
      <div className="mt-auto border-t border-line px-2 pt-3 text-[13px]">
        <div className="truncate font-semibold text-ink">{me.user.name}</div>
        <div className="truncate text-ink-3">{me.user.email}</div>
        <div className="mt-2 flex items-center gap-2">
          {org && <Badge tone="brand">{org.planName}</Badge>}
          <button
            className="ml-auto text-ink-3 hover:text-ink"
            onClick={async () => {
              await api("/v1/auth/logout", { body: {} });
              location.href = "/login";
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside className="sticky top-0 hidden h-screen w-64 flex-none border-r border-line bg-surface lg:block">{sidebar}</aside>
      <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
        <Logo name={product} className="text-ink" />
        <Button variant="secondary" size="sm" onClick={() => setMenu(!menu)} aria-expanded={menu}>
          Menu
        </Button>
      </div>
      {menu && <div className="border-b border-line bg-surface lg:hidden">{sidebar}</div>}
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

export function AppTabs({ appId }: { appId: string }) {
  const pathname = usePathname();
  const tabs = [
    ["", "Setup"],
    ["/agent", "Agent"],
    ["/knowledge", "Knowledge"],
    ["/manifest", "App map"],
    ["/onboarding", "Onboarding"],
    ["/training", "Training"],
    ["/actions", "Actions"],
    ["/analytics", "Analytics"],
  ] as const;
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Application">
      {tabs.map(([p, label]) => {
        const href = `/apps/${appId}${p}`; // basePath-relative, for matching usePathname()
        const active = pathname === href;
        return (
          <a key={p} href={`/console${href}`} aria-current={active ? "page" : undefined} className={cx("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold", active ? "border-brand text-ink" : "border-transparent text-ink-3 hover:text-ink")}>
            {label}
          </a>
        );
      })}
    </nav>
  );
}
