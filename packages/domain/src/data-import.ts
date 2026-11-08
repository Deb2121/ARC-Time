/**
 * Data import rules (decision D-024) — GRASP Information Expert for reading customer, project and employee lists
 * from CSV (as saved from Excel): parsing (`;`, `,` or tab, quotes, BOM), Danish/English column names, Danish
 * numbers and dates, and per-row validation. Pure: the API decides create/update and writes in one transaction.
 */

/** What can be imported. */
export type ImportKind = "customers" | "projects" | "employees";

/** One column: the key we use, accepted header names (lower-case), whether it is required, and an example. */
export interface ImportColumn {
  key: string;
  headers: string[];
  required: boolean;
  example: string;
}

/** Columns per kind. The first header name is the one in the template. */
export const IMPORT_COLUMNS: Record<ImportKind, ImportColumn[]> = {
  customers: [
    { key: "number", headers: ["kundenummer", "number", "nr"], required: false, example: "1001" },
    {
      key: "name",
      headers: ["navn", "name", "kundenavn"],
      required: true,
      example: "Fjordbyen Boligforening",
    },
    { key: "cvr", headers: ["cvr", "cvr-nr", "cvr nr"], required: false, example: "12345678" },
    { key: "ean", headers: ["ean", "ean-nr"], required: false, example: "" },
    { key: "address", headers: ["adresse", "address"], required: false, example: "Havnegade 12" },
    {
      key: "postalCode",
      headers: ["postnr", "postnummer", "postal_code", "zip"],
      required: false,
      example: "8000",
    },
    { key: "city", headers: ["by", "city"], required: false, example: "Aarhus C" },
    {
      key: "paymentTermsDays",
      headers: ["betalingsfrist", "payment_terms_days", "betalingsbetingelse"],
      required: false,
      example: "30",
    },
  ],
  projects: [
    { key: "number", headers: ["projektnummer", "number", "nr"], required: false, example: "25014" },
    {
      key: "name",
      headers: ["navn", "name", "projektnavn"],
      required: true,
      example: "Skolegården – renovering",
    },
    { key: "customerNumber", headers: ["kundenummer", "customer_number"], required: false, example: "1001" },
    {
      key: "managerEmail",
      headers: ["projektleder", "projektleder_email", "manager_email"],
      required: true,
      example: "pd@firma.dk",
    },
    {
      key: "contractType",
      headers: ["aftaletype", "contract_type", "type"],
      required: false,
      example: "regning",
    },
    { key: "price", headers: ["fastpris", "pris", "price"], required: false, example: "" },
    { key: "hourlyRate", headers: ["timepris", "hourly_rate"], required: false, example: "950" },
    {
      key: "startDate",
      headers: ["startdato", "start", "start_date"],
      required: false,
      example: "01-12-2026",
    },
    { key: "endDate", headers: ["slutdato", "slut", "end_date"], required: false, example: "" },
    { key: "billable", headers: ["fakturerbar", "billable"], required: false, example: "ja" },
    { key: "status", headers: ["status"], required: false, example: "aktiv" },
  ],
  employees: [
    { key: "email", headers: ["email", "e-mail", "mail"], required: true, example: "mh@firma.dk" },
    {
      key: "fullName",
      headers: ["navn", "name", "fulde navn", "full_name"],
      required: true,
      example: "Mette Holm",
    },
    { key: "initials", headers: ["initialer", "initials"], required: true, example: "MH" },
    { key: "department", headers: ["afdeling", "department"], required: false, example: "Arkitektur" },
    {
      key: "managerEmail",
      headers: ["leder", "leder_email", "manager_email"],
      required: false,
      example: "kh@firma.dk",
    },
    { key: "roles", headers: ["roller", "roles"], required: false, example: "projektleder" },
    {
      key: "employmentStart",
      headers: ["ansat fra", "ansættelsesdato", "employment_start", "start"],
      required: true,
      example: "01-08-2024",
    },
    { key: "normPattern", headers: ["normtid", "norm", "arbejdstid"], required: false, example: "" },
    {
      key: "payrollNumber",
      headers: ["lønnummer", "lønnr", "payroll_number"],
      required: false,
      example: "1042",
    },
    { key: "flexOpening", headers: ["flekssaldo", "flex_opening"], required: false, example: "0" },
    { key: "vacationOpening", headers: ["feriesaldo", "vacation_opening"], required: false, example: "12,5" },
    { key: "costRate", headers: ["kostpris", "cost_rate"], required: false, example: "450" },
    { key: "salesRate", headers: ["salgspris", "sales_rate"], required: false, example: "950" },
  ],
};

/** Splits CSV text into rows of cells: strips a BOM, detects `;`, tab or `,` from the header, honours quotes. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = firstLine.includes(";") ? ";" : firstLine.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** "1.234,50" / "1234.5" / "950" → number, or null when empty; NaN when not a number. */
export function parseNumber(v: string | undefined): number | null {
  const s = (v ?? "").trim().replace(/\s|kr\.?/gi, "");
  if (!s) return null;
  const normalised = s.includes(",") ? s.replaceAll(".", "").replace(",", ".") : s;
  return /^-?\d+(\.\d+)?$/.test(normalised) ? Number(normalised) : Number.NaN;
}

/** "ja/nej", "yes/no", "x", "1/0", "sand/falsk" → boolean; null when empty; undefined when not understood. */
export function parseYesNo(v: string | undefined): boolean | null | undefined {
  const s = (v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (["ja", "j", "yes", "y", "x", "1", "true", "sand"].includes(s)) return true;
  if (["nej", "n", "no", "0", "false", "falsk"].includes(s)) return false;
  return undefined;
}

/** "2026-12-01", "01-12-2026", "1.12.2026" or "01/12/2026" → "2026-12-01"; null when empty or not a real date. */
export function parseDate(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  let y: number;
  let m: number;
  let d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const dk = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(s);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dk) [d, m, y] = [Number(dk[1]), Number(dk[2]), Number(dk[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Result of reading a file: rows keyed by column key (raw strings), the source line numbers, and problems. */
export interface MappedImport {
  rows: { line: number; values: Record<string, string> }[];
  missingColumns: string[];
  unknownColumns: string[];
}

/** Maps the header row to column keys (case-insensitive, Danish or English names) and returns keyed rows. */
export function mapImport(kind: ImportKind, table: string[][]): MappedImport {
  const [header = [], ...body] = table;
  const cols = IMPORT_COLUMNS[kind];
  const index = new Map<string, number>();
  const unknownColumns: string[] = [];
  header.forEach((h, i) => {
    const name = h.trim().toLowerCase();
    const col = cols.find((c) => c.headers.includes(name));
    if (col) index.set(col.key, i);
    else if (name) unknownColumns.push(h.trim());
  });
  const missingColumns = cols
    .filter((c) => c.required && !index.has(c.key))
    .map((c) => c.headers[0] as string);
  const rows = body.map((cells, i) => {
    const values: Record<string, string> = {};
    for (const [key, at] of index) values[key] = (cells[at] ?? "").trim();
    return { line: i + 2, values };
  });
  return { rows, missingColumns, unknownColumns };
}

/** Problems found in one row, as error codes (translated in the UI as `imp.err.<code>`). */
export function validateRow(kind: ImportKind, v: Record<string, string>): string[] {
  const errors: string[] = [];
  for (const c of IMPORT_COLUMNS[kind]) if (c.required && !v[c.key]) errors.push(`missing_${c.key}`);
  const num = (k: string, min = 0) => {
    const n = parseNumber(v[k]);
    if (n !== null && (Number.isNaN(n) || n < min)) errors.push(`bad_${k}`);
  };
  const date = (k: string) => {
    if (v[k] && !parseDate(v[k])) errors.push(`bad_${k}`);
  };
  if (kind === "customers") {
    if (v.cvr && !/^\d{8}$/.test(v.cvr.replace(/\s/g, ""))) errors.push("bad_cvr");
    if (v.ean && !/^\d{13}$/.test(v.ean.replace(/\s/g, ""))) errors.push("bad_ean");
    num("paymentTermsDays");
  }
  if (kind === "projects") {
    if (v.number && !/^\d{3,10}$/.test(v.number)) errors.push("bad_number");
    if (v.contractType && !contractTypeOf(v.contractType)) errors.push("bad_contractType");
    if (v.status && !projectStatusOf(v.status)) errors.push("bad_status");
    if (parseYesNo(v.billable) === undefined) errors.push("bad_billable");
    num("price");
    num("hourlyRate");
    date("startDate");
    date("endDate");
  }
  if (kind === "employees") {
    if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) errors.push("bad_email");
    if (v.initials && !/^[\p{L}\d]{1,6}$/u.test(v.initials)) errors.push("bad_initials");
    date("employmentStart");
    if (v.roles && rolesOf(v.roles) === null) errors.push("bad_roles");
    num("flexOpening", -999);
    num("vacationOpening", -99);
    num("costRate");
    num("salesRate");
  }
  return errors;
}

/** "regning" / "fastpris" / "rammeaftale" (or English) → contract type; null when not understood. */
export function contractTypeOf(v: string): "time_material" | "fixed_price" | "retainer" | null {
  const s = v.trim().toLowerCase();
  if (["regning", "løbende", "time_material", "t&m"].includes(s)) return "time_material";
  if (["fastpris", "fixed_price", "fixed"].includes(s)) return "fixed_price";
  if (["rammeaftale", "abonnement", "retainer"].includes(s)) return "retainer";
  return null;
}

/** "aktiv" / "planlagt" / "afsluttet" / "arkiveret" (or English) → project status; null when not understood. */
export function projectStatusOf(v: string): "planned" | "active" | "completed" | "archived" | null {
  const s = v.trim().toLowerCase();
  if (["aktiv", "active", "igang", "i gang"].includes(s)) return "active";
  if (["planlagt", "planned"].includes(s)) return "planned";
  if (["afsluttet", "completed", "lukket"].includes(s)) return "completed";
  if (["arkiveret", "archived"].includes(s)) return "archived";
  return null;
}

const ROLE_NAMES: Record<string, "project_manager" | "line_manager" | "finance" | "management" | "admin"> = {
  projektleder: "project_manager",
  project_manager: "project_manager",
  leder: "line_manager",
  "nærmeste leder": "line_manager",
  line_manager: "line_manager",
  økonomi: "finance",
  finance: "finance",
  ledelse: "management",
  management: "management",
  admin: "admin",
  administrator: "admin",
};

/** "projektleder, leder" → roles (employee is always added by the importer); null when a name is unknown. */
export function rolesOf(
  v: string,
): ("project_manager" | "line_manager" | "finance" | "management" | "admin")[] | null {
  const names = v
    .split(/[,+/]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s && s !== "medarbejder" && s !== "employee");
  const roles = names.map((n) => ROLE_NAMES[n]);
  return roles.every(Boolean) ? [...new Set(roles as NonNullable<(typeof roles)[number]>[])] : null;
}

/** A template CSV (header + one example row, `;`-separated, with BOM so Excel opens it with æøå intact). */
export function importTemplate(kind: ImportKind): string {
  const cols = IMPORT_COLUMNS[kind];
  return `﻿${cols.map((c) => c.headers[0]).join(";")}\r\n${cols.map((c) => c.example).join(";")}\r\n`;
}
