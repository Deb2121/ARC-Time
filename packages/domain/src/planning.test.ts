import { describe, expect, it } from "vitest";
import { capacity, freeHours, utilisationBand, utilisationBp } from "./index.ts";

describe("resource planning", () => {
  it("capacity = norm − absence (a vacation day removes 7,5 h)", () => {
    expect(capacity(3700, 750)).toBe(2950);
    expect(capacity(3700, 4000)).toBe(0);
  });
  it("utilisation in basis points", () => {
    expect(utilisationBp(3330, 3700)).toBe(9000);
    expect(utilisationBp(100, 0)).toBeNull();
  });
  it("bands: under < 70 %, ok 70–100 % inclusive, over > 100 %", () => {
    expect(utilisationBand(2589, 3700)).toBe("under"); // 69,97 %
    expect(utilisationBand(2590, 3700)).toBe("ok"); // 70,0 %
    expect(utilisationBand(3700, 3700)).toBe("ok"); // 100 %
    expect(utilisationBand(3725, 3700)).toBe("over");
    expect(utilisationBand(0, 0)).toBe("none");
    expect(utilisationBand(750, 0)).toBe("over"); // booked during a full vacation week
  });
  it("free hours never negative", () => {
    expect(freeHours(3000, 3700)).toBe(700);
    expect(freeHours(4000, 3700)).toBe(0);
  });
});
