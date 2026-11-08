/**
 * Thin client for the ARCnordic Tid API. Sends the session cookie and echoes the CSRF token on mutations.
 */
import type { Role } from "@arc-tid/domain";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
/** Base URL of the Python analytics service (KPI Excel export, Power BI datasets). */
export const ANALYTICS_URL = process.env.NEXT_PUBLIC_ANALYTICS_URL ?? "http://localhost:8000";

let csrfToken: string | null = null;
/** Remembers the session's CSRF token (from login or /me); it is sent on every mutating request. */
export const setCsrfToken = (t: string | null) => {
  csrfToken = t;
};

/**
 * Error thrown by `api` for non-2xx responses; `code` is the API's error code (translate with `err.<code>`).
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

/**
 * Calls the ARCnordic Tid API under /api/v1 with the session cookie, JSON body and CSRF header; returns parsed JSON.
 * @example const me = await api<Me>("/me")
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (method !== "GET" && csrfToken) headers.set("x-csrf-token", csrfToken);
  const res = await fetch(`${API_URL}/api/v1${path}`, { ...init, method, headers, credentials: "include" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? "error");
  }
  return (await res.json()) as T;
}

export interface Person {
  id: string;
  email: string;
  fullName: string;
  initials: string;
  departmentId: string | null;
  managerId: string | null;
  active: boolean;
  roles: Role[];
}

export interface Me extends Person {
  tenantId: string;
  csrfToken: string;
}

/** Metadata of an uploaded file (receipt) as returned by POST /files. */
export interface UploadedFile {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

/**
 * Uploads one file (e.g. a receipt) as multipart form data with the session cookie and CSRF header.
 * The server checks size (≤ 10 MB) and real file type; errors come back as ApiError codes.
 */
export async function uploadFile(file: File): Promise<UploadedFile> {
  const body = new FormData();
  body.append("file", file, file.name);
  const headers = new Headers();
  if (csrfToken) headers.set("x-csrf-token", csrfToken);
  const res = await fetch(`${API_URL}/api/v1/files`, {
    method: "POST",
    body,
    headers,
    credentials: "include",
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, err.error ?? "error");
  }
  return (await res.json()) as UploadedFile;
}
