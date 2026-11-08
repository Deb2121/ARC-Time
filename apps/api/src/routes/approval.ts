/**
 * Approval routes (docs/spec/approval.md) — GRASP Controller: validate input and delegate to
 * `services/approval.ts`, which also checks that the caller is the approver.
 *
 *   GET  /approvals?weekStart=YYYY-MM-DD       approver inbox for one week
 *   POST /approvals/:periodId/approve          approve a submitted week (takes rate snapshots)
 *   POST /approvals/bulk-approve               approve several weeks in one transaction
 *   POST /approvals/:periodId/reject           reject with a required comment
 *   POST /approvals/:periodId/reopen           reopen an approved week with a reason (audited)
 *   GET  /approvals/projects                   project manager inbox (mode pm_then_line_manager)
 *   POST /approvals/projects/decide            project manager approves/rejects a week on their project
 */
import { isoWeekday } from "@arc-tid/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthContext } from "../auth/plugin.ts";
import { approvalInbox, approvePeriod, rejectPeriod, reopenApprovedPeriod } from "../services/approval.ts";
import { pmDecide, pmInbox } from "../services/project-approval.ts";

const monday = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => isoWeekday(d) === 1, "must be a Monday");
const periodParams = z.object({ periodId: z.string().uuid() });

/** Registers the approval endpoints under /api/v1. */
export const approvalRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/approvals/projects", async (req) => req.withTenant((tx) => pmInbox(tx, req.auth as AuthContext)));

  app.post(
    "/approvals/projects/decide",
    {
      schema: {
        body: z.object({
          userId: z.string().uuid(),
          weekStart: monday,
          projectId: z.string().uuid(),
          decision: z.enum(["approve", "reject"]),
          comment: z.string().trim().max(1000).optional(),
        }),
      },
    },
    async (req) => req.withTenant((tx) => pmDecide(tx, req.auth as AuthContext, req.body)),
  );

  app.get("/approvals", { schema: { querystring: z.object({ weekStart: monday }) } }, async (req) =>
    req.withTenant((tx) => approvalInbox(tx, req.auth as AuthContext, req.query.weekStart)),
  );

  app.post("/approvals/:periodId/approve", { schema: { params: periodParams } }, async (req) =>
    req.withTenant((tx) => approvePeriod(tx, req.auth as AuthContext, req.params.periodId)),
  );

  app.post(
    "/approvals/bulk-approve",
    { schema: { body: z.object({ periodIds: z.array(z.string().uuid()).min(1).max(200) }) } },
    async (req) =>
      req.withTenant(async (tx) => {
        const results = [];
        for (const id of req.body.periodIds)
          results.push({ periodId: id, ...(await approvePeriod(tx, req.auth as AuthContext, id)) });
        return { results };
      }),
  );

  app.post(
    "/approvals/:periodId/reject",
    {
      schema: {
        params: periodParams,
        body: z.object({ comment: z.string().trim().min(1, "comment_required").max(1000) }),
      },
    },
    async (req) =>
      req.withTenant((tx) =>
        rejectPeriod(tx, req.auth as AuthContext, req.params.periodId, req.body.comment),
      ),
  );

  app.post(
    "/approvals/:periodId/reopen",
    { schema: { params: periodParams, body: z.object({ reason: z.string().trim().min(1).max(1000) }) } },
    async (req) =>
      req.withTenant((tx) =>
        reopenApprovedPeriod(tx, req.auth as AuthContext, req.params.periodId, req.body.reason),
      ),
  );
};
