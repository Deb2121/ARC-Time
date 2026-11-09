import { describe, expect, it } from "vitest";
import { AccessPolicy } from "./index.ts";

/** The role matrix in docs/spec/overview.md §3 (D-025). */
describe("access policy", () => {
  it("only Finance books, credits, closes periods, exports payroll and approves any expense", () => {
    const finance = new AccessPolicy(["employee", "finance"]);
    const admin = new AccessPolicy(["employee", "admin", "management", "line_manager"]);
    for (const c of [
      "invoice.book",
      "invoice.credit",
      "period.close",
      "payroll.export",
      "expense.approve_any",
    ] as const) {
      expect(finance.can(c)).toBe(true);
      expect(admin.can(c)).toBe(false);
    }
    expect(admin.can("settings.manage")).toBe(true);
    expect(finance.can("settings.manage")).toBe(false);
  });

  it("a project manager creates projects only with the extra right", () => {
    expect(new AccessPolicy(["employee", "project_manager"]).can("project.create")).toBe(false);
    expect(new AccessPolicy(["employee", "project_manager"], ["create_projects"]).can("project.create")).toBe(
      true,
    );
    // the right alone does nothing without the project manager role
    expect(new AccessPolicy(["employee"], ["create_projects"]).can("project.create")).toBe(false);
    expect(new AccessPolicy(["employee", "finance"]).can("project.create")).toBe(true);
  });

  it("sickness reason: employee, line manager and Finance only", () => {
    const mgmt = new AccessPolicy(["employee", "management", "admin"]);
    expect(mgmt.seesAbsenceReason("other")).toBe(false);
    expect(mgmt.seesAbsenceReason("line_manager")).toBe(true);
    expect(mgmt.seesAbsenceReason("self")).toBe(true);
    expect(new AccessPolicy(["employee", "finance"]).seesAbsenceReason("other")).toBe(true);
  });

  it("audit log: Finance financial entities only, Management and Admin everything", () => {
    const finance = new AccessPolicy(["employee", "finance"]);
    expect(finance.canReadAudit("invoice")).toBe(true);
    expect(finance.canReadAudit("user_roles")).toBe(false);
    expect(new AccessPolicy(["employee", "management"]).canReadAudit("user_roles")).toBe(true);
    expect(new AccessPolicy(["employee", "line_manager"]).canReadAudit("invoice")).toBe(false);
  });
});
