"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, CodeBlock, EmptyState, Table, Td, Textarea, Toggle } from "@ablavo/ui";
import { API_PUBLIC_URL, api, fmt, useApi } from "@/lib/api";

interface ActionRow {
  id: string;
  key: string;
  enabled: boolean;
  definition: { name: string; description: string; requiredPermissions: string[]; confirmation: string; riskLevel: string; executionUrl: string };
}
interface Exec {
  id: string;
  actionKey: string;
  status: string;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
}

const EXAMPLE = [
  {
    key: "projects.create",
    name: "Create project",
    description: "Create a new project in the workspace",
    inputSchema: { type: "object", properties: { name: { type: "string", title: "Project name", minLength: 1 } }, required: ["name"] },
    requiredPermissions: ["projects.write"],
    confirmation: "always",
    riskLevel: "low",
    executionUrl: "https://your-app.example.com/agent/actions",
    timeoutMs: 10000,
  },
];

export default function ActionsPage() {
  const { appId } = useParams<{ appId: string }>();
  const actions = useApi<{ data: ActionRow[] }>(`/v1/applications/${appId}/actions`);
  const execs = useApi<{ data: Exec[] }>(`/v1/applications/${appId}/action-executions?limit=20`);
  const [json, setJson] = useState(JSON.stringify(EXAMPLE, null, 2));
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  return (
    <div className="flex flex-col gap-6">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <CardHeader title="Registered actions" description="Tasks the assistant may perform for users. Every run checks the user's permissions from your server, validates inputs, asks for confirmation and is audited." />
        {actions.data?.data.length === 0 ? (
          <EmptyState title="No actions registered" description="Actions are opt-in. Documentation never grants the assistant the ability to act." />
        ) : (
          <Table head={["Action", "Requires", "Safety", "Enabled"]}>
            {actions.data?.data.map((a) => (
              <tr key={a.id}>
                <Td>
                  <div className="font-semibold text-ink">{a.definition.name}</div>
                  <code className="text-[12px] text-ink-3">{a.key}</code>
                </Td>
                <Td>{a.definition.requiredPermissions.join(", ") || "—"}</Td>
                <Td>
                  <Badge tone={a.definition.riskLevel === "high" ? "err" : a.definition.riskLevel === "medium" ? "warn" : "neutral"}>{a.definition.riskLevel} risk</Badge>{" "}
                  <Badge>{a.definition.confirmation === "always" || a.definition.riskLevel === "high" ? "confirms" : "no confirm"}</Badge>
                </Td>
                <Td>
                  <Toggle label={`Enable ${a.key}`} checked={a.enabled} onChange={(v) => void api(`/v1/actions/${a.id}`, { method: "PATCH", body: { enabled: v } }).then(() => actions.reload())} />
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Register or update actions"
            description="Upsert by key. You can also call this from your deploy pipeline with a secret key."
            action={
              <Button
                onClick={async () => {
                  try {
                    const actionsBody = JSON.parse(json);
                    await api(`/v1/applications/${appId}/actions`, { method: "PUT", body: { actions: actionsBody } });
                    setMsg({ tone: "ok", text: "Actions saved. Enable them for the agent on the Agent tab." });
                    void actions.reload();
                  } catch (e) {
                    setMsg({ tone: "err", text: (e as Error).message });
                  }
                }}
              >
                Save actions
              </Button>
            }
          />
          <div className="p-5">
            <Textarea aria-label="Action definitions JSON" value={json} onChange={(e) => setJson(e.target.value)} rows={18} spellCheck={false} className="font-mono text-[12.5px]" />
          </div>
        </Card>
        <Card>
          <CardHeader title="Handle actions on your server" />
          <div className="p-5">
            <CodeBlock
              label="Node.js"
              code={`import crypto from "node:crypto";

// POST ${"{executionUrl}"} — sent by ${API_PUBLIC_URL.replace(/^https?:\/\//, "")}
app.post("/agent/actions", express.text({ type: "*/*" }), (req, res) => {
  const [t, v1] = req.get("x-agent-signature").split(",").map((p) => p.split("=")[1]);
  const expected = crypto.createHmac("sha256", process.env.AGENT_SIGNING_SECRET)
    .update(\`\${t}.\${req.body}\`).digest("hex");
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300 ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1))) {
    return res.status(401).json({ error: "bad signature" });
  }
  const { action, input, user, idempotencyKey } = JSON.parse(req.body);
  // Re-check the user's rights in YOUR database, then do the work once per idempotencyKey.
  if (action === "projects.create") {
    const project = createProject(user.id, input.name);
    return res.json({ id: project.id, name: project.name });
  }
  res.status(400).json({ error: "unknown action" });
});`}
            />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent executions" />
        <Table head={["When", "Action", "Status", "Duration"]}>
          {execs.data?.data.map((e) => (
            <tr key={e.id}>
              <Td>{fmt.date(e.createdAt)}</Td>
              <Td>
                <code className="text-[12px]">{e.actionKey}</code>
              </Td>
              <Td>
                <Badge tone={e.status === "succeeded" ? "ok" : ["failed", "rejected"].includes(e.status) ? "err" : "neutral"}>{e.status.replace("_", " ")}</Badge>
                {e.error && <div className="mt-1 text-[12px] text-err">{e.error}</div>}
              </Td>
              <Td>{e.durationMs ? `${e.durationMs} ms` : "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
