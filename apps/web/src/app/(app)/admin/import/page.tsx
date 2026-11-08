"use client";

/**
 * Data import (D-024): customers, projects and employees from a CSV saved in Excel. Steps: download the template,
 * choose the file, check the dry run (create / update / errors per row), then import — all rows or none.
 * Files saved by Danish Excel as "CSV (semikolonsepareret)" are Windows-1252; that is detected and read correctly.
 */
import { hasRole, type ImportKind, importTemplate } from "@arc-tid/domain";
import { Badge, Button, Card } from "@arc-tid/ui";
import { useState } from "react";
import { useMe } from "@/components/session";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { ApiError, api } from "@/lib/api";

interface Preview {
  missingColumns: string[];
  unknownColumns: string[];
  rows: { line: number; action: "create" | "update"; label: string; errors: string[] }[];
  counts: { create: number; update: number; errors: number };
}

/** Reads a file as UTF-8, falling back to Windows-1252 when it is not valid UTF-8 (Danish Excel CSV). */
async function readText(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export default function ImportPage() {
  const { t } = useI18n();
  const me = useMe();
  const kinds: ImportKind[] = hasRole(me.roles, "admin")
    ? ["customers", "projects", "employees"]
    : ["customers", "projects"];
  const [kind, setKind] = useState<ImportKind>("customers");
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = (k: ImportKind) => {
    setKind(k);
    setCsv(null);
    setFileName("");
    setPreview(null);
    setResult(null);
    setError(null);
  };
  const fail = (e: unknown) =>
    setError(e instanceof ApiError ? t(`err.${e.code}` as MessageKey) : t("common.error"));

  async function choose(file: File | undefined) {
    if (!file) return;
    setResult(null);
    setError(null);
    const text = await readText(file);
    setCsv(text);
    setFileName(file.name);
    setBusy(true);
    try {
      setPreview(
        await api<Preview>(`/import/${kind}/preview`, {
          method: "POST",
          body: JSON.stringify({ csv: text }),
        }),
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!csv) return;
    setBusy(true);
    try {
      const r = await api<{ created: number; updated: number }>(`/import/${kind}/commit`, {
        method: "POST",
        body: JSON.stringify({ csv }),
      });
      setResult(t("imp.done", { created: r.created, updated: r.updated }));
      setPreview(null);
      setCsv(null);
      setFileName("");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([importTemplate(kind)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `skabelon_${t(`imp.kind.${kind}` as MessageKey).toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const canImport =
    preview && !preview.missingColumns.length && preview.counts.errors === 0 && preview.rows.length > 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-3xl font-normal">{t("imp.title")}</h1>
        <p className="mt-1 text-ink-700">{t("imp.intro")}</p>
      </header>
      <div role="tablist" aria-label={t("imp.title")} className="flex gap-1 border-b border-line">
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => reset(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${kind === k ? "border-brand-600 text-ink-900" : "border-transparent text-ink-500 hover:text-ink-900"}`}
          >
            {t(`imp.kind.${k}` as MessageKey)}
          </button>
        ))}
      </div>

      <Card>
        <ol className="flex flex-col gap-4 text-sm">
          <li className="flex flex-wrap items-center gap-3">
            <span className="w-6 font-semibold text-ink-500">1.</span>
            <span className="flex-1 text-ink-900">{t(`imp.step1.${kind}` as MessageKey)}</span>
            <Button variant="secondary" onClick={downloadTemplate}>
              ↓ {t("imp.template")}
            </Button>
          </li>
          <li className="flex flex-wrap items-center gap-3">
            <span className="w-6 font-semibold text-ink-500">2.</span>
            <label htmlFor="import-file" className="flex-1 text-ink-900">
              {t("imp.step2")}
            </label>
            <input
              id="import-file"
              type="file"
              accept=".csv,.txt,text/csv"
              className="text-sm"
              onChange={(e) => {
                void choose(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </li>
        </ol>
        {fileName && <p className="mt-3 text-xs text-ink-500">{fileName}</p>}
      </Card>

      {error && (
        <p role="alert" className="text-sm text-danger">
          ⚠ {error}
        </p>
      )}
      {result && (
        <p
          role="status"
          className="rounded-lg border border-line bg-surface p-4 text-sm font-semibold text-ink-900"
        >
          ✓ {result}
        </p>
      )}

      {preview && (
        <Card title={t("imp.preview")}>
          {preview.missingColumns.length > 0 && (
            <p className="mb-3 text-sm text-danger">
              ⚠ {t("imp.missingColumns", { columns: preview.missingColumns.join(", ") })}
            </p>
          )}
          {preview.unknownColumns.length > 0 && (
            <p className="mb-3 text-sm text-ink-500">
              {t("imp.unknownColumns", { columns: preview.unknownColumns.join(", ") })}
            </p>
          )}
          <p className="mb-3 text-sm text-ink-700">
            {t("imp.counts", {
              create: preview.counts.create,
              update: preview.counts.update,
              errors: preview.counts.errors,
            })}
          </p>
          <div className="-mx-5 max-h-[28rem] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-y border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th scope="col" className="px-5 py-2 text-left font-semibold">
                    {t("imp.line")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    {t("imp.action")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    {t("imp.name")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    {t("imp.problems")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr
                    key={r.line}
                    className={`border-b border-line last:border-0 ${r.errors.length ? "bg-surface-alt" : ""}`}
                  >
                    <td className="px-5 py-2 tabular-nums text-ink-500">{r.line}</td>
                    <td className="px-3 py-2">
                      <Badge tone={r.action === "create" ? "brand" : "neutral"}>
                        {t(`imp.action.${r.action}` as MessageKey)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-ink-900">{r.label}</td>
                    <td className="px-3 py-2 text-danger">
                      {r.errors.map((e) => t(`imp.err.${e}` as MessageKey)).join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-end gap-3">
            {!canImport && <span className="text-sm text-ink-500">{t("imp.fixFirst")}</span>}
            <Button disabled={!canImport || busy} onClick={() => void commit()}>
              {t("imp.import", { count: preview.rows.length })}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
