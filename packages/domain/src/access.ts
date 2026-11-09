/**
 * Access policy (docs/spec/overview.md §3 role matrix, decision D-025) — GRASP Information Expert + Protected
 * Variations: the one place that knows which role (or extra right) may do which action. Routes ask
 * `AccessPolicy.can(...)`, the web asks the capability list from /me, so the matrix never drifts between layers.
 *
 * Segregation of duties: Admin configures the system but does not book, credit, close periods, export payroll or
 * approve expenses — those are Finance's transactions. Data scope (whose data) is decided elsewhere
 * (apps/api/src/services/people.ts, projects.ts); this class answers "may this kind of user do this at all".
 */
import { hasRole, type Role } from "./roles.ts";

/** Extra rights granted per person on top of roles (spec: "create if right"). */
export const RIGHTS = ["create_projects"] as const;
export type Right = (typeof RIGHTS)[number];

/** Actions guarded by the matrix. */
export const CAPABILITIES = [
  "project.create",
  "invoice.prepare",
  "invoice.prepare_all",
  "invoice.book",
  "invoice.credit",
  "period.view",
  "period.close",
  "payroll.export",
  "payroll.setup",
  "expense.approve_any",
  "timesheet.approve_unmanaged",
  "audit.read",
  "audit.read_all",
  "gdpr.manage",
  "settings.manage",
  "settings.read",
  "pricelist.manage",
  "people.import",
  "data.import",
  "kpi.company",
  "analytics.token",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Who may do what: roles that always may, and a right that grants it to someone with `rightFor` roles. */
interface Rule {
  roles: Role[];
  right?: { right: Right; rightFor: Role[] };
}

/** The role matrix as data (one row per capability). */
const MATRIX: Record<Capability, Rule> = {
  "project.create": {
    roles: ["finance", "admin"],
    right: { right: "create_projects", rightFor: ["project_manager"] },
  },
  // PMs may prepare drafts for their own projects; that scope check lives in services/invoices.ts.
  "invoice.prepare": { roles: ["finance", "project_manager"] },
  "invoice.prepare_all": { roles: ["finance"] },
  "invoice.book": { roles: ["finance"] },
  "invoice.credit": { roles: ["finance"] },
  "period.view": { roles: ["finance", "management", "admin"] },
  "period.close": { roles: ["finance"] },
  "payroll.export": { roles: ["finance"] },
  "payroll.setup": { roles: ["finance", "admin"] },
  "expense.approve_any": { roles: ["finance"] },
  // People without a line manager (e.g. the CEO) are approved by Finance (spec: "correction only").
  "timesheet.approve_unmanaged": { roles: ["finance"] },
  "audit.read": { roles: ["finance", "management", "admin"] },
  "audit.read_all": { roles: ["management", "admin"] },
  "gdpr.manage": { roles: ["admin"] },
  "settings.manage": { roles: ["admin"] },
  // Finance reads settings and edits finance settings (rates, payroll numbers) — spec "◐ finance settings".
  "settings.read": { roles: ["admin", "finance"] },
  "pricelist.manage": { roles: ["finance", "admin"] },
  "people.import": { roles: ["admin"] },
  "data.import": { roles: ["admin", "finance"] },
  "kpi.company": { roles: ["finance", "management", "admin"] },
  // Personal read-only tokens for Power BI / Excel (D-028) — same people who may read company KPIs.
  "analytics.token": { roles: ["finance", "management", "admin"] },
};

/** Audit entities Finance may read ("financial" in the role matrix); Management and Admin read everything. */
export const FINANCIAL_AUDIT_ENTITIES = [
  "invoice",
  "invoice_line",
  "accounting_period",
  "pay_period",
  "salary_code",
  "price_list",
  "rate",
  "payment_plan",
  "expense",
  "customer",
  "project",
  "timesheet_period",
  "time_entry",
  "employee",
] as const;

/** What one signed-in person may do, from their roles and extra rights. */
export class AccessPolicy {
  /** @param roles the person's roles; @param rights extra rights granted to them */
  constructor(
    readonly roles: readonly Role[],
    readonly rights: readonly Right[] = [],
  ) {}

  /** True when the matrix allows the action for this person. */
  can(capability: Capability): boolean {
    const rule = MATRIX[capability];
    if (hasRole(this.roles, ...rule.roles)) return true;
    return Boolean(
      rule.right && this.rights.includes(rule.right.right) && hasRole(this.roles, ...rule.right.rightFor),
    );
  }

  /** Every capability this person has (sent to the web app so it shows only what the server allows). */
  capabilities(): Capability[] {
    return CAPABILITIES.filter((c) => this.can(c));
  }

  /**
   * Sickness privacy (spec OQ-21, administration.md R6): the reason behind a sensitive absence (sickness, child's
   * sick day) is visible to the employee, their line manager and Finance only. Everyone else sees "Fravær".
   * @param relation how the viewer relates to the employee whose data is shown
   */
  seesAbsenceReason(relation: "self" | "line_manager" | "other"): boolean {
    return relation !== "other" || hasRole(this.roles, "finance");
  }

  /** May this person read audit rows about the given entity type? */
  canReadAudit(entity: string): boolean {
    if (this.can("audit.read_all")) return true;
    return this.can("audit.read") && (FINANCIAL_AUDIT_ENTITIES as readonly string[]).includes(entity);
  }

  /** The matrix row for a capability (for documentation and the admin screen). */
  static rule(capability: Capability): Readonly<Rule> {
    return MATRIX[capability];
  }
}

/** What a sensitive absence is shown as to people who may not see the reason. */
export const MASKED_ABSENCE = { code: "FRAVÆR", nameDa: "Fravær", nameEn: "Absence" } as const;
