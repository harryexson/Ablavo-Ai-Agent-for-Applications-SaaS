import Ajv, { type ErrorObject } from "ajv";
import type { ActionDefinition } from "@ablavo/shared";
import { signPayload } from "@ablavo/auth";
import { type Principal, hasAll } from "@ablavo/workflow-engine";

const ajv = new Ajv({ allErrors: true, coerceTypes: false, removeAdditional: "all", useDefaults: true, strict: false });
const cache = new Map<string, ReturnType<typeof ajv.compile>>();

function validator(schema: Record<string, unknown>) {
  const key = JSON.stringify(schema);
  let v = cache.get(key);
  if (!v) {
    v = ajv.compile({ additionalProperties: false, ...schema });
    cache.set(key, v);
  }
  return v;
}

export function validateSchema(schema: Record<string, unknown>): string | null {
  try {
    ajv.compile(schema);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export interface InputValidation {
  ok: boolean;
  value: Record<string, unknown>;
  errors: { path: string; message: string }[];
  missing: string[];
}

export function validateInput(definition: ActionDefinition, input: unknown): InputValidation {
  const value = structuredClone((input && typeof input === "object" ? input : {}) as Record<string, unknown>);
  const v = validator(definition.inputSchema);
  const ok = v(value) as boolean;
  const errors = (v.errors ?? []).map((e: ErrorObject) => ({ path: e.instancePath || "/", message: e.message ?? "invalid" }));
  const missing = (v.errors ?? []).filter((e) => e.keyword === "required").map((e) => String((e.params as { missingProperty: string }).missingProperty));
  return { ok, value, errors, missing };
}

export type AuthorizationResult = { allowed: true } | { allowed: false; reason: string; code: "permission" | "entitlement" | "disabled" | "not_allowed_for_agent" };

/** Server-side authorization. Permissions come from the host-verified session, never from the browser. */
export function authorize(
  definition: ActionDefinition,
  principal: Principal,
  opts: { enabled: boolean; agentAllows: boolean },
): AuthorizationResult {
  if (!opts.enabled) return { allowed: false, code: "disabled", reason: "This action is disabled" };
  if (!opts.agentAllows) return { allowed: false, code: "not_allowed_for_agent", reason: "This assistant is not allowed to run this action" };
  if (!hasAll(principal.permissions, definition.requiredPermissions)) {
    const missing = definition.requiredPermissions.filter((p) => !principal.permissions.includes(p));
    return { allowed: false, code: "permission", reason: `Missing permission: ${missing.join(", ")}` };
  }
  if (!hasAll(principal.entitlements, definition.requiredEntitlements)) {
    return { allowed: false, code: "entitlement", reason: "Your plan does not include this feature" };
  }
  return { allowed: true };
}

export function requiresConfirmation(definition: ActionDefinition): boolean {
  return definition.confirmation === "always" || definition.riskLevel === "high";
}

export interface ExecutionRequest {
  executionId: string;
  idempotencyKey: string;
  action: string;
  input: Record<string, unknown>;
  user: { id: string; roles: string[]; tenantId?: string };
  environment: string;
}

export interface ExecutionOutcome {
  ok: boolean;
  status: number;
  output?: Record<string, unknown>;
  error?: string;
  durationMs: number;
  outputValid: boolean;
}

/**
 * Calls the host's action endpoint with a signed request. The host verifies the signature with its
 * environment signing secret, re-checks authorization, performs the work and returns JSON.
 * The secret never leaves the server side.
 */
export async function executeAction(
  definition: ActionDefinition,
  request: ExecutionRequest,
  signingSecret: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExecutionOutcome> {
  const body = JSON.stringify(request);
  const started = Date.now();
  try {
    const res = await fetchImpl(definition.executionUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-signature": signPayload(signingSecret, body),
        "idempotency-key": request.idempotencyKey,
      },
      body,
      signal: AbortSignal.timeout(definition.timeoutMs),
      redirect: "error",
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      return { ok: false, status: res.status, error: "Host returned a non-JSON response", durationMs: Date.now() - started, outputValid: false };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: String(json.error ?? json.message ?? `Host responded ${res.status}`).slice(0, 500), durationMs: Date.now() - started, outputValid: false };
    }
    let outputValid = true;
    if (definition.outputSchema) {
      const v = ajv.compile({ ...definition.outputSchema });
      outputValid = v(json) as boolean;
    }
    return { ok: outputValid, status: res.status, output: json, durationMs: Date.now() - started, outputValid, ...(outputValid ? {} : { error: "Host response did not match the declared output schema" }) };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { ok: false, status: 0, error: timedOut ? `Timed out after ${definition.timeoutMs}ms` : err instanceof Error ? err.message : String(err), durationMs: Date.now() - started, outputValid: false };
  }
}

/** Safe tool name for LLM function calling (`.` is not allowed by every provider). */
export const toolNameFor = (key: string) => `action__${key.replace(/\./g, "__")}`;
export const keyFromToolName = (name: string) => (name.startsWith("action__") ? name.slice(8).replace(/__/g, ".") : null);
