import type { Db } from "@arc-tid/db";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
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
import { authPlugin, HttpError } from "./auth/plugin.ts";
import { authRoutes } from "./auth/routes.ts";
import type { Config } from "./config.ts";
import { approvalRoutes } from "./routes/approval.ts";
import { projectRoutes } from "./routes/projects.ts";
import { reportRoutes } from "./routes/reports.ts";
import { timesheetRoutes } from "./routes/timesheet.ts";
import { userRoutes } from "./routes/users.ts";

export async function buildApp(config: Config, db: Db) {
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

  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({ error: "validation_failed", details: err.validation });
    }
    if (err instanceof HttpError) {
      const details = (err as HttpError & { details?: unknown }).details;
      return reply.status(err.statusCode).send(details ? { error: err.code, details } : { error: err.code });
    }
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
    },
    { prefix: "/api/v1" },
  );

  return app;
}
