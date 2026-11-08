import { describe, expect, it } from "vitest";
import type { InvoiceDoc } from "./adapter.ts";
import { EconomicAdapter, economicFromEnv, toEconomicDraft } from "./economic.ts";

const cfg = {
  appSecretToken: "sandbox-app",
  agreementGrantToken: "sandbox-grant",
  baseUrl: "https://sandbox.invalid",
  customerGroupNumber: 1,
  vatZoneNumber: 1,
  layoutNumber: 19,
  paymentTermsNumber: 1,
  productNumber: "100",
};

const invoice: InvoiceDoc = {
  number: 1014,
  type: "invoice",
  invoiceDate: "2026-11-30",
  dueDate: "2026-12-30",
  currency: "DKK",
  heading: "26004 Kontorhus Nordvang – indretning",
  customer: {
    number: "1003",
    name: "Nordvang Ejendomme A/S",
    cvr: "30000006",
    ean: null,
    address: "Nordvangsvej 40",
    postalCode: "2100",
    city: "København Ø",
    currency: "DKK",
    paymentTermsDays: 30,
  },
  lines: [
    {
      description: "1 Behovsanalyse og workshops",
      quantity: 7.5,
      unitPrice: 105000,
      discountBp: 0,
      amount: 787500,
    },
  ],
  subtotal: 787500,
  vat: 196875,
  total: 984375,
};

describe("e-conomic adapter (no network: fake fetch)", () => {
  it("is disabled unless both tokens are configured", () => {
    expect(economicFromEnv({})).toBeNull();
    expect(economicFromEnv({ ECONOMIC_APP_SECRET_TOKEN: "x" })).toBeNull();
    expect(
      economicFromEnv({ ECONOMIC_APP_SECRET_TOKEN: "x", ECONOMIC_AGREEMENT_GRANT_TOKEN: "y" }),
    ).not.toBeNull();
  });

  it("maps amounts from øre to kroner", () => {
    const d = toEconomicDraft(invoice, cfg);
    expect(d.lines[0]).toMatchObject({
      quantity: 7.5,
      unitNetPrice: 1050,
      product: { productNumber: "100" },
    });
    expect(d.customer.customerNumber).toBe(1003);
  });

  it("creates the customer, a draft, then books with the same number", async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    const fake = async (url: string, init: RequestInit) => {
      calls.push({
        method: String(init.method),
        url,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      const headers = init.headers as Record<string, string>;
      expect(headers["X-AppSecretToken"]).toBe("sandbox-app");
      if (init.method === "PUT") return new Response("not found", { status: 404 });
      if (url.endsWith("/invoices/drafts")) return Response.json({ draftInvoiceNumber: 77 });
      if (url.endsWith("/invoices/booked")) return Response.json({ bookedInvoiceNumber: 1014 });
      return Response.json({});
    };
    const res = await new EconomicAdapter(cfg, fake).pushInvoice(invoice);
    expect(res.externalId).toBe("1014");
    expect(calls.map((c) => `${c.method} ${c.url.replace(cfg.baseUrl, "")}`)).toEqual([
      "PUT /customers/1003",
      "POST /customers",
      "POST /invoices/drafts",
      "POST /invoices/booked",
    ]);
    expect(calls[3]?.body).toEqual({ draftInvoice: { draftInvoiceNumber: 77 }, bookWithNumber: 1014 });
  });

  it("marks server errors as retryable and client errors as not", async () => {
    const fail = (status: number) => async () => new Response("x", { status });
    await expect(new EconomicAdapter(cfg, fail(503)).testConnection()).rejects.toMatchObject({
      retryable: true,
    });
    await expect(new EconomicAdapter(cfg, fail(400)).testConnection()).rejects.toMatchObject({
      retryable: false,
    });
  });
});
