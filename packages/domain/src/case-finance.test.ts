import { describe, expect, it } from "vitest";
import {
  AccessPolicy,
  acontoSuggestion,
  ageingBucket,
  ageingSummary,
  type CaseEntry,
  caseFinance,
  caseStatus,
  debt,
  feeLevel,
  feeTypeOf,
  feeWarningText,
  instalmentAmounts,
  instalmentStatuses,
  kr,
  nextInstalment,
  nextReminderError,
  overdueText,
  type PlanInstalment,
  paymentError,
  sumRows,
  validatePlan,
} from "./index.ts";

const FEE = kr(600_000);
const pct = (id: string, sequence: number, percentageBp: number, plannedDate: string, invoiced = false) =>
  ({ id, sequence, percentageBp, amount: null, plannedDate, invoiced }) satisfies PlanInstalment;

const entry = (over: Partial<CaseEntry>): CaseEntry => ({
  userId: "u1",
  taskId: "t1",
  hours: 100,
  salesRate: kr(1_000),
  costRate: kr(400),
  billable: true,
  status: "approved",
  timeAndMaterial: false,
  ...over,
});

describe("billing plan (faktureringsplan)", () => {
  it("AC: 20/30/25/25 % of 600.000 kr adds up to 100 % and can be saved; 20/30/25 % is rejected", () => {
    const ok = [
      pct("a", 1, 2000, "2026-09-01"),
      pct("b", 2, 3000, "2026-11-01"),
      pct("c", 3, 2500, "2027-01-15"),
      pct("d", 4, 2500, "2027-04-01"),
    ];
    expect(validatePlan(FEE, ok)).toEqual({ ok: true, totalBp: 10_000, total: FEE });
    expect([...instalmentAmounts(FEE, ok).values()]).toEqual([
      kr(120_000),
      kr(180_000),
      kr(150_000),
      kr(150_000),
    ]);

    const short = validatePlan(FEE, ok.slice(0, 3));
    expect(short).toMatchObject({ ok: false, code: "plan_not_100_percent", totalBp: 7_500 });
  });

  it("accepts fixed amounts and mixed plans when they total the fee exactly; rejects empty and zero shares", () => {
    const mixed: PlanInstalment[] = [
      pct("a", 1, 5000, "2026-09-01"),
      {
        id: "b",
        sequence: 2,
        percentageBp: null,
        amount: kr(300_000),
        plannedDate: "2026-12-01",
        invoiced: false,
      },
    ];
    expect(validatePlan(FEE, mixed).ok).toBe(true);
    expect(validatePlan(FEE, [])).toMatchObject({ ok: false, code: "plan_empty" });
    expect(validatePlan(FEE, [pct("a", 1, 0, "2026-09-01")])).toMatchObject({ code: "plan_invalid_share" });
  });

  it("puts the rounding difference on the last instalment so the plan totals the fee to the øre", () => {
    const thirds = [
      pct("a", 1, 3333, "2026-01-01"),
      pct("b", 2, 3333, "2026-02-01"),
      pct("c", 3, 3334, "2026-03-01"),
    ];
    const amounts = [...instalmentAmounts(kr(1_000.01), thirds).values()];
    expect(amounts.reduce((a, v) => a + v, 0)).toBe(kr(1_000.01));
  });

  it("AC: instalment 2 is klar on its planned date once 1 is invoiced; 3 stays afventer until 2 is invoiced", () => {
    const plan = [
      pct("r1", 1, 2000, "2026-09-01", true),
      pct("r2", 2, 3000, "2026-11-10"),
      pct("r3", 3, 2500, "2026-11-01"),
      pct("r4", 4, 2500, "2027-04-01"),
    ];
    expect(Object.fromEntries(instalmentStatuses(plan, "2026-11-09"))).toEqual({
      r1: "faktureret",
      r2: "planlagt",
      r3: "afventer",
      r4: "afventer",
    });
    // On the planned date it becomes klar; r3's date has passed, but it still waits for r2.
    expect(instalmentStatuses(plan, "2026-11-10").get("r2")).toBe("klar");
    expect(instalmentStatuses(plan, "2026-11-10").get("r3")).toBe("afventer");
    // Once r2 is invoiced, r3 (date already passed) is klar.
    const after = plan.map((i) => (i.id === "r2" ? { ...i, invoiced: true } : i));
    expect(instalmentStatuses(after, "2026-11-10").get("r3")).toBe("klar");
    expect(nextInstalment(after)?.id).toBe("r3");
  });

  it("an instalment whose phase the PM marked done (or marked ready) is klar regardless of order and date", () => {
    const plan = [pct("r1", 1, 5000, "2027-01-01"), { ...pct("r2", 2, 5000, "2027-06-01"), phaseDone: true }];
    expect(Object.fromEntries(instalmentStatuses(plan, "2026-11-10"))).toEqual({
      r1: "planlagt",
      r2: "klar",
    });
  });

  it("a conto: phase fee × % complete − already invoiced, never negative", () => {
    expect(acontoSuggestion(kr(100_000), 4000, kr(25_000))).toBe(kr(15_000));
    expect(acontoSuggestion(kr(100_000), 2000, kr(25_000))).toBe(0);
    expect(() => acontoSuggestion(kr(100_000), 12_000, 0)).toThrow(RangeError);
  });
});

describe("case finance (sagsøkonomi)", () => {
  it("maps contract types to honorarform; retainer counts as fast honorar", () => {
    expect(feeTypeOf("time_material")).toBe("medgaaet_tid");
    expect(feeTypeOf("fixed_price")).toBe("fast_honorar");
    expect(feeTypeOf("retainer")).toBe("fast_honorar");
  });

  it("AC: 454.700 kr consumed on a 600.000 kr fee shows the warning '76 % af honorar forbrugt'", () => {
    // 454,70 h × 1.000 kr = 454.700 kr
    const f = caseFinance({
      feeType: "fast_honorar",
      fee: FEE,
      entries: [entry({ hours: 45_470 })],
      invoicedTotal: kr(120_000),
      invoicedAgainstFee: kr(120_000),
    });
    expect(f.forbrugt).toBe(kr(454_700));
    expect(f.forbrugtPct).toBe(7578);
    expect(f.feeLevel).toBe("warning");
    expect(feeWarningText(f.forbrugtPct ?? 0)).toBe("76 % af honorar forbrugt");
    expect(f.resthonorar).toBe(kr(480_000));
    expect(caseStatus(f, 0)).toBe("overskridelsesrisiko");
  });

  it("alert above 100 %, configurable thresholds", () => {
    expect(feeLevel(10_001)).toBe("alert");
    expect(feeLevel(10_000)).toBe("warning");
    expect(feeLevel(7_499)).toBe("ok");
    expect(feeLevel(8_000, { warningBp: 8_500, alertBp: 11_000 })).toBe("ok");
  });

  it("AC: on medgået tid, 30 h × 1.000 kr approved and uninvoiced is 30.000 kr ikke faktureret, 0 once booked", () => {
    const hours = entry({ hours: 3_000, timeAndMaterial: true });
    const before = caseFinance({
      feeType: "medgaaet_tid",
      fee: null,
      entries: [hours],
      invoicedTotal: 0,
      invoicedAgainstFee: 0,
    });
    expect(before.ikkeFaktureret).toBe(kr(30_000));
    expect(caseStatus(before, 0)).toBe("kan_faktureres");
    const booked = caseFinance({
      feeType: "medgaaet_tid",
      fee: null,
      entries: [{ ...hours, status: "invoiced" }],
      invoicedTotal: kr(30_000),
      invoicedAgainstFee: 0,
    });
    expect(booked.ikkeFaktureret).toBe(0);
    expect(booked.faktureret).toBe(kr(30_000));
    expect(booked.fee).toBeNull();
    expect(caseStatus(booked, 0)).toBe("ajour");
  });

  it("AC: ekstraarbejde hours on a fixed fee go to the medgået tid suggestion, not against the fee", () => {
    const f = caseFinance({
      feeType: "fast_honorar",
      fee: FEE,
      entries: [entry({ hours: 10_000 }), entry({ taskId: "extra", hours: 1_000, timeAndMaterial: true })],
      invoicedTotal: 0,
      invoicedAgainstFee: 0,
    });
    expect(f.forbrugt).toBe(kr(110_000)); // all hours count as consumed on the case
    expect(f.forbrugtPct).toBe(1667); // but only 100.000 kr against the fee
    expect(f.ikkeFaktureret).toBe(kr(10_000)); // the extra work is invoiceable as hours
    expect(f.hours.byTask.get("extra")).toBe(1_000);
  });

  it("hours per phase and per employee, kostpris, and non-billable hours count as hours and cost only", () => {
    const f = caseFinance({
      feeType: "medgaaet_tid",
      fee: null,
      entries: [
        entry({ userId: "a", taskId: "t1", hours: 750, timeAndMaterial: true }),
        entry({
          userId: "b",
          taskId: "t2",
          hours: 250,
          timeAndMaterial: true,
          billable: false,
          status: "draft",
        }),
      ],
      invoicedTotal: 0,
      invoicedAgainstFee: 0,
    });
    expect(f.hours.total).toBe(1_000);
    expect(Object.fromEntries(f.hours.byUser)).toEqual({ a: 750, b: 250 });
    expect(Object.fromEntries(f.forbrugtByTask)).toEqual({ t1: kr(7_500) });
    expect(f.forbrugt).toBe(kr(7_500));
    expect(f.kostpris).toBe(kr(4_000));
  });

  it("status priority: overskredet → risiko → rate klar → kan faktureres → ajour", () => {
    expect(caseStatus({ feeLevel: "alert", ikkeFaktureret: 1 }, 1)).toBe("honorar_overskredet");
    expect(caseStatus({ feeLevel: "ok", ikkeFaktureret: 1 }, 1)).toBe("rate_klar");
    expect(caseStatus({ feeLevel: null, ikkeFaktureret: 0 }, 0)).toBe("ajour");
  });

  it("AC: the totals row equals the sum of the visible (filtered) rows", () => {
    const rows = [
      { forbrugt: 100, rest: 50 as number | null },
      { forbrugt: 200, rest: null },
      { forbrugt: 300, rest: 25 },
    ];
    const visible = rows.filter((r) => r.forbrugt >= 200);
    expect(sumRows(visible, ["forbrugt", "rest"])).toEqual({ forbrugt: 500, rest: 25 });
  });
});

describe("debtor list (debitorliste)", () => {
  it("AC: due 4. nov. 2026, viewed 10. nov. 2026 → '6 dage forfalden', in the 1–30 days bucket", () => {
    const d = debt({ total: kr(12_500), credited: 0, paid: 0, dueDate: "2026-11-04" }, "2026-11-10");
    expect(d).toEqual({ outstanding: kr(12_500), daysOverdue: 6, status: "forfalden", bucket: "d1_30" });
    expect(overdueText(d.daysOverdue)).toBe("6 dage forfalden");
    expect(overdueText(1)).toBe("1 dag forfalden");
  });

  it("AC: a partial payment gives Delvist betalt and reduces the outstanding amount", () => {
    const d = debt(
      { total: kr(100_000), credited: 0, paid: kr(40_000), dueDate: "2026-12-01" },
      "2026-11-10",
    );
    expect(d).toMatchObject({ outstanding: kr(60_000), status: "delvist_betalt", bucket: "ikke_forfalden" });
    expect(
      debt(
        { total: kr(100_000), credited: kr(10_000), paid: kr(90_000), dueDate: "2026-01-01" },
        "2026-11-10",
      ),
    ).toEqual({
      outstanding: 0,
      daysOverdue: 0,
      status: "betalt",
      bucket: null,
    });
    expect(debt({ total: kr(1), credited: 0, paid: 0, dueDate: "2026-11-10" }, "2026-11-10").status).toBe(
      "aaben",
    );
    expect(debt({ total: kr(5), credited: kr(5), paid: 0, dueDate: "2026-01-01" }, "2026-11-10").status).toBe(
      "krediteret",
    );
  });

  it("ageing buckets and summary", () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91].map(ageingBucket)).toEqual([
      "ikke_forfalden",
      "d1_30",
      "d1_30",
      "d31_60",
      "d31_60",
      "d61_90",
      "d61_90",
      "over_90",
    ]);
    const s = ageingSummary([
      { outstanding: 100, bucket: "d1_30" },
      { outstanding: 50, bucket: "over_90" },
      { outstanding: 0, bucket: null },
    ]);
    expect(s.total).toBe(150);
    expect(s.buckets).toMatchObject({ d1_30: 100, over_90: 50, ikke_forfalden: 0 });
  });

  it("validates payments and reminder levels", () => {
    expect(paymentError(kr(10), kr(10))).toBeNull();
    expect(paymentError(kr(11), kr(10))).toBe("payment_exceeds_outstanding");
    expect(paymentError(0, kr(10))).toBe("payment_not_positive");
    expect(nextReminderError(1, [])).toBeNull();
    expect(nextReminderError(3, [1])).toBe("reminder_out_of_order");
    expect(nextReminderError(4, [1, 2, 3])).toBe("reminder_level_invalid");
  });
});

describe("access (D-029)", () => {
  it("Finance gets people import and the full audit log, but not GDPR or system settings", () => {
    const finance = new AccessPolicy(["employee", "finance"]);
    expect(finance.can("people.import")).toBe(true);
    expect(finance.can("audit.read_all")).toBe(true);
    expect(finance.can("gdpr.manage")).toBe(false);
    expect(finance.can("settings.manage")).toBe(false);
  });

  it("case finance: Finance and Management see all, PMs their own, employees and plain Admin nothing", () => {
    expect(new AccessPolicy(["finance"]).can("case_finance.view_all")).toBe(true);
    expect(new AccessPolicy(["management"]).can("case_finance.view_all")).toBe(true);
    const pm = new AccessPolicy(["employee", "project_manager"]);
    expect(pm.can("case_finance.view")).toBe(true);
    expect(pm.can("case_finance.view_all")).toBe(false);
    expect(pm.can("receivables.manage")).toBe(false);
    expect(new AccessPolicy(["employee"]).can("case_finance.view")).toBe(false);
    expect(new AccessPolicy(["admin"]).can("case_finance.view")).toBe(false);
  });
});
