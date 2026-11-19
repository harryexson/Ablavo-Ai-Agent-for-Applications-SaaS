"use client";
import { useParams } from "next/navigation";
import { Alert, Badge } from "@ablavo/ui";
import { AppTabs } from "@/components/Shell";
import { useApi } from "@/lib/api";

interface AppDetail {
  id: string;
  name: string;
  description: string;
  url: string | null;
  role: string;
}

export default function ApplicationLayout({ children }: { children: React.ReactNode }) {
  const { appId } = useParams<{ appId: string }>();
  const app = useApi<AppDetail>(`/v1/applications/${appId}`);
  if (app.error) return <Alert tone="err">{app.error.message}</Alert>;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{app.data?.name ?? "…"}</h1>
        {app.data?.role === "support" && <Badge tone="warn">Read-only support access</Badge>}
        {app.data?.url && (
          <a className="text-sm text-ink-3 hover:text-brand" href={app.data.url} target="_blank" rel="noreferrer">
            {app.data.url} ↗
          </a>
        )}
      </div>
      <AppTabs appId={appId} />
      {children}
    </>
  );
}
