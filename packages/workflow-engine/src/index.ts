import type { CompletionCriteria, Conditions } from "@ablavo/shared";

export interface Principal {
  roles: string[];
  permissions: string[];
  entitlements: string[];
}

/** Every listed role/permission/entitlement group must be satisfied (roles: any-of, others: all-of). */
export function meetsConditions(principal: Principal, conditions: Conditions | undefined): boolean {
  if (!conditions) return true;
  if (conditions.roles?.length && !conditions.roles.some((r) => principal.roles.includes(r))) return false;
  if (conditions.permissions?.some((p) => !principal.permissions.includes(p))) return false;
  if (conditions.entitlements?.some((e) => !principal.entitlements.includes(e))) return false;
  return true;
}

export function hasAll(have: string[], need: string[]): boolean {
  return need.every((n) => have.includes(n));
}

export type ProgressSignal =
  | { type: "manual"; stepId: string }
  | { type: "event"; event: string }
  | { type: "action"; actionKey: string }
  | { type: "route"; route: string };

/** Matches a host-reported signal against a step's completion criteria. */
export function signalCompletes(criteria: CompletionCriteria, signal: ProgressSignal, stepId: string): boolean {
  switch (criteria.type) {
    case "manual":
      return signal.type === "manual" && signal.stepId === stepId;
    case "event":
      return signal.type === "event" && signal.event === criteria.event;
    case "action":
      return signal.type === "action" && signal.actionKey === criteria.actionKey;
    case "route":
      return signal.type === "route" && routeMatches(criteria.route, signal.route);
  }
}

/** Route patterns support `:param` segments and a trailing `*`. */
export function routeMatches(pattern: string, route: string): boolean {
  const clean = (s: string) => s.split("?")[0]!.replace(/\/+$/, "") || "/";
  const p = clean(pattern).split("/");
  const r = clean(route).split("/");
  for (let i = 0; i < p.length; i++) {
    if (p[i] === "*") return true;
    if (r[i] === undefined) return false;
    if (p[i]!.startsWith(":")) continue;
    if (p[i] !== r[i]) return false;
  }
  return p.length === r.length;
}
