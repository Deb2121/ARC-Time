export interface TaskRef {
  taskId: string;
  taskName: string;
  wbs: string;
  projectId: string;
  projectNumber: string;
  projectName: string;
  customerName: string | null;
  commentRequired: boolean;
  taskBillable?: boolean;
  billable?: boolean;
  favourite?: boolean;
}

export interface AbsenceRef {
  absenceCodeId: string;
  code: string;
  nameDa: string;
  nameEn: string;
  countsTowardNorm?: boolean;
}

export interface Cell {
  id: string;
  hours: number;
  comment: string | null;
  status: string;
  billable: boolean;
}

export type Row =
  | { key: string; kind: "task"; ref: TaskRef; cells: Record<string, Cell> }
  | { key: string; kind: "absence"; ref: AbsenceRef; cells: Record<string, Cell> };

export interface WeekData {
  userId: string;
  weekStart: string;
  status: "open" | "submitted" | "partially_approved" | "approved" | "rejected";
  editable: boolean;
  today: string;
  days: { date: string; norm: number; holiday: "full" | "half" | "hours" | null }[];
  rows: Row[];
  absenceCodes: { id: string; code: string; nameDa: string; nameEn: string; countsTowardNorm: boolean }[];
  summary: {
    norm: number;
    work: number;
    absence: number;
    billable: number;
    billableBp: number | null;
    flex: number;
  };
  flexBalance: number;
  events: { action: string; comment: string | null; at: string; by: string | null }[];
}

export const taskRowKey = (taskId: string) => `t:${taskId}`;
export const absenceRowKey = (id: string) => `a:${id}`;
