/**
 * Fastify application factory — wires security plugins (helmet, CORS, cookies, rate limit), OpenAPI docs,
 * health checks, the auth plugin and all /api/v1 route modules, plus the global error handler that turns AppError,
 * invoice/period errors and Postgres check violations into `{ error: code }` responses. Used by server.ts and tests.
 */
import { type Db, InvoiceError, PeriodError } from "@arc-tid/db";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyError } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { authPlugin } from "./auth/plugin.ts";
import { authRoutes } from "./auth/routes.ts";
import type { Config } from "./config.ts";
import { adminRoutes } from "./routes/admin.ts";
import { approvalRoutes } from "./routes/approval.ts";
import { calendarRoutes } from "./routes/calendar.ts";
import { dataImportRoutes } from "./routes/data-import.ts";
import { expenseRoutes } from "./routes/expenses.ts";
import { financeRoutes } from "./routes/finance.ts";
import { invoicingRoutes } from "./routes/invoicing.ts";
import { payrollRoutes } from "./routes/payroll.ts";
import { planningRoutes } from "./routes/planning.ts";
import { projectRoutes } from "./routes/projects.ts";
import { reportRoutes } from "./routes/reports.ts";
import { timesheetRoutes } from "./routes/timesheet.ts";
import { userRoutes } from "./routes/users.ts";
import { AppError } from "./services/errors.ts";
import { type CalendarProvider, graphCalendarProvider } from "./services/outlook.ts";

/** Replaceable collaborators (tests pass fakes); defaults are the real, config-driven implementations. */
export interface AppDeps {
  calendar?: CalendarProvider;
}

/** Builds the configured Fastify app (no listening) — injected config and database make it testable with `app.inject`. */
export async function buildApp(config: Config, db: Db, deps: AppDeps = {}) {
  const calendar = deps.calendar ?? graphCalendarProvider(config.calendarEnabled, config.SESSION_SECRET);
  const app = Fastify({
    logger:
      config.NODE_ENV === "test"
        ? false
        : {
            level: config.NODE_ENV === "production" ? "info" : "debug",
            redact: ["req.headers.cookie", "req.headers['x-csrf-token']", "req.headers.authorization"],
          },
    trustProxy: config.NODE_ENV === "production",
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({ error: "validation_failed", details: err.validation });
    }
    if (err instanceof AppError) {
      const details = (err as AppError & { details?: unknown }).details;
      return reply.status(err.statusCode).send(details ? { error: err.code, details } : { error: err.code });
    }
    if (err instanceof InvoiceError || err instanceof PeriodError) {
      return reply.status(err.status).send({ error: err.code });
    }
    // Database triggers guarding booked invoices raise check_violation.
    const pgCode = (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (pgCode === "23514") return reply.status(409).send({ error: "immutable" });
    if ("statusCode" in err && err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: err.code ?? "bad_request" });
    }
    req.log.error(err);
    return reply.status(500).send({ error: "internal_error" });
  });

  await app.register(helmet, { contentSecurityPolicy: false }); // API serves JSON; CSP is set by the web app
  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
  });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 + 1, files: 1 } });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  await app.register(swagger, {
    openapi: { info: { title: "ARCnordic Tid API", version: "1.0.0" } },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });

  app.get("/health", { config: { public: true } }, async () => ({ status: "ok" }));
  app.get("/health/ready", { config: { public: true } }, async (_req, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: "ok" };
    } catch {
      return reply.status(503).send({ status: "db_unavailable" });
    }
  });

  await app.register(
    async (v1) => {
      await v1.register(authPlugin, { db });
      await v1.register(authRoutes, { db, config });
      await v1.register(userRoutes);
      await v1.register(timesheetRoutes);
      await v1.register(approvalRoutes);
      await v1.register(projectRoutes);
      await v1.register(reportRoutes);
      await v1.register(invoicingRoutes);
      await v1.register(financeRoutes);
      await v1.register(adminRoutes);
      await v1.register(expenseRoutes);
      await v1.register(planningRoutes);
      await v1.register(payrollRoutes);
      await v1.register(dataImportRoutes);
      await v1.register(calendarRoutes, { provider: calendar });
    },
    { prefix: "/api/v1" },
  );

  return app;
}
