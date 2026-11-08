/**
 * People endpoints. Visibility (docs/spec/overview.md §3): admin, finance and management see everyone;
 * a line manager sees their direct and indirect reports; everyone sees themselves.
 */
import { schema, type Tx, writeAudit } from "@arc-tid/db";
import { hasRole, ROLES, type Role } from "@arc-tid/domain";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError, requireRole } from "../auth/plugin.ts";

const UserDto = z.object({
  id: z.string().uuid(),
  email: z.string(),
  fullName: z.string(),
  initials: z.string(),
  departmentId: z.string().uuid().nullable(),
  managerId: z.string().uuid().nullable(),
  active: z.boolean(),
  roles: z.array(z.enum(ROLES)),
});
type UserDto = z.infer<typeof UserDto>;

async function reportIds(tx: Tx, managerId: string): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    with recursive r as (
      select id from users where manager_id = ${managerId}
      union
      select u.id from users u join r on u.manager_id = r.id
    ) select id from r`);
  return rows.map((x) => x.id);
}

async function loadUsers(tx: Tx, ids?: string[]): Promise<UserDto[]> {
  const where = ids ? inArray(schema.users.id, ids) : undefined;
  const people = await tx.select().from(schema.users).where(where).orderBy(asc(schema.users.fullName));
  const roles = await tx.select().from(schema.userRoles);
  return people.map((u) => ({
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    initials: u.initials,
    departmentId: u.departmentId,
    managerId: u.managerId,
    active: u.active,
    roles: roles.filter((r) => r.userId === u.id).map((r) => r.role),
  }));
}

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/me",
    { schema: { response: { 200: UserDto.extend({ tenantId: z.string(), csrfToken: z.string() }) } } },
    async (req) => {
      const auth = req.auth;
      if (!auth) throw new HttpError(401, "unauthenticated");
      const [me] = await req.withTenant((tx) => loadUsers(tx, [auth.userId]));
      if (!me) throw new HttpError(404, "not_found");
      return { ...me, tenantId: auth.tenantId, csrfToken: auth.csrfToken };
    },
  );

  app.get("/users", { schema: { response: { 200: z.array(UserDto) } } }, async (req) => {
    const auth = req.auth;
    if (!auth) throw new HttpError(401, "unauthenticated");
    return req.withTenant(async (tx) => {
      if (hasRole(auth.roles, "admin", "finance", "management")) return loadUsers(tx);
      const ids = [auth.userId];
      if (hasRole(auth.roles, "line_manager")) ids.push(...(await reportIds(tx, auth.userId)));
      return loadUsers(tx, ids);
    });
  });

  app.put(
    "/users/:id/roles",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ roles: z.array(z.enum(ROLES)).min(1), reason: z.string().max(500).optional() }),
        response: { 200: UserDto },
      },
    },
    async (req) => {
      const auth = requireRole(req, "admin");
      const { id } = req.params;
      const roles: Role[] = Array.from(new Set<Role>(["employee", ...req.body.roles]));
      if (id === auth.userId && !roles.includes("admin")) throw new HttpError(400, "cannot_remove_own_admin");
      return req.withTenant(async (tx) => {
        const [before] = await loadUsers(tx, [id]);
        if (!before) throw new HttpError(404, "not_found");
        await tx.delete(schema.userRoles).where(and(eq(schema.userRoles.userId, id)));
        await tx
          .insert(schema.userRoles)
          .values(roles.map((role) => ({ tenantId: auth.tenantId, userId: id, role })));
        const [after] = await loadUsers(tx, [id]);
        if (!after) throw new HttpError(404, "not_found");
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "user_roles",
          entityId: id,
          action: "update",
          userId: auth.userId,
          before: { roles: before.roles },
          after: { roles: after.roles },
          reason: req.body.reason ?? null,
        });
        return after;
      });
    },
  );
};
