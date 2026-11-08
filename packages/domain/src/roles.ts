/** Roles are additive (docs/spec/overview.md §3). */
export const ROLES = [
  "employee",
  "project_manager",
  "line_manager",
  "finance",
  "management",
  "admin",
] as const;
export type Role = (typeof ROLES)[number];

export const hasRole = (roles: readonly Role[], ...wanted: Role[]): boolean =>
  wanted.some((r) => roles.includes(r));
