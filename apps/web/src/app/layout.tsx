import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { LOCALE_COOKIE, type Locale } from "@/i18n";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = { title: "ARCtime" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale: Locale = stored === "en" ? "en" : "da";
  return (
    <html lang={locale}>
      <body className="min-h-screen antialiased">
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
