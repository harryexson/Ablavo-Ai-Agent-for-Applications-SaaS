import type { OrgRole } from "./schemas";

/**
 * Role-based access control for workspace members. Every signed-up user gets the `owner` role in the
 * workspace they create; invited users get the role chosen by an owner/admin. The API enforces this
 * matrix server-side; the console uses the same matrix to show or hide controls.
 */
export const PERMISSIONS = [
  "workspace.read",
  "workspace.manage",
  "workspace.delete",
  "members.manage",
  "billing.manage",
  "apps.manage",
  "agents.publish",
  "keys.rotate",
  "content.edit",
  "analytics.read",
  "audit.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_INFO: Record<OrgRole, { label: string; description: string; permissions: Permission[] }> = {
  owner: {
    label: "Owner",
    description: "Full control, including billing, deleting the workspace and transferring ownership.",
    permissions: [...PERMISSIONS],
  },
  admin: {
    label: "Admin",
    description: "Manages members, keys, publishing and billing. Cannot delete the workspace.",
    permissions: ["workspace.read", "workspace.manage", "members.manage", "billing.manage", "apps.manage", "agents.publish", "keys.rotate", "content.edit", "analytics.read", "audit.read"],
  },
  developer: {
    label: "Developer",
    description: "Builds applications, agents, knowledge, onboarding, training and actions. Cannot publish or manage billing.",
    permissions: ["workspace.read", "apps.manage", "content.edit", "analytics.read"],
  },
  analyst: {
    label: "Analyst",
    description: "Read-only access to applications, conversations and analytics.",
    permissions: ["workspace.read", "analytics.read"],
  },
  billing: {
    label: "Billing manager",
    description: "Manages plans, invoices and spending caps. Read-only elsewhere.",
    permissions: ["workspace.read", "billing.manage", "analytics.read"],
  },
};

export const can = (role: string | null | undefined, permission: Permission) => Boolean(role && ROLE_INFO[role as OrgRole]?.permissions.includes(permission));
