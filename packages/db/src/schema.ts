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
  /** approval mode (D-013, D-022): none | line_manager | pm_then_line_manager */
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
    /** rate role used for price-list lookup (M2) */
    priceGroupId: uuid("price_group_id"),
    /** internal hourly cost in øre (cost-price groups arrive in M2) */
    costRate: bigint("cost_rate", { mode: "number" }).notNull().default(0),
    /** default hourly sales rate in øre (last step of rate resolution) */
    salesRate: bigint("sales_rate", { mode: "number" }).notNull().default(0),
    flexOpening: hours("flex_opening").notNull().default(0),
    /** employee number in the payroll system ("medarbejdernummer"); without it nothing is exported (D-023) */
    payrollNumber: text("payroll_number"),
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
    /** payroll: which salary code ("lønart") this absence is exported on; null = not exported (D-023) */
    salaryCodeId: uuid("salary_code_id").references((): AnyPgColumn => salaryCodes.id),
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
    priceListId: uuid("price_list_id"),
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
    priceListId: uuid("price_list_id"),
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
    taskTypeId: uuid("task_type_id"),
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
    /** project manager step (approval mode pm_then_line_manager); cleared when the entry is edited */
    pmApprovedBy: uuid("pm_approved_by").references(() => users.id),
    pmApprovedAt: timestamp("pm_approved_at", { withTimezone: true }),
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

/* ───────────────────────────── M2: rates ───────────────────────────── */

/** Rate role of an employee (e.g. Partner, Arkitekt, Ingeniør) used to look up price-list rates. */
export const priceGroups = pgTable("price_groups", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
});

export const taskTypes = pgTable("task_types", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(),
});

export const priceLists = pgTable("price_lists", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  /** set for a customer-specific list */
  customerId: uuid("customer_id").references(() => customers.id),
  isStandard: boolean("is_standard").notNull().default(false),
  currency: char("currency", { length: 3 }).notNull().default("DKK"),
  createdAt: createdAt(),
});

export const priceListRates = pgTable(
  "price_list_rates",
  {
    id: id(),
    tenantId: tenantId(),
    priceListId: uuid("price_list_id")
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    priceGroupId: uuid("price_group_id").references(() => priceGroups.id),
    taskTypeId: uuid("task_type_id").references(() => taskTypes.id),
    /** øre per hour */
    rate: bigint("rate", { mode: "number" }).notNull(),
    validFrom: date("valid_from").notNull(),
  },
  (t) => [index("price_list_rates_list_idx").on(t.priceListId)],
);

export const projectEmployeeRates = pgTable("project_employee_rates", {
  id: id(),
  tenantId: tenantId(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  rate: bigint("rate", { mode: "number" }).notNull(),
  validFrom: date("valid_from").notNull(),
});

/* ───────────────────────────── M2: invoicing ───────────────────────────── */

export const planItemStatusEnum = pgEnum("plan_item_status", ["planned", "ready", "invoiced"]);

/** Fixed-price payment plan / retainer fee schedule. */
export const paymentPlanItems = pgTable(
  "payment_plan_items",
  {
    id: id(),
    tenantId: tenantId(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    dueDate: date("due_date").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    status: planItemStatusEnum("status").notNull().default("planned"),
    invoiceLineId: uuid("invoice_line_id"),
  },
  (t) => [index("payment_plan_items_contract_idx").on(t.contractId)],
);

/** Gap-free invoice numbering per legal entity (brief §4.10). The counter row is locked during booking. */
export const numberSeries = pgTable(
  "number_series",
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid("legal_entity_id")
      .notNull()
      .references(() => legalEntities.id),
    kind: text("kind").notNull().default("invoice"),
    nextNumber: integer("next_number").notNull().default(1),
  },
  (t) => [uniqueIndex("number_series_entity_kind_uq").on(t.legalEntityId, t.kind)],
);

export const invoiceTypeEnum = pgEnum("invoice_type", ["invoice", "credit"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "ready", "booked"]);
export const invoiceLineKindEnum = pgEnum("invoice_line_kind", [
  "time",
  "expense",
  "milestone",
  "product",
  "text",
  "heading",
  "subtotal",
]);

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid("legal_entity_id")
      .notNull()
      .references(() => legalEntities.id),
    /** assigned only when booked; drafts have no number */
    number: integer("number"),
    type: invoiceTypeEnum("type").notNull().default("invoice"),
    creditOfId: uuid("credit_of_id").references((): AnyPgColumn => invoices.id),
    /** credit note: when booked, release the credited time entries / milestones so they can be invoiced again */
    reopenSources: boolean("reopen_sources").notNull().default(false),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    projectId: uuid("project_id").references(() => projects.id),
    invoiceDate: date("invoice_date").notNull(),
    dueDate: date("due_date").notNull(),
    currency: char("currency", { length: 3 }).notNull().default("DKK"),
    fxRate: numeric("fx_rate", { precision: 12, scale: 6, mode: "number" }).notNull().default(1),
    heading: text("heading"),
    ourReference: text("our_reference"),
    theirReference: text("their_reference"),
    attachSpecification: boolean("attach_specification").notNull().default(true),
    subtotal: bigint("subtotal", { mode: "number" }).notNull().default(0),
    vat: bigint("vat", { mode: "number" }).notNull().default(0),
    total: bigint("total", { mode: "number" }).notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id),
    bookedAt: timestamp("booked_at", { withTimezone: true }),
    bookedBy: uuid("booked_by").references(() => users.id),
    /** id in the accounting system once synced */
    externalId: text("external_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("invoices_entity_number_uq")
      .on(t.legalEntityId, t.number)
      .where(sql`${t.number} is not null`),
    index("invoices_customer_idx").on(t.tenantId, t.customerId),
    check("invoices_booked_has_number", sql`(${t.status} = 'booked') = (${t.number} is not null)`),
  ],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: id(),
    tenantId: tenantId(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    sort: integer("sort").notNull().default(0),
    kind: invoiceLineKindEnum("kind").notNull(),
    description: text("description").notNull(),
    /** hours or units, 2 decimals */
    quantity: numeric("quantity", { precision: 10, scale: 2, mode: "number" }).notNull().default(0),
    unitPrice: bigint("unit_price", { mode: "number" }).notNull().default(0),
    discountBp: integer("discount_bp").notNull().default(0),
    amount: bigint("amount", { mode: "number" }).notNull().default(0),
    /** amount before write-down/up (registered value) */
    originalAmount: bigint("original_amount", { mode: "number" }),
    writeReason: text("write_reason"),
    vatBp: integer("vat_bp").notNull().default(2500),
    projectId: uuid("project_id").references(() => projects.id),
    paymentPlanItemId: uuid("payment_plan_item_id").references(() => paymentPlanItems.id),
    /** on a credit note: the original invoice line this line credits */
    creditsLineId: uuid("credits_line_id").references((): AnyPgColumn => invoiceLines.id),
  },
  (t) => [index("invoice_lines_invoice_idx").on(t.invoiceId)],
);

/** Which time entries an invoice line covers, with registered and invoiced value (write-down analytics). */
export const invoiceLineSources = pgTable(
  "invoice_line_sources",
  {
    id: id(),
    tenantId: tenantId(),
    invoiceLineId: uuid("invoice_line_id")
      .notNull()
      .references(() => invoiceLines.id, { onDelete: "cascade" }),
    timeEntryId: uuid("time_entry_id")
      .notNull()
      .references(() => timeEntries.id),
    hours: hours("hours").notNull(),
    value: bigint("value", { mode: "number" }).notNull(),
    invoiced: bigint("invoiced", { mode: "number" }).notNull(),
  },
  (t) => [index("invoice_line_sources_entry_idx").on(t.timeEntryId)],
);

/* ───────────────────────────── M2: accounting periods & revenue ───────────────────────────── */

export const periodStateEnum = pgEnum("accounting_period_status", ["open", "closed"]);

export const accountingPeriods = pgTable(
  "accounting_periods",
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid("legal_entity_id")
      .notNull()
      .references(() => legalEntities.id),
    /** first day of the month */
    month: date("month").notNull(),
    status: periodStateEnum("status").notNull().default("open"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id),
  },
  (t) => [uniqueIndex("accounting_periods_entity_month_uq").on(t.legalEntityId, t.month)],
);

/** Snapshot taken when a month is closed: fixed-price revenue recognised to date and the month's delta. */
export const revenueRecognitions = pgTable(
  "revenue_recognitions",
  {
    id: id(),
    tenantId: tenantId(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id),
    month: date("month").notNull(),
    completionBp: integer("completion_bp").notNull(),
    recognisedToDate: bigint("recognised_to_date", { mode: "number" }).notNull(),
    delta: bigint("delta", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("revenue_recognitions_contract_month_uq").on(t.contractId, t.month)],
);

/* ───────────────────────────── M2: integrations ───────────────────────────── */

/** Configured accounting/payroll connections. Secrets live in env/secret store, never in this table. */
export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: id(),
    tenantId: tenantId(),
    kind: text("kind").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (t) => [uniqueIndex("integration_connections_tenant_kind_uq").on(t.tenantId, t.kind)],
);

/** Transactional outbox: events written in the same transaction as the change, delivered by a worker. */
export const outbox = pgTable(
  "outbox",
  {
    id: id(),
    tenantId: tenantId(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: createdAt(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [index("outbox_pending_idx").on(t.status, t.createdAt)],
);

/* ───────────────────────────── M3: expenses, mileage, files ───────────────────────────── */

/** Expense categories; `vatDeductibleBp` is the share of the VAT the company may deduct (e.g. 2500 for restaurant). */
export const expenseTypes = pgTable("expense_types", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  vatBp: integer("vat_bp").notNull().default(2500),
  vatDeductibleBp: integer("vat_deductible_bp").notNull().default(10_000),
  active: boolean("active").notNull().default(true),
});

/** Mileage allowance per year: high rate (øre/km) up to the threshold, low rate above. Configuration, verified by Finance. */
export const mileageRates = pgTable(
  "mileage_rates",
  {
    id: id(),
    tenantId: tenantId(),
    year: integer("year").notNull(),
    highRate: bigint("high_rate", { mode: "number" }).notNull(),
    lowRate: bigint("low_rate", { mode: "number" }).notNull(),
    thresholdKm: integer("threshold_km").notNull().default(20_000),
  },
  (t) => [uniqueIndex("mileage_rates_tenant_year_uq").on(t.tenantId, t.year)],
);

/** Uploaded files (receipts). The bytes live on disk under data/uploads/<tenant>/<id>; this row is the metadata. */
export const files = pgTable("files", {
  id: id(),
  tenantId: tenantId(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  createdAt: createdAt(),
});

export const expenseKindEnum = pgEnum("expense_kind", ["expense", "mileage"]);

/**
 * An out-of-pocket expense or a mileage claim. Amounts in øre in `currency`; for mileage, `km` and the computed
 * allowance (`grossAmount`, no VAT). Same lifecycle as time entries: draft → submitted → approved → invoiced.
 */
export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    date: date("date").notNull(),
    kind: expenseKindEnum("kind").notNull(),
    projectId: uuid("project_id").references(() => projects.id),
    expenseTypeId: uuid("expense_type_id").references(() => expenseTypes.id),
    description: text("description").notNull(),
    currency: char("currency", { length: 3 }).notNull().default("DKK"),
    grossAmount: bigint("gross_amount", { mode: "number" }).notNull(),
    vatAmount: bigint("vat_amount", { mode: "number" }).notNull().default(0),
    netAmount: bigint("net_amount", { mode: "number" }).notNull(),
    /** what the company bears: net + non-deductible VAT (øre) */
    costAmount: bigint("cost_amount", { mode: "number" }).notNull(),
    billable: boolean("billable").notNull().default(false),
    markupBp: integer("markup_bp").notNull().default(0),
    km: numeric("km", { precision: 8, scale: 1, mode: "number" }),
    fromPlace: text("from_place"),
    toPlace: text("to_place"),
    receiptFileId: uuid("receipt_file_id").references(() => files.id),
    status: entryStatusEnum("status").notNull().default("draft"),
    rejectComment: text("reject_comment"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    invoiceLineId: uuid("invoice_line_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("expenses_user_date_idx").on(t.tenantId, t.userId, t.date),
    index("expenses_project_idx").on(t.tenantId, t.projectId),
    check("expenses_billable_needs_project", sql`not ${t.billable} or ${t.projectId} is not null`),
  ],
);

/* ───────────────────────────── M3: resource planning ───────────────────────────── */

/** Planned hours: one employee on one project in one ISO week (decision OQ-28 default: weekly granularity). */
export const allocations = pgTable(
  "allocations",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    weekStart: date("week_start").notNull(),
    hours: hours("hours").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("allocations_user_project_week_uq").on(t.userId, t.projectId, t.weekStart),
    index("allocations_week_idx").on(t.tenantId, t.weekStart),
  ],
);

/** Competencies as simple tags per employee (e.g. "DGNB", "Brandrådgivning", "Revit"), used to find people. */
export const userCompetencies = pgTable(
  "user_competencies",
  {
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.name] })],
);

/* ───────────────────────────── M3: reminders ───────────────────────────── */

/** E-mail reminders already sent, so the weekly job never sends the same reminder twice. */
export const reminderLog = pgTable(
  "reminder_log",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** what the reminder is about, e.g. the ISO week "2026-11-02" */
    ref: text("ref").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("reminder_log_uq").on(t.userId, t.kind, t.ref)],
);

/* ───────────────────────────── M3: Outlook calendar import ───────────────────────────── */

/**
 * Delegated Microsoft Graph access token per user (read-only scope Calendars.Read), AES-GCM encrypted with a key
 * derived from SESSION_SECRET. Short-lived (about 1 h); no refresh tokens are kept. Only written when calendar import is on.
 */
export const graphTokens = pgTable("graph_tokens", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  tenantId: tenantId(),
  tokenEnc: text("token_enc").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** Calendar events (per day) the user has imported into the timesheet or chosen to ignore — shown as handled. */
export const calendarImports = pgTable(
  "calendar_imports",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    date: date("date").notNull(),
    /** imported | ignored */
    state: text("state").notNull(),
    taskId: uuid("task_id").references(() => tasks.id),
    hours: hours("hours"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("calendar_imports_uq").on(t.userId, t.eventId, t.date)],
);

/* ───────────────────────────── M4: payroll export ───────────────────────────── */

/**
 * Salary codes ("lønarter") the payroll system knows. kind says what feeds it: absence (via absence_codes.salary_code_id),
 * mileage (approved mileage claims, km + amount) or expense (approved personal expenses, amount).
 */
export const salaryCodes = pgTable(
  "salary_codes",
  {
    id: id(),
    tenantId: tenantId(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** hours | days | km | amount */
    unit: text("unit").notNull(),
    /** absence | mileage | expense */
    kind: text("kind").notNull(),
    /** the payroll provider's own code, if different */
    providerCode: text("provider_code"),
    includeInExport: boolean("include_in_export").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("salary_codes_tenant_code_uq").on(t.tenantId, t.code)],
);

/** Monthly pay periods: open → exported → locked. Locked months are frozen; later changes become late lines. */
export const payPeriods = pgTable(
  "pay_periods",
  {
    id: id(),
    tenantId: tenantId(),
    /** first day of the month */
    month: date("month").notNull(),
    /** open | exported | locked */
    status: text("status").notNull().default("open"),
    exportedAt: timestamp("exported_at", { withTimezone: true }),
    exportedBy: uuid("exported_by").references(() => users.id),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: uuid("locked_by").references(() => users.id),
  },
  (t) => [uniqueIndex("pay_periods_tenant_month_uq").on(t.tenantId, t.month)],
);

/** One generated export file for a pay period. Re-running an unlocked period replaces its run (AC4). */
export const payrollRuns = pgTable("payroll_runs", {
  id: id(),
  tenantId: tenantId(),
  payPeriodId: uuid("pay_period_id")
    .notNull()
    .references(() => payPeriods.id),
  csv: text("csv").notNull(),
  lineCount: integer("line_count").notNull(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
});

/** Lines of a run; `month` is the month the items are dated in (earlier than the run's month for late lines). */
export const payrollLines = pgTable(
  "payroll_lines",
  {
    id: id(),
    tenantId: tenantId(),
    runId: uuid("run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    salaryCodeId: uuid("salary_code_id")
      .notNull()
      .references(() => salaryCodes.id),
    month: date("month").notNull(),
    /** hundredths of the code's unit */
    quantity: integer("quantity").notNull(),
    /** øre */
    amount: bigint("amount", { mode: "number" }),
    sourceCount: integer("source_count").notNull(),
  },
  (t) => [index("payroll_lines_run_idx").on(t.runId)],
);

/* ───────────────────────────── Access: extra rights ───────────────────────────── */

/** Extra rights on top of roles (D-025), e.g. a project manager who may create projects ("create if right"). */
export const userRights = pgTable(
  "user_rights",
  {
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    right: text("right").notNull(),
    grantedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.right] })],
);

/* ───────────────────────────── API tokens (Power BI / Excel) ───────────────────────────── */

/**
 * Personal read-only tokens for the analytics service (spec integrations R10, decision D-028), e.g. Power BI's
 * Web connector. Only the SHA-256 hash is stored; the raw token is shown once. Revocable; expire after a year.
 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    /** first characters of the token, so the owner can recognise it ("arct_ab12…") */
    prefix: text("prefix").notNull(),
    /** analytics = read-only datasets and KPI export */
    scope: text("scope").notNull().default("analytics"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("api_tokens_hash_uq").on(t.tokenHash), index("api_tokens_user_idx").on(t.userId)],
);
