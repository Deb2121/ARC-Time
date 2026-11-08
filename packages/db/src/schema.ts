/**
 * Database schema. M0: tenants, legal entities, departments, users, roles, sessions, audit log.
 * M1: norm time, holidays, absence codes, customers, projects/contracts/tasks, time entries, timesheet periods.
 * Every tenant-scoped table carries tenant_id and is protected by row-level security (decision D-012);
 * policies are applied by the hand-written migrations (0001_rls.sql, 0003_rls_m1.sql).
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id);
/** Hours are numeric(6,2) in the database (brief §5); converted to centi-hours in the domain layer. */
const hours = (name: string) => numeric(name, { precision: 6, scale: 2, mode: "number" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum("role", [
  "employee",
  "project_manager",
  "line_manager",
  "finance",
  "management",
  "admin",
]);

export const tenants = pgTable("tenants", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  defaultLocale: text("default_locale").notNull().default("da"),
  timeZone: text("time_zone").notNull().default("Europe/Copenhagen"),
  /** balances (flex, vacation) are opening balance at this date + registrations after it */
  goLiveDate: date("go_live_date").notNull().default(sql`current_date`),
  /** approval mode (D-013): line manager only, or project managers first then line manager */
  approvalMode: text("approval_mode").notNull().default("line_manager"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const legalEntities = pgTable(
  "legal_entities",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    cvr: char("cvr", { length: 8 }),
    currency: char("currency", { length: 3 }).notNull().default("DKK"),
    countryCode: char("country_code", { length: 2 }).notNull().default("DK"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("legal_entities_tenant_idx").on(t.tenantId)],
);

export const departments = pgTable(
  "departments",
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid("legal_entity_id")
      .notNull()
      .references(() => legalEntities.id),
    parentId: uuid("parent_id").references((): AnyPgColumn => departments.id),
    name: text("name").notNull(),
    code: text("code"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("departments_tenant_idx").on(t.tenantId)],
);

export const users = pgTable(
  "users",
  {
    id: id(),
    tenantId: tenantId(),
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    initials: text("initials").notNull(),
    locale: text("locale").notNull().default("da"),
    departmentId: uuid("department_id").references(() => departments.id),
    managerId: uuid("manager_id").references((): AnyPgColumn => users.id),
    /** argon2id hash; only used by dev login (never in production) */
    passwordHash: text("password_hash"),
    /** Microsoft Entra ID object id (oid claim) */
    entraObjectId: text("entra_object_id"),
    employmentStart: date("employment_start").notNull().default(sql`current_date`),
    employmentEnd: date("employment_end"),
    holidayCalendarId: uuid("holiday_calendar_id"),
    /** internal hourly cost in øre (cost-price groups arrive in M2) */
    costRate: bigint("cost_rate", { mode: "number" }).notNull().default(0),
    /** default hourly sales rate in øre (last step of rate resolution) */
    salesRate: bigint("sales_rate", { mode: "number" }).notNull().default(0),
    flexOpening: hours("flex_opening").notNull().default(0),
    /** opening vacation balance in days at go-live */
    vacationOpening: numeric("vacation_opening", { precision: 5, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_tenant_email_uq").on(t.tenantId, sql`lower(${t.email})`),
    uniqueIndex("users_entra_oid_uq").on(t.entraObjectId),
    index("users_manager_idx").on(t.managerId),
  ],
);

export const userRoles = pgTable(
  "user_roles",
  {
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export const sessions = pgTable(
  "sessions",
  {
    /** sha256 of the opaque session token; the raw token only lives in the cookie */
    tokenHash: text("token_hash").primaryKey(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    csrfToken: text("csrf_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    tenantId: tenantId(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    userId: uuid("user_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_entity_idx").on(t.tenantId, t.entity, t.entityId, t.at)],
);

/* ───────────────────────────── M1: norm time, holidays, absence ───────────────────────────── */

export const normPatterns = pgTable("norm_patterns", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  cycleWeeks: integer("cycle_weeks").notNull().default(1),
  /** centi-hours per day, Mon..Sun (×2 for 2-week cycles) */
  days: jsonb("days").$type<number[]>().notNull(),
  createdAt: createdAt(),
});

export const employeeNorms = pgTable(
  "employee_norms",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    normPatternId: uuid("norm_pattern_id")
      .notNull()
      .references(() => normPatterns.id),
    validFrom: date("valid_from").notNull(),
    cycleAnchor: date("cycle_anchor"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("employee_norms_user_from_uq").on(t.userId, t.validFrom)],
);

export const holidayCalendars = pgTable("holiday_calendars", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const holidayKindEnum = pgEnum("holiday_kind", ["full", "half", "hours"]);

export const holidays = pgTable(
  "holidays",
  {
    id: id(),
    tenantId: tenantId(),
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => holidayCalendars.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    name: text("name").notNull(),
    kind: holidayKindEnum("kind").notNull().default("full"),
    /** working hours that day when kind = hours */
    hours: hours("hours"),
  },
  (t) => [uniqueIndex("holidays_calendar_date_uq").on(t.calendarId, t.date)],
);

export const absenceTypeEnum = pgEnum("absence_type", [
  "vacation",
  "sickness",
  "child_sick",
  "time_off_in_lieu",
  "unpaid",
  "paid_leave",
  "other",
]);

export const absenceCodes = pgTable(
  "absence_codes",
  {
    id: id(),
    tenantId: tenantId(),
    code: text("code").notNull(),
    nameDa: text("name_da").notNull(),
    nameEn: text("name_en").notNull(),
    type: absenceTypeEnum("type").notNull(),
    countsTowardNorm: boolean("counts_toward_norm").notNull(),
    approvalRequired: boolean("approval_required").notNull(),
    sensitive: boolean("sensitive").notNull().default(false),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("absence_codes_tenant_code_uq").on(t.tenantId, t.code)],
);

/* ───────────────────────────── M1: customers and projects ───────────────────────────── */

export const customers = pgTable(
  "customers",
  {
    id: id(),
    tenantId: tenantId(),
    number: text("number").notNull(),
    name: text("name").notNull(),
    cvr: char("cvr", { length: 8 }),
    ean: char("ean", { length: 13 }),
    address: text("address"),
    postalCode: text("postal_code"),
    city: text("city"),
    countryCode: char("country_code", { length: 2 }).notNull().default("DK"),
    currency: char("currency", { length: 3 }).notNull().default("DKK"),
    paymentTermsDays: integer("payment_terms_days").notNull().default(30),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("customers_tenant_number_uq").on(t.tenantId, t.number)],
);

export const contacts = pgTable("contacts", {
  id: id(),
  tenantId: tenantId(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  title: text("title"),
  email: text("email"),
  phone: text("phone"),
});

export const projectStatusEnum = pgEnum("project_status", ["planned", "active", "completed", "archived"]);
export const contractTypeEnum = pgEnum("contract_type", ["time_material", "fixed_price", "retainer"]);
export const taskStatusEnum = pgEnum("task_status", ["open", "closed"]);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    tenantId: tenantId(),
    number: text("number").notNull(),
    name: text("name").notNull(),
    /** null = internal project */
    customerId: uuid("customer_id").references(() => customers.id),
    legalEntityId: uuid("legal_entity_id")
      .notNull()
      .references(() => legalEntities.id),
    managerId: uuid("manager_id").references(() => users.id),
    status: projectStatusEnum("status").notNull().default("planned"),
    category: text("category"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    currency: char("currency", { length: 3 }).notNull().default("DKK"),
    billable: boolean("billable").notNull().default(true),
    commentRequired: boolean("comment_required").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("projects_tenant_number_uq").on(t.tenantId, t.number)],
);

export const contracts = pgTable("contracts", {
  id: id(),
  tenantId: tenantId(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: contractTypeEnum("type").notNull(),
  /** fixed price: agreed price; retainer: fee per period (øre) */
  price: bigint("price", { mode: "number" }),
  /** T&M cap: hours above it are not invoiceable */
  maxHours: hours("max_hours"),
  /** default hourly sales rate for this contract (øre); full price-list resolution arrives in M2 */
  hourlyRate: bigint("hourly_rate", { mode: "number" }),
  /** retainer: pool of hours per period */
  retainerHours: hours("retainer_hours"),
  createdAt: createdAt(),
});

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    tenantId: tenantId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id").references(() => contracts.id),
    parentId: uuid("parent_id").references((): AnyPgColumn => tasks.id, { onDelete: "cascade" }),
    level: integer("level").notNull().default(1),
    wbs: text("wbs").notNull(),
    name: text("name").notNull(),
    billable: boolean("billable").notNull().default(true),
    status: taskStatusEnum("status").notNull().default("open"),
    budgetHours: hours("budget_hours").notNull().default(0),
    budgetAmount: bigint("budget_amount", { mode: "number" }).notNull().default(0),
    startDate: date("start_date"),
    endDate: date("end_date"),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [
    index("tasks_project_idx").on(t.projectId),
    check("tasks_level_max_5", sql`${t.level} between 1 and 5`),
  ],
);

export const projectMembers = pgTable(
  "project_members",
  {
    tenantId: tenantId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);

/* ───────────────────────────── M1: time entries and approval ───────────────────────────── */

export const entryStatusEnum = pgEnum("entry_status", [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "invoiced",
]);
export const periodStatusEnum = pgEnum("period_status", [
  "open",
  "submitted",
  "partially_approved",
  "approved",
  "rejected",
]);

export const timesheetPeriods = pgTable(
  "timesheet_periods",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekStart: date("week_start").notNull(),
    status: periodStatusEnum("status").notNull().default("open"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    comment: text("comment"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("timesheet_periods_user_week_uq").on(t.userId, t.weekStart)],
);

export const timesheetEvents = pgTable(
  "timesheet_events",
  {
    id: id(),
    tenantId: tenantId(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => timesheetPeriods.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    userId: uuid("user_id").references(() => users.id),
    comment: text("comment"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("timesheet_events_period_idx").on(t.periodId)],
);

export const timeEntries = pgTable(
  "time_entries",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    date: date("date").notNull(),
    projectId: uuid("project_id").references(() => projects.id),
    taskId: uuid("task_id").references(() => tasks.id),
    absenceCodeId: uuid("absence_code_id").references(() => absenceCodes.id),
    hours: hours("hours").notNull(),
    billable: boolean("billable").notNull().default(false),
    comment: text("comment"),
    internalNote: text("internal_note"),
    status: entryStatusEnum("status").notNull().default("draft"),
    /** rate snapshots taken at final approval (brief §4.9), øre per hour */
    salesRate: bigint("sales_rate", { mode: "number" }),
    costRate: bigint("cost_rate", { mode: "number" }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    invoiceLineId: uuid("invoice_line_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("time_entries_user_date_idx").on(t.tenantId, t.userId, t.date),
    index("time_entries_project_date_idx").on(t.tenantId, t.projectId, t.date),
    uniqueIndex("time_entries_cell_task_uq")
      .on(t.userId, t.date, t.taskId)
      .where(sql`${t.taskId} is not null`),
    uniqueIndex("time_entries_cell_absence_uq")
      .on(t.userId, t.date, t.absenceCodeId)
      .where(sql`${t.absenceCodeId} is not null`),
    check(
      "time_entries_task_xor_absence",
      sql`(${t.taskId} is not null and ${t.projectId} is not null and ${t.absenceCodeId} is null) or (${t.taskId} is null and ${t.projectId} is null and ${t.absenceCodeId} is not null)`,
    ),
    check("time_entries_hours_range", sql`${t.hours} >= 0 and ${t.hours} <= 24`),
  ],
);

export const favourites = pgTable(
  "favourites",
  {
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.taskId] })],
);
