import type { AppManifest, ClientContext } from "@ablavo/shared";
import { routeMatches } from "@ablavo/workflow-engine";

export interface ResolvedContext {
  route: string | null;
  page: { path: string; title: string; description: string } | null;
  features: AppManifest["features"];
  /** Only elements the developer registered in the approved manifest, filtered to this route */
  elements: AppManifest["uiElements"];
  /** Element ids the client claimed are visible but that are not registered — ignored, reported for diagnostics */
  unknownElements: string[];
  activeWorkflow: AppManifest["workflows"][number] | null;
}

/**
 * Turns the browser's context hints into verified context using ONLY the approved manifest.
 * Anything the client sends that the manifest does not know about is dropped, so the agent can
 * never be steered into describing controls that do not exist.
 */
export function resolveContext(manifest: AppManifest | null, ctx: ClientContext): ResolvedContext {
  const route = ctx.route ?? null;
  if (!manifest) return { route, page: null, features: [], elements: [], unknownElements: ctx.visibleElements ?? [], activeWorkflow: null };

  const page = route ? manifest.routes.find((r) => routeMatches(r.path, route)) ?? null : null;
  const featureIds = new Set<string>();
  if (page?.featureId) featureIds.add(page.featureId);
  if (ctx.featureId && manifest.features.some((f) => f.id === ctx.featureId)) featureIds.add(ctx.featureId);
  if (route) for (const f of manifest.features) if (f.routes.some((r) => routeMatches(r, route))) featureIds.add(f.id);

  const registered = new Map(manifest.uiElements.map((e) => [e.id, e]));
  const visible = ctx.visibleElements ?? [];
  const unknownElements = visible.filter((id) => !registered.has(id));
  const onRoute = manifest.uiElements.filter((e) => (e.route && route ? routeMatches(e.route, route) : false) || visible.includes(e.id) || (e.featureId ? featureIds.has(e.featureId) : false));

  return {
    route,
    page: page ? { path: page.path, title: page.title, description: page.description } : null,
    features: manifest.features.filter((f) => featureIds.has(f.id)),
    elements: onRoute,
    unknownElements,
    activeWorkflow: ctx.activeWorkflow ? manifest.workflows.find((w) => w.id === ctx.activeWorkflow) ?? null : null,
  };
}

export function describeContext(rc: ResolvedContext): string {
  const lines: string[] = [];
  if (rc.page) lines.push(`Current page: ${rc.page.title} (${rc.page.path})${rc.page.description ? ` — ${rc.page.description}` : ""}`);
  else if (rc.route) lines.push(`Current route: ${rc.route} (not described in the manifest)`);
  for (const f of rc.features) {
    lines.push(`Feature: ${f.name} — ${f.description}`);
    for (const c of f.configuration) lines.push(`  Setting "${c.label}": ${c.description}`);
  }
  if (rc.elements.length) lines.push(`Registered controls on this page: ${rc.elements.map((e) => `${e.label} [${e.id}]`).join(", ")}`);
  if (rc.activeWorkflow) lines.push(`Active workflow: ${rc.activeWorkflow.name} — steps: ${rc.activeWorkflow.steps.join(" → ")}`);
  return lines.join("\n");
}
