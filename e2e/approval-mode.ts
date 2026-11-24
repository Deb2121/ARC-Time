import type { PlaywrightWorkerArgs } from "@playwright/test";

/**
 * E2E helper: the demo approves weeks through Økonomi (D-040, mode "finance"); the core-loop specs walk the line
 * manager flow, which is still a valid mode. Admin (Karen) switches the mode through the API.
 */
const API = process.env.E2E_API_URL ?? "http://localhost:4000";

/** Sets the demo tenant's approval mode as Admin. */
export async function setApprovalMode(playwright: PlaywrightWorkerArgs["playwright"], mode: string) {
  const kh = await playwright.request.newContext();
  const res = await kh.post(`${API}/api/v1/auth/dev-login`, {
    data: { email: "kh@demo.arcnordic.test", password: "demo1234" },
  });
  const csrf = (await res.json()).csrfToken as string;
  await kh.patch(`${API}/api/v1/admin/approval-mode`, { headers: { "x-csrf-token": csrf }, data: { mode } });
  await kh.dispose();
}
