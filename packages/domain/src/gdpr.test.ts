import { describe, expect, it } from "vitest";
import { erasureBlockers, pseudonymFor, retentionCutoff } from "./index.ts";

describe("GDPR rules", () => {
  it("retention: data from fiscal year Y is kept through Y+5", () => {
    expect(retentionCutoff("2032-03-15")).toBe("2027-01-01");
    expect(retentionCutoff("2026-11-09")).toBe("2021-01-01");
  });

  it("pseudonym is stable, not the name, and never a real mailbox", () => {
    const a = pseudonymFor("3f2a9c1e-0000-4000-8000-000000000000");
    expect(a).toEqual(pseudonymFor("3f2a9c1e-0000-4000-8000-000000000000"));
    expect(a.fullName).toBe("Tidligere medarbejder #3F2A9C");
    expect(a.email.endsWith(".invalid")).toBe(true);
  });

  it("an active employee, a PM on active projects or a manager with reports cannot be erased", () => {
    expect(erasureBlockers({ active: true, activeProjectsManaged: 1, directReports: 2 })).toEqual([
      "still_active",
      "manages_active_projects",
      "manages_people",
    ]);
    expect(erasureBlockers({ active: false, activeProjectsManaged: 0, directReports: 0 })).toEqual([]);
  });
});
