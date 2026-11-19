/**
 * Product identity is configuration, not code. Everything user-facing reads from here,
 * and every value can be overridden with environment variables at build/runtime.
 */
const env = (typeof process !== "undefined" ? process.env : {}) as Record<string, string | undefined>;

export const brand = {
  name: env.PRODUCT_NAME ?? env.NEXT_PUBLIC_PRODUCT_NAME ?? "Ablavo",
  tagline: "Turn every application into an AI-guided experience.",
  supportEmail: env.SUPPORT_EMAIL ?? "support@example.com",
  salesEmail: env.SALES_EMAIL ?? "sales@example.com",
  /** Prefix for publishable/secret keys, e.g. pk_dev_..., sk_live_... */
  keyPrefix: env.KEY_PREFIX ?? "",
  /** data attribute hosts put on elements they register with the SDK */
  elementAttribute: "data-agent-id",
} as const;
