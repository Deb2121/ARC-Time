import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { NextConfig } from "next";

// The pnpm virtual store may live outside the repo (local .npmrc keeps it out of OneDrive, decision D-001).
// Turbopack only compiles files under its root, so use the common ancestor of the repo and the real `next` location.
const repoRoot = path.resolve(import.meta.dirname, "../..");
const nextDir = realpathSync(path.dirname(createRequire(import.meta.url).resolve("next/package.json")));
function commonAncestor(a: string, b: string): string {
  const pa = a.split(path.sep);
  const pb = b.split(path.sep);
  let i = 0;
  while (i < pa.length && i < pb.length && pa[i]?.toLowerCase() === pb[i]?.toLowerCase()) i++;
  const common = pa.slice(0, i).join(path.sep);
  // "C:" alone means "current directory on drive C"; the drive root needs a trailing separator.
  return common === "" || common.endsWith(":") ? common + path.sep : common;
}
const buildRoot = commonAncestor(repoRoot, nextDir);

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `connect-src 'self' ${api}`,
      "img-src 'self' data:",
      "font-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      // Next.js dev needs eval for fast refresh; production does not.
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const config: NextConfig = {
  turbopack: { root: buildRoot },
  outputFileTracingRoot: buildRoot,
  transpilePackages: ["@arc-tid/domain", "@arc-tid/ui"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
