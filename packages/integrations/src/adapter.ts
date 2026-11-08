/**
 * Accounting integration adapter (brief §4.14, docs/spec/integrations.md). Every external system sits behind this
 * interface, is disabled by default, and is only ever pointed at sandbox/test accounts during development.
 */
export interface CustomerDoc {
  number: string;
  name: string;
  cvr: string | null;
  ean: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  currency: string;
  paymentTermsDays: number;
}

export interface InvoiceLineDoc {
  description: string;
  quantity: number;
  /** øre */
  unitPrice: number;
  discountBp: number;
  /** øre */
  amount: number;
}

export interface InvoiceDoc {
  number: number;
  type: "invoice" | "credit";
  invoiceDate: string;
  dueDate: string;
  currency: string;
  heading: string | null;
  customer: CustomerDoc;
  lines: InvoiceLineDoc[];
  /** øre */
  subtotal: number;
  vat: number;
  total: number;
}

export interface AccountingAdapter {
  readonly kind: string;
  testConnection(): Promise<void>;
  upsertCustomer(c: CustomerDoc): Promise<{ externalId: string }>;
  pushInvoice(inv: InvoiceDoc): Promise<{ externalId: string }>;
}

/**
 * Error from an external system. `retryable` tells the outbox worker whether to try again (5xx/429) or give up.
 */
export class IntegrationError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
  ) {
    super(message);
  }
}
