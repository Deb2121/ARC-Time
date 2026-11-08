/**
 * M0 schema: tenants, legal entities, departments, users, roles, sessions, audit log.
 * Every tenant-scoped table carries tenant_id and is protected by row-level security (decision D-012);
 * the policies live in the hand-written migration drizzle/0001_rls.sql.
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  char,
  index,
  jsonb,
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
