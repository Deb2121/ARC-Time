import { describe, expect, it } from "vitest";
import {
  buildTimeLines,
  deferredRevenue,
  dueDate,
  type InvoiceableEntry,
  invoiceTotals,
  isLocked,
  kr,
  lastDayOfMonth,
  lineAmount,
  monthOf,
  type RateContext,
  resolveRate,
  spreadAmount,
} from "./index.ts";

const ctx: RateContext = {
  date: "2026-11-04",
  userId: "laura",
  priceGroupId: "architect",
  taskTypeId: "design",
  projectEmployeeRates: [],
  projectList: null,
  customerList: null,
  standardList: [
    { priceGroupId: "architect", taskTypeId: null, rate: kr(925), validFrom: "2026-01-01" },
    { priceGroupId: null, taskTypeId: null, rate: kr(850), validFrom: "2026-01-01" },
  ],
  employeeDefault: kr(800),
};

describe("rate resolution (brief §4.9)", () => {
  it("falls back to the employee default when no list matches", () => {
    expect(resolveRate({ ...ctx, standardList: null })).toEqual({
      rate: kr(800),
      source: "employee_default",
    });
  });
  it("uses the standard list by price group", () => {
    expect(resolveRate(ctx)).toEqual({ rate: kr(925), source: "standard_list" });
  });
  it("customer list beats standard list; project list beats customer list", () => {
    const customerList = [
      { priceGroupId: "architect", taskTypeId: null, rate: kr(875), validFrom: "2026-01-01" },
    ];
    expect(resolveRate({ ...ctx, customerList }).source).toBe("customer_list");
    const projectList = [
      { priceGroupId: null, taskTypeId: "design", rate: kr(950), validFrom: "2026-01-01" },
    ];
    expect(resolveRate({ ...ctx, customerList, projectList })).toEqual({
      rate: kr(950),
      source: "project_list",
    });
  });
  it("project-specific employee rate beats everything", () => {
    const projectEmployeeRates = [{ userId: "laura", rate: kr(1000), validFrom: "2026-06-01" }];
    expect(resolveRate({ ...ctx, projectEmployeeRates }).rate).toBe(kr(1000));
    expect(resolveRate({ ...ctx, userId: "oliver", projectEmployeeRates }).source).toBe("standard_list");
  });
  it("most specific line wins inside a list", () => {
    const projectList = [
      { priceGroupId: "architect", taskTypeId: null, rate: kr(900), validFrom: "2026-01-01" },
      { priceGroupId: "architect", taskTypeId: "design", rate: kr(990), validFrom: "2026-01-01" },
      { priceGroupId: null, taskTypeId: "design", rate: kr(960), validFrom: "2026-01-01" },
    ];
    expect(resolveRate({ ...ctx, projectList }).rate).toBe(kr(990));
  });
  it("respects valid-from: a rate increase applies only from its date", () => {
    const standardList = [
      { priceGroupId: "architect", taskTypeId: null, rate: kr(925), validFrom: "2026-01-01" },
      { priceGroupId: "architect", taskTypeId: null, rate: kr(962), validFrom: "2026-11-01" }, // +4 %
    ];
    expect(resolveRate({ ...ctx, standardList, date: "2026-10-31" }).rate).toBe(kr(925));
    expect(resolveRate({ ...ctx, standardList, date: "2026-11-01" }).rate).toBe(kr(962));
  });
});

const entry = (
  id: string,
  hours: number,
  rate: number,
  extra: Partial<InvoiceableEntry> = {},
): InvoiceableEntry => ({
  id,
  date: "2026-10-05",
  hours,
  rate: kr(rate),
  taskId: "t1",
  taskLabel: "Projektforslag",
  userId: "u1",
  userLabel: "Laura Vinther",
  status: "approved",
  invoiceLineId: null,
  billable: true,
  ...extra,
});

describe("invoice suggestion", () => {
  it("§9: an invoiced entry never appears in a new suggestion", () => {
    const lines = buildTimeLines(
      [
        entry("a", 750, 925),
        entry("b", 300, 925, { status: "invoiced", invoiceLineId: "line-1" }),
        entry("c", 200, 925, { invoiceLineId: "line-2" }),
        entry("d", 100, 925, { status: "submitted" }),
        entry("e", 100, 925, { billable: false }),
      ],
      "task",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.sources.map((s) => s.entryId)).toEqual(["a"]);
  });
  it("groups per task, per employee, task + employee, or one summary line", () => {
    const entries = [
      entry("a", 750, 925),
      entry("b", 400, 1050, { userId: "u2", userLabel: "Peter Dahl" }),
      entry("c", 200, 925, { taskId: "t2", taskLabel: "Fagtilsyn" }),
    ];
    expect(buildTimeLines(entries, "task")).toHaveLength(2);
    expect(buildTimeLines(entries, "employee")).toHaveLength(2);
    expect(buildTimeLines(entries, "task_employee")).toHaveLength(3);
    const [summary] = buildTimeLines(entries, "summary");
    expect(summary?.quantity).toBe(1350);
    expect(summary?.amount).toBe(kr(6937.5 + 4200 + 1850));
  });
  it("mixed rates on one line: amount is exact, unit price is the average", () => {
    const [line] = buildTimeLines([entry("a", 100, 925), entry("b", 100, 1050, { userId: "u2" })], "task");
    expect(line?.amount).toBe(kr(1975));
    expect(line?.unitPrice).toBe(kr(987.5));
  });
});

describe("write-down spreading", () => {
  it("spreads proportionally and always adds up exactly", () => {
    const sources = [
      { entryId: "a", hours: 750, value: kr(6937.5), invoiced: kr(6937.5) },
      { entryId: "b", hours: 400, value: kr(4200), invoiced: kr(4200) },
      { entryId: "c", hours: 200, value: kr(1850), invoiced: kr(1850) },
    ];
    const spread = spreadAmount(sources, kr(12000)); // write-down from 12.987,50 to 12.000,00
    expect(spread.reduce((a, s) => a + s.invoiced, 0)).toBe(kr(12000));
    expect(spread[0]?.invoiced).toBe(641001); // 6.937,50 × 12.000 / 12.987,50 = 6.410,0096 → 6.410,01
  });
  it("handles a write-up and odd remainders", () => {
    const sources = [1, 1, 1].map((v, i) => ({ entryId: String(i), hours: 100, value: v, invoiced: v }));
    expect(spreadAmount(sources, 10).map((s) => s.invoiced)).toEqual([4, 3, 3]);
  });
});

describe("totals, VAT and due date", () => {
  it("Danish VAT 25 % on the summed base", () => {
    const t = invoiceTotals([
      { amount: kr(6937.5), vatBp: 2500 },
      { amount: kr(4200), vatBp: 2500 },
    ]);
    expect(t).toMatchObject({ subtotal: kr(11137.5), vat: kr(2784.38), total: kr(13921.88) });
  });
  it("line amount with discount", () => {
    expect(lineAmount(1000, kr(950), 1000)).toBe(kr(8550)); // 10 h × 950 − 10 %
  });
  it("due date from payment terms (netto 30)", () => {
    expect(dueDate("2026-11-30", 30)).toBe("2026-12-30");
  });
});

describe("accounting periods", () => {
  it("locks dates in closed months", () => {
    const closed = new Set(["2026-09-01", "2026-10-01"]);
    expect(monthOf("2026-10-31")).toBe("2026-10-01");
    expect(isLocked("2026-10-31", closed)).toBe(true);
    expect(isLocked("2026-11-02", closed)).toBe(false);
    expect(lastDayOfMonth("2028-02-01")).toBe("2028-02-29");
  });
  it("deferred revenue on a retainer = invoiced − earned", () => {
    expect(deferredRevenue(kr(38000), 3000, 4000)).toBe(kr(9500)); // 30 of 40 h used
    expect(deferredRevenue(kr(38000), 5000, 4000)).toBe(0); // overrun
  });
});
