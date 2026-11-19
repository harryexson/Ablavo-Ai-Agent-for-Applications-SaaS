"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, Field, Input, PageHeader, Select, Textarea } from "@ablavo/ui";
import { type ApiError, api } from "@/lib/api";
import { useSession } from "@/lib/session";

export default function NewApplication() {
  const { orgId } = useSession();
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <PageHeader eyebrow="Step 1 of the setup guide" title="Register an application" description="This is the product your end users will get help inside. You can change everything later." />
      <Card className="max-w-2xl p-6">
        <form
          className="grid gap-5 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError(null);
            try {
              const created = await api<{ id: string; environments: unknown[] }>(`/v1/organizations/${orgId}/applications`, {
                body: {
                  name: f.get("name"),
                  description: f.get("description"),
                  url: f.get("url") || undefined,
                  category: f.get("category"),
                  framework: f.get("framework"),
                  platform: f.get("platform"),
                  languages: String(f.get("languages") || "en").split(",").map((s) => s.trim()).filter(Boolean),
                },
              });
              // Secrets are returned exactly once — keep them only for this browser tab so the next page can show them.
              try {
                sessionStorage.setItem(`newKeys:${created.id}`, JSON.stringify(created.environments));
              } catch {
                /* storage unavailable */
              }
              router.push(`/apps/${created.id}?created=1`);
            } catch (err) {
              setError(err as ApiError);
              setBusy(false);
            }
          }}
        >
          {error && (
            <div className="sm:col-span-2">
              <Alert tone="err">{error.message}</Alert>
            </div>
          )}
          <div className="sm:col-span-2">
            <Field label="Application name" htmlFor="name">
              <Input id="name" name="name" placeholder="Acme CRM" required maxLength={120} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="What does it do?" htmlFor="description" hint="One or two sentences. The assistant uses this as background.">
              <Textarea id="description" name="description" rows={3} maxLength={2000} />
            </Field>
          </div>
          <Field label="Website or app URL" htmlFor="url">
            <Input id="url" name="url" type="url" placeholder="https://app.acme.com" />
          </Field>
          <Field label="Category" htmlFor="category">
            <Select id="category" name="category" defaultValue="saas">
              <option value="saas">Business SaaS</option>
              <option value="productivity">Productivity</option>
              <option value="fintech">Finance</option>
              <option value="health">Health</option>
              <option value="education">Education</option>
              <option value="ecommerce">Commerce</option>
              <option value="devtools">Developer tools</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Platform" htmlFor="platform">
            <Select id="platform" name="platform" defaultValue="web">
              <option value="web">Web</option>
              <option value="mobile">Mobile</option>
              <option value="desktop">Desktop</option>
              <option value="multi">Web and mobile</option>
            </Select>
          </Field>
          <Field label="Framework" htmlFor="framework">
            <Select id="framework" name="framework" defaultValue="react">
              <option value="react">React / Next.js</option>
              <option value="vue">Vue / Nuxt</option>
              <option value="angular">Angular</option>
              <option value="react-native">React Native / Expo</option>
              <option value="vanilla">Plain JavaScript</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Languages" htmlFor="languages" hint="Comma-separated codes, e.g. en, es, fr">
            <Input id="languages" name="languages" defaultValue="en" />
          </Field>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" size="lg" loading={busy}>
              Create application
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
