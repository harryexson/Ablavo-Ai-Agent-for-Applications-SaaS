import type { AppManifest } from "@ablavo/shared";
import { parseOpenApi } from "./parse";

export interface DiscoveryInput {
  openapi?: string;
  routes?: { path: string; title?: string }[];
  documentationTitles?: string[];
  uiElements?: { id: string; label: string; route?: string }[];
}

export interface DiscoveryResult {
  manifest: AppManifest;
  confidence: number;
  missing: string[];
  notes: string[];
  proposedActions: { key: string; name: string; description: string; method: string; path: string; confidence: number }[];
  proposedOnboarding: { id: string; title: string; route?: string }[];
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "item";

const titleCase = (s: string) => s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Developer-assisted discovery: proposes a feature map, actions and onboarding steps from the
 * structured inputs a developer provides. Everything it returns is a DRAFT with confidence scores —
 * it must be reviewed and approved before it is used in production. It never claims completeness.
 */
export function discoverManifest(input: DiscoveryInput): DiscoveryResult {
  const features = new Map<string, AppManifest["features"][number]>();
  const notes: string[] = [];
  const proposedActions: DiscoveryResult["proposedActions"] = [];

  const ensureFeature = (name: string, confidence: number) => {
    const id = slug(name);
    const existing = features.get(id);
    if (existing) {
      existing.confidence = Math.min(1, Math.max(existing.confidence ?? 0, confidence) + 0.1);
      return existing;
    }
    const f = { id, name: titleCase(name), description: "", routes: [], requiredPermissions: [], requiredEntitlements: [], dependencies: [], configuration: [], confidence };
    features.set(id, f);
    return f;
  };

  if (input.openapi) {
    try {
      const { operations } = parseOpenApi(input.openapi);
      for (const { method, path, op } of operations) {
        const group = op.tags?.[0] ?? path.split("/").filter((p) => p && !p.startsWith("{") && !/^v\d+$/.test(p))[0] ?? "general";
        const feature = ensureFeature(group, op.tags?.length ? 0.7 : 0.45);
        if (!feature.description && op.description) feature.description = op.description.slice(0, 300);
        if (method !== "GET") {
          const key = slug(op.operationId ?? `${method}-${path}`).replace(/-/g, "_").replace(/^[^a-z]+/, "a_").slice(0, 60);
          proposedActions.push({
            key,
            name: op.summary ?? `${method} ${path}`,
            description: op.description ?? op.summary ?? `${method} ${path}`,
            method,
            path,
            confidence: op.summary ? 0.6 : 0.35,
          });
        }
      }
      notes.push(`Analyzed ${operations.length} API operations.`);
    } catch (err) {
      notes.push(`OpenAPI could not be parsed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const routes: AppManifest["routes"] = [];
  for (const r of input.routes ?? []) {
    const first = r.path.split("/").filter(Boolean)[0] ?? "home";
    const feature = ensureFeature(first, 0.55);
    feature.routes.push(r.path);
    routes.push({ path: r.path, title: r.title ?? titleCase(first), description: "", featureId: feature.id });
  }

  for (const title of input.documentationTitles ?? []) {
    const id = slug(title);
    for (const f of features.values()) if (id.includes(f.id) || f.id.includes(id)) f.confidence = Math.min(1, (f.confidence ?? 0) + 0.15);
  }

  const manifest: AppManifest = {
    version: "1",
    features: [...features.values()],
    routes,
    navigation: routes.map((r) => ({ label: r.title, route: r.path })),
    roles: [],
    permissions: [],
    uiElements: (input.uiElements ?? []).map((e) => ({ id: e.id, label: e.label, route: e.route })),
    integrations: [],
    workflows: [],
  };

  const missing: string[] = [];
  if (!input.openapi) missing.push("No OpenAPI specification — actions cannot be proposed.");
  if (!input.routes?.length) missing.push("No route manifest — the agent cannot map pages to features.");
  if (!input.uiElements?.length) missing.push("No registered UI elements — walkthroughs cannot highlight controls.");
  missing.push("Roles and permissions must be declared by the developer; they are never inferred.");
  for (const f of features.values()) if (!f.description) missing.push(`Feature "${f.name}" has no description.`);

  const confidences = [...features.values()].map((f) => f.confidence ?? 0);
  const confidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;

  return {
    manifest,
    confidence: Math.round(confidence * 100) / 100,
    missing,
    notes,
    proposedActions,
    proposedOnboarding: routes.slice(0, 6).map((r) => ({ id: slug(`visit-${r.title}`), title: `Explore ${r.title}`, route: r.path })),
  };
}
