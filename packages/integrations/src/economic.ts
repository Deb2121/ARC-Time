/**
 * e-conomic adapter (REST API, https://restapi.e-conomic.com). Built against e-conomic's public API documentation;
 * request shapes are [Assumed] until verified against a sandbox agreement. Disabled unless both tokens are configured.
 *
 * Flow for a booked invoice: ensure the customer exists → create a draft invoice → book it with the same number,
 * so the number in ARCnordic Tid and in the accounting system match.
 */
import { type AccountingAdapter, type CustomerDoc, IntegrationError, type InvoiceDoc } from "./adapter.ts";

export interface EconomicConfig {
  appSecretToken: string;
  agreementGrantToken: string;
  baseUrl?: string;
  customerGroupNumber: number;
  vatZoneNumber: number;
  layoutNumber: number;
  paymentTermsNumber: number;
  productNumber: string;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export const toEconomicCustomer = (c: CustomerDoc, cfg: EconomicConfig) => ({
  customerNumber: Number(c.number),
  name: c.name,
  currency: c.currency,
  corporateIdentificationNumber: c.cvr ?? undefined,
  ean: c.ean ?? undefined,
  address: c.address ?? undefined,
  zip: c.postalCode ?? undefined,
  city: c.city ?? undefined,
  customerGroup: { customerGroupNumber: cfg.customerGroupNumber },
  vatZone: { vatZoneNumber: cfg.vatZoneNumber },
  paymentTerms: { paymentTermsNumber: cfg.paymentTermsNumber },
});

/** Amounts in e-conomic are decimal kroner; quantities may be negative on credit notes. */
export const toEconomicDraft = (inv: InvoiceDoc, cfg: EconomicConfig) => ({
  date: inv.invoiceDate,
  dueDate: inv.dueDate,
  currency: inv.currency,
  paymentTerms: { paymentTermsNumber: cfg.paymentTermsNumber },
  layout: { layoutNumber: cfg.layoutNumber },
  customer: { customerNumber: Number(inv.customer.number) },
  recipient: { name: inv.customer.name, vatZone: { vatZoneNumber: cfg.vatZoneNumber } },
  notes: inv.heading ? { heading: inv.heading.slice(0, 250) } : undefined,
  lines: inv.lines.map((l, i) => ({
    lineNumber: i + 1,
    description: l.description.slice(0, 2500),
    quantity: l.quantity,
    unitNetPrice: l.unitPrice / 100,
    discountPercentage: l.discountBp / 100,
    product: { productNumber: cfg.productNumber },
  })),
});

export class EconomicAdapter implements AccountingAdapter {
  readonly kind = "economic";
  private readonly base: string;

  constructor(
    private readonly cfg: EconomicConfig,
    private readonly fetchFn: FetchLike = fetch,
  ) {
    this.base = cfg.baseUrl ?? "https://restapi.e-conomic.com";
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.base}${path}`, {
      method,
      headers: {
        "X-AppSecretToken": this.cfg.appSecretToken,
        "X-AgreementGrantToken": this.cfg.agreementGrantToken,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new IntegrationError(
        `e-conomic ${method} ${path} → ${res.status} ${text.slice(0, 300)}`,
        res.status >= 500 || res.status === 429,
      );
    }
    return (await res.json()) as T;
  }

  async testConnection(): Promise<void> {
    await this.call("GET", "/self");
  }

  async upsertCustomer(c: CustomerDoc): Promise<{ externalId: string }> {
    const body = toEconomicCustomer(c, this.cfg);
    try {
      await this.call("PUT", `/customers/${body.customerNumber}`, body);
    } catch (e) {
      if (e instanceof IntegrationError && /→ 404/.test(e.message))
        await this.call("POST", "/customers", body);
      else throw e;
    }
    return { externalId: String(body.customerNumber) };
  }

  async pushInvoice(inv: InvoiceDoc): Promise<{ externalId: string }> {
    await this.upsertCustomer(inv.customer);
    const draft = await this.call<{ draftInvoiceNumber: number }>(
      "POST",
      "/invoices/drafts",
      toEconomicDraft(inv, this.cfg),
    );
    const booked = await this.call<{ bookedInvoiceNumber: number }>("POST", "/invoices/booked", {
      draftInvoice: { draftInvoiceNumber: draft.draftInvoiceNumber },
      bookWithNumber: inv.number,
    });
    return { externalId: String(booked.bookedInvoiceNumber) };
  }
}

/** Builds the adapter from environment variables, or null when not configured (the default). */
export function economicFromEnv(env: Record<string, string | undefined>): EconomicAdapter | null {
  if (!env.ECONOMIC_APP_SECRET_TOKEN || !env.ECONOMIC_AGREEMENT_GRANT_TOKEN) return null;
  return new EconomicAdapter({
    appSecretToken: env.ECONOMIC_APP_SECRET_TOKEN,
    agreementGrantToken: env.ECONOMIC_AGREEMENT_GRANT_TOKEN,
    baseUrl: env.ECONOMIC_BASE_URL,
    customerGroupNumber: Number(env.ECONOMIC_CUSTOMER_GROUP ?? 1),
    vatZoneNumber: Number(env.ECONOMIC_VAT_ZONE ?? 1),
    layoutNumber: Number(env.ECONOMIC_LAYOUT ?? 19),
    paymentTermsNumber: Number(env.ECONOMIC_PAYMENT_TERMS ?? 1),
    productNumber: env.ECONOMIC_PRODUCT ?? "1",
  });
}
