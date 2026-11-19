export type ErrorCode =
  | "bad_request" | "validation_failed" | "unauthenticated" | "forbidden" | "not_found" | "conflict"
  | "rate_limited" | "entitlement_exceeded" | "payment_required" | "email_not_verified"
  | "provider_unavailable" | "action_failed" | "confirmation_required" | "internal";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400, validation_failed: 422, unauthenticated: 401, forbidden: 403, not_found: 404,
  conflict: 409, rate_limited: 429, entitlement_exceeded: 402, payment_required: 402,
  email_not_verified: 403, provider_unavailable: 503, action_failed: 502, confirmation_required: 409,
  internal: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, message: string, readonly details?: unknown) {
    super(message);
    this.status = STATUS[code];
  }
  toJSON() {
    return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
  }
}

export const notFound = (what = "Resource") => new AppError("not_found", `${what} not found`);
export const forbidden = (msg = "You do not have permission to do that") => new AppError("forbidden", msg);
