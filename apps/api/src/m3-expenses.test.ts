/**
 * M3 expenses against the seeded dev database: amounts, receipts (type/size/access), approval permissions and the
 * flow into invoicing (re-invoiced once, credited back). Repeatable: each run creates its own expense.
 */
import { createDb } from "@arc-tid/db";
import { todayCopenhagen } from "@arc-tid/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig({ NODE_ENV: "test", DEV_LOGIN_ENABLED: "true", AUTH_RATE_LIMIT: "1000" });
const { db, close } = createDb(config.DATABASE_URL, { max: 2 });
let app: FastifyInstance;
const today = todayCopenhagen();

type Session = { cookie: string; csrf: string };
const sessions = new Map<string, Session>();
async function as(initials: string): Promise<Session> {
  const cached = sessions.get(initials);
  if (cached) return cached;
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/dev-login",
    payload: { email: `${initials.toLowerCase()}@demo.arcnordic.test`, password: "demo1234" },
  });
  const s = {
    cookie: `arc_sid=${res.cookies.find((c) => c.name === "arc_sid")?.value}`,
    csrf: res.json().csrfToken as string,
  };
  sessions.set(initials, s);
  return s;
}
const get = async (who: string, url: string) =>
  app.inject({ url, headers: { cookie: (await as(who)).cookie } });
const send = async (who: string, method: "POST" | "PUT" | "DELETE", url: string, payload?: object) => {
  const s = await as(who);
  return app.inject({ method, url, payload, headers: { cookie: s.cookie, "x-csrf-token": s.csrf } });
};
/** Builds a multipart/form-data body with one file field. */
async function upload(who: string, filename: string, bytes: Buffer) {
  const s = await as(who);
  const boundary = "----arcTest";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: "POST",
    url: "/api/v1/files",
    payload: body,
    headers: {
      cookie: s.cookie,
      "x-csrf-token": s.csrf,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
  });
}
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);

async function projectId(number: string) {
  return (await get("JF", "/api/v1/projects")).json().find((p: { number: string }) => p.number === number);
}

beforeAll(async () => {
  app = await buildApp(config, db);
});
afterAll(async () => {
  await app.close();
  await close();
});

describe("registering expenses", () => {
  it("splits 25 % VAT and keeps only the deductible share for representation", async () => {
    const settings = (await get("LV", "/api/v1/expenses/settings")).json();
    const repr = settings.types.find((t: { name: string }) => t.name.startsWith("Restaurant"));
    const res = await send("LV", "POST", "/api/v1/expenses", {
      date: today,
      kind: "expense",
      description: "Frokostmøde",
      expenseTypeId: repr.id,
      amount: 1250,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      grossAmount: 125_000,
      vatAmount: 25_000,
      netAmount: 100_000,
      costAmount: 118_750,
      status: "draft",
    });
    await send("LV", "DELETE", `/api/v1/expenses/${res.json().id}`);
  });

  it("computes mileage from the year's rate table", async () => {
    const res = await send("LV", "POST", "/api/v1/expenses", {
      date: today,
      kind: "mileage",
      description: "Kundemøde",
      km: 10,
    });
    expect(res.json().grossAmount).toBeGreaterThan(0);
    expect(res.json().vatAmount).toBe(0);
    await send("LV", "DELETE", `/api/v1/expenses/${res.json().id}`);
  });

  it("refuses re-invoicing without a project and projects the employee is not on", async () => {
    expect(
      (
        await send("LV", "POST", "/api/v1/expenses", {
          date: today,
          kind: "expense",
          description: "x",
          amount: 10,
          billable: true,
        })
      ).json().error,
    ).toBe("billable_needs_project");
    const foreign = await projectId("26003");
    expect(
      (
        await send("LV", "POST", "/api/v1/expenses", {
          date: today,
          kind: "expense",
          description: "x",
          amount: 10,
          projectId: foreign.id,
        })
      ).statusCode,
    ).toBe(403);
  });

  it("§9: refuses expenses in a closed accounting month", async () => {
    expect(
      (
        await send("LV", "POST", "/api/v1/expenses", {
          date: "2026-08-20",
          kind: "expense",
          description: "x",
          amount: 10,
        })
      ).json().error,
    ).toBe("period_closed");
  });
});

describe("receipts", () => {
  it("accepts images/PDF by content, refuses other types and files over 10 MB", async () => {
    expect((await upload("LV", "kvittering.png", PNG)).statusCode).toBe(200);
    expect((await upload("LV", "kvittering.png", Buffer.from("not an image"))).json().error).toBe(
      "file_type_not_allowed",
    );
    expect(
      (await upload("LV", "stor.png", Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]))).statusCode,
    ).toBe(413);
  });

  it("only the owner, the approver and Finance can open a receipt", async () => {
    const file = (await upload("LV", "kvittering.png", PNG)).json();
    expect((await get("LV", `/api/v1/files/${file.id}`)).statusCode).toBe(200);
    expect((await get("AL", `/api/v1/files/${file.id}`)).statusCode).toBe(200); // Laura's line manager
    expect((await get("JF", `/api/v1/files/${file.id}`)).statusCode).toBe(200); // finance
    expect((await get("OB", `/api/v1/files/${file.id}`)).statusCode).toBe(404); // colleague
  });
});

describe("approval and invoicing", () => {
  it("submit → only the line manager approves → re-invoiced once with markup → credit re-opens", async () => {
    const p = await projectId("26004");
    const file = (await upload("LV", "taxa.png", PNG)).json();
    const created = await send("LV", "POST", "/api/v1/expenses", {
      date: today,
      kind: "expense",
      description: "Taxa test",
      amount: 500,
      projectId: p.id,
      billable: true,
      markupPct: 10,
      receiptFileId: file.id,
    });
    const id = created.json().id;
    expect((await send("LV", "POST", "/api/v1/expenses/submit", { ids: [id] })).json().submitted).toBe(1);

    // Peter is a PM but not Laura's line manager; Laura cannot approve her own
    expect((await send("PD", "POST", `/api/v1/expenses/${id}/approve`)).statusCode).toBe(403);
    expect((await send("LV", "POST", `/api/v1/expenses/${id}/approve`)).statusCode).toBe(403);
    const queue = (await get("AL", "/api/v1/expense-approvals")).json();
    expect(queue.some((x: { id: string }) => x.id === id)).toBe(true);
    expect((await send("AL", "POST", `/api/v1/expenses/${id}/approve`)).statusCode).toBe(200);

    // Appears in the basis and on the draft: net 400 + 10 % = 440 kr
    const basis = (await get("JF", `/api/v1/invoicing/basis?upTo=${today}`)).json();
    const row = basis.find((b: { projectId: string }) => b.projectId === p.id);
    expect(row.expenses).toBeGreaterThanOrEqual(44_000);
    const draft = await send("JF", "POST", "/api/v1/invoices/drafts", {
      customerId: row.customerId,
      projectIds: [p.id],
      upTo: today,
      invoiceDate: today,
      grouping: "summary",
    });
    const invoiceId = draft.json().id;
    const inv = (await get("JF", `/api/v1/invoices/${invoiceId}`)).json();
    const line = inv.lines.find(
      (l: { kind: string; description: string }) =>
        l.kind === "expense" && l.description.includes("Taxa test"),
    );
    expect(line.amount).toBe(44_000);
    expect(inv.totals.subtotal).toBeGreaterThanOrEqual(44_000);

    // Booking marks it invoiced; it never appears again
    const booked = await send("JF", "POST", `/api/v1/invoices/${invoiceId}/book`);
    expect(booked.statusCode).toBe(200);
    const after = (await get("JF", `/api/v1/invoicing/basis?upTo=${today}`))
      .json()
      .find((b: { projectId: string }) => b.projectId === p.id);
    expect(after?.expenses ?? 0).toBe(0); // everything billable on the project was on the booked invoice

    // Credit note with re-open puts it back
    const credit = (
      await send("JF", "POST", `/api/v1/invoices/${invoiceId}/credit`, { reopenSources: true })
    ).json().id;
    await send("JF", "POST", `/api/v1/invoices/${credit}/book`);
    const reopened = (await get("JF", `/api/v1/invoicing/basis?upTo=${today}`))
      .json()
      .find((b: { projectId: string }) => b.projectId === p.id);
    expect(reopened.expenses).toBe(row.expenses);
  });
});
