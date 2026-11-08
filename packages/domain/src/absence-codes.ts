/**
 * Default absence codes for a new Danish tenant (docs/spec/absence-flex.md). Tenants can add/deactivate codes.
 * countsTowardNorm = the hours fill the norm (so flex is unaffected). approvalRequired = line manager approves.
 */
export interface AbsenceCodeDef {
  code: string;
  nameDa: string;
  nameEn: string;
  type: "vacation" | "sickness" | "child_sick" | "time_off_in_lieu" | "unpaid" | "paid_leave" | "other";
  countsTowardNorm: boolean;
  approvalRequired: boolean;
  /** visible to colleagues as plain "absent" only (D-013 sickness privacy) */
  sensitive: boolean;
}

export const DEFAULT_ABSENCE_CODES: AbsenceCodeDef[] = [
  {
    code: "FERIE",
    nameDa: "Ferie",
    nameEn: "Vacation",
    type: "vacation",
    countsTowardNorm: true,
    approvalRequired: true,
    sensitive: false,
  },
  {
    code: "FERIEFRI",
    nameDa: "Feriefridag",
    nameEn: "Extra day off",
    type: "vacation",
    countsTowardNorm: true,
    approvalRequired: true,
    sensitive: false,
  },
  {
    code: "SYG",
    nameDa: "Sygdom",
    nameEn: "Sickness",
    type: "sickness",
    countsTowardNorm: true,
    approvalRequired: false,
    sensitive: true,
  },
  {
    code: "BARNSYG",
    nameDa: "Barns 1. sygedag",
    nameEn: "Child's first sick day",
    type: "child_sick",
    countsTowardNorm: true,
    approvalRequired: false,
    sensitive: true,
  },
  // Time off in lieu draws on the flex balance: it does NOT fill the norm, so the week's flex goes down.
  {
    code: "AFSP",
    nameDa: "Afspadsering",
    nameEn: "Time off in lieu",
    type: "time_off_in_lieu",
    countsTowardNorm: false,
    approvalRequired: true,
    sensitive: false,
  },
  {
    code: "ORLOV",
    nameDa: "Orlov (betalt)",
    nameEn: "Paid leave",
    type: "paid_leave",
    countsTowardNorm: true,
    approvalRequired: true,
    sensitive: false,
  },
  // Unpaid leave fills the norm (no flex debt) but is excluded from pay; payroll export handles the deduction (M4).
  {
    code: "ULON",
    nameDa: "Fri uden løn",
    nameEn: "Unpaid leave",
    type: "unpaid",
    countsTowardNorm: true,
    approvalRequired: true,
    sensitive: false,
  },
];
