"use client";

import { Button, TextField, Wordmark } from "@arc-tid/ui";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { LanguageSwitch } from "@/components/language-switch";
import { useI18n } from "@/i18n";
import { API_URL, ApiError, api, setCsrfToken } from "@/lib/api";

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const providers = useQuery({
    queryKey: ["auth-providers"],
    queryFn: () => api<{ devLogin: boolean; entra: boolean }>("/auth/providers"),
  });
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      const res = await api<{ csrfToken: string }>("/auth/dev-login", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      setCsrfToken(res.csrfToken);
      router.replace("/");
    } catch (err) {
      setError(t(err instanceof ApiError && err.status === 429 ? "auth.tooMany" : "auth.invalid"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_minmax(0,560px)]">
      <aside className="relative hidden overflow-hidden bg-ink-900 lg:block" aria-hidden="true">
        {/* Abstract architectural grid: a nod to drawings and plans, not an image of a real product. */}
        <svg
          aria-hidden="true"
          className="absolute inset-0 h-full w-full opacity-[0.14]"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M48 0H0V48" fill="none" stroke="white" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
        <div className="absolute bottom-0 left-0 h-2 w-1/3 bg-brand-600" />
        <div className="relative flex h-full flex-col justify-end p-14">
          <p className="max-w-md font-[family-name:var(--font-display)] text-4xl font-light leading-tight text-white">
            {t("auth.subtitle")}
          </p>
        </div>
      </aside>

      <main className="flex flex-col bg-surface px-6 py-8 sm:px-14">
        <div className="flex items-center justify-between">
          <Wordmark />
          <LanguageSwitch />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 py-12">
          <h1 className="text-3xl font-normal">{t("auth.title")}</h1>

          {providers.data?.entra && (
            <a
              href={`${API_URL}/api/v1/auth/entra/login`}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-semibold text-ink-900 hover:bg-surface-alt"
            >
              <MicrosoftMark /> {t("auth.entra")}
            </a>
          )}

          {providers.data?.entra && providers.data.devLogin && (
            <div className="flex items-center gap-3 text-xs text-ink-500">
              <span className="h-px flex-1 bg-line" /> {t("auth.or")} <span className="h-px flex-1 bg-line" />
            </div>
          )}

          {providers.data?.devLogin && (
            <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
              <TextField label={t("auth.email")} name="email" type="email" autoComplete="username" required />
              <TextField
                label={t("auth.password")}
                name="password"
                type="password"
                autoComplete="current-password"
                required
                error={error}
              />
              <Button type="submit" disabled={busy}>
                {t("auth.submit")}
              </Button>
              <p className="rounded-[var(--radius-control)] bg-surface-alt p-3 text-xs text-ink-500">
                {t("auth.devNotice")}
              </p>
            </form>
          )}

          {providers.isError && (
            <p role="alert" className="text-sm text-danger">
              {t("common.error")}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

function MicrosoftMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect width="7.5" height="7.5" fill="#f25022" />
      <rect x="8.5" width="7.5" height="7.5" fill="#7fba00" />
      <rect y="8.5" width="7.5" height="7.5" fill="#00a4ef" />
      <rect x="8.5" y="8.5" width="7.5" height="7.5" fill="#ffb900" />
    </svg>
  );
}
