/**
 * Rate plan generator (D-039). The main case rebuilds Finance's Excel sheet for Baltoppen (2026-11-13) — fictional
 * names for the sub-consultants — and checks the figures against the sheet to the øre.
 */
import { describe, expect, it } from "vitest";
import { allocateByWeights, computeFeePlan, type FeePlanInput, monthPlus } from "./fee-plan.ts";

const kr = (n: number) => Math.round(n * 100);

/** Baltoppen as in the sheet: 7 phases, 3 fee parts, sub-consultant A fixed per phase, B by share. */
const baltoppen: FeePlanInput = {
  phases: [
    { key: "pf", name: "Projektforslag", baseFee: kr(950_000), start: "2026-11", weights: [1, 1, 1] },
    { key: "mp", name: "Myndighedsprojekt", baseFee: kr(350_000), start: "2027-02", weights: [2, 1] },
    {
      key: "up",
      name: "Udbudsprojekt",
      baseFee: kr(1_150_000),
      start: "2027-03",
      weights: [1, 2, 2, 2, 2, 1],
    },
    { key: "ufp", name: "Udførelsesprojekt", baseFee: kr(250_000), start: "2027-10", weights: [1] },
    {
      key: "udf",
      name: "Udførelse",
      baseFee: kr(1_250_000),
      start: "2027-11",
      weights: [1, 1, 1, 1, 1, 1, 1, 1],
    },
    { key: "ab", name: "As Build", baseFee: kr(85_000), start: "2028-07", weights: [1] },
    { key: "5y", name: "5 års gennemgang", baseFee: kr(35_000), start: "2033-07", weights: [1] },
  ],
  pools: [
    {
      name: "Projekteringsledelse og AMK i projektfasen",
      amount: kr(345_000),
      phaseKeys: ["pf", "mp", "up", "ufp"],
    },
    {
      name: "IKT-ledelse, risikoanalyse og -styring",
      amount: kr(200_000),
      phaseKeys: ["pf", "mp", "up", "ufp", "udf"],
    },
    { name: "AMK i udførelsesfasen", amount: kr(175_000), phaseKeys: ["udf"] },
  ],
  subs: [
    {
      name: "Underrådgiver A",
      mode: "fixed",
      perPhase: {
        pf: kr(154_000),
        mp: kr(32_000),
        up: kr(100_000),
        ufp: kr(44_000),
        udf: kr(176_000),
        ab: kr(22_000),
        "5y": kr(11_000),
      },
    },
    { name: "Underrådgiver B", mode: "share", total: kr(300_000) },
  ],
};

describe("allocateByWeights", () => {
  it("parts always add up to the whole", () => {
    expect(allocateByWeights(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateByWeights(1000, [2, 1])).toEqual([667, 333]);
    expect(allocateByWeights(7, [0, 0])).toEqual([4, 3]);
    const parts = allocateByWeights(111_949_015, [1, 2, 2, 2, 2, 1]);
    expect(parts.reduce((a, x) => a + x, 0)).toBe(111_949_015);
  });
});

describe("monthPlus", () => {
  it("steps whole months across the year", () => {
    expect(monthPlus("2026-11", 0)).toBe("2026-11-01");
    expect(monthPlus("2026-11", 2)).toBe("2027-01-01");
    expect(monthPlus("2027-11", 7)).toBe("2028-06-01");
  });
});

describe("computeFeePlan – Baltoppen", () => {
  const r = computeFeePlan(baltoppen);

  it("has no problems and adds up to 4.790.000,00 exactly", () => {
    expect(r.problems).toEqual([]);
    expect(r.total).toBe(kr(4_790_000));
    expect(r.instalments.reduce((a, i) => a + i.amount, 0)).toBe(kr(4_790_000));
    expect(r.subTotals).toEqual([kr(539_000), kr(300_000)]);
    expect(r.own).toBe(kr(3_951_000));
  });

  it("phase fees match the sheet ('Beregning af honorar i faser', column H) within 1 øre", () => {
    const sheet = [
      1_119_490.1547, 412_443.7412, 1_355_172.2925, 294_602.6723, 1_488_291.1392, 85_000, 35_000,
    ];
    r.phases.forEach((p, i) => {
      expect(Math.abs(p.total - (sheet[i] ?? 0) * 100)).toBeLessThanOrEqual(1);
    });
  });

  it("22 instalments with the sheet's months; rate 5 and 6 share March 2027", () => {
    expect(r.instalments).toHaveLength(22);
    const months = r.instalments.map((i) => i.date.slice(0, 7));
    expect(months.slice(0, 6)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-03"]);
    expect(r.instalments[4]?.description).toBe("Rate 5 · Myndighedsprojekt");
    expect(r.instalments[5]?.description).toBe("Rate 6 · Udbudsprojekt");
    expect(r.instalments[21]?.date).toBe("2033-07-01");
  });

  it("instalment amounts and splits match the sheet within 1 øre", () => {
    const near = (ore: number, sheetKr: number) =>
      expect(Math.abs(ore - sheetKr * 100)).toBeLessThanOrEqual(1);
    const [r1, , , r4, r5, r6, r7] = r.instalments;
    near(r1?.amount ?? 0, 373_163.3849); // Rate 1
    near(r1?.subAmounts[0] ?? 0, 51_333.3333);
    near(r1?.subAmounts[1] ?? 0, 23_371.402);
    near(r1?.own ?? 0, 298_458.6496);
    near(r4?.amount ?? 0, 274_962.4941); // Rate 4 = 2/3 of Myndighedsprojekt
    near(r5?.amount ?? 0, 137_481.2471);
    near(r6?.amount ?? 0, 135_517.2293); // Rate 6 = 1/10 of Udbudsprojekt
    near(r7?.amount ?? 0, 271_034.4585);
    near(r.instalments[12]?.amount ?? 0, 186_036.3924); // Rate 13 = 1/8 of Udførelse
  });

  it("every phase's instalments add up to the phase, also per sub-consultant", () => {
    for (const p of r.phases) {
      const own = r.instalments.filter((i) => i.phaseKey === p.key);
      expect(own.reduce((a, i) => a + i.amount, 0)).toBe(p.total);
      p.subAmounts.forEach((s, j) => {
        expect(own.reduce((a, i) => a + (i.subAmounts[j] ?? 0), 0)).toBe(s);
      });
    }
  });
});

describe("computeFeePlan – checks", () => {
  it("reports missing phases, bad patterns, pools without phases and a sub-consultant above the phase fee", () => {
    expect(computeFeePlan({ phases: [], pools: [], subs: [] }).problems).toContainEqual({
      code: "no_phases",
    });
    const r = computeFeePlan({
      phases: [{ key: "a", name: "A", baseFee: kr(100), start: "2027-13", weights: [0] }],
      pools: [{ name: "P", amount: kr(10), phaseKeys: [] }],
      subs: [{ name: "U", mode: "fixed", perPhase: { a: kr(500) } }],
    });
    expect(r.problems).toEqual(
      expect.arrayContaining([
        { code: "bad_start", phase: "A" },
        { code: "bad_weights", phase: "A" },
        { code: "pool_without_phases", pool: "P" },
        { code: "sub_over_phase", sub: "U", phase: "A" },
      ]),
    );
    expect(r.instalments).toEqual([]);
  });
});
