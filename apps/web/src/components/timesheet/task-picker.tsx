"use client";

/**
 * Accessible combobox for adding a task row (WAI-ARIA combobox pattern): type to search, ↑↓ to move,
 * Enter to add, Esc to close. Favourites are listed first and can be toggled with the star.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import type { TaskRef } from "./types";

/**
 * Accessible combobox for adding a task row (WAI-ARIA pattern): type to search, ↑↓ to move, Enter to add,
 * Esc to close. Favourites are listed first and can be toggled with the star.
 */
export function TaskPicker({ onPick, exclude }: { onPick: (t: TaskRef) => void; exclude: Set<string> }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const tasks = useQuery({ queryKey: ["ts-tasks"], queryFn: () => api<TaskRef[]>("/timesheet/tasks") });

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (tasks.data ?? []).filter((x) => !exclude.has(x.taskId));
    const hit = needle
      ? list.filter((x) =>
          `${x.projectNumber} ${x.projectName} ${x.taskName} ${x.customerName ?? ""}`
            .toLowerCase()
            .includes(needle),
        )
      : list;
    return [...hit].sort((a, b) => Number(b.favourite) - Number(a.favourite)).slice(0, 40);
  }, [q, tasks.data, exclude]);

  useEffect(() => setActive(0), []);

  function pick(x: TaskRef) {
    onPick(x);
    setQ("");
    setOpen(false);
    inputRef.current?.focus();
  }

  async function toggleFavourite(x: TaskRef) {
    if (x.favourite) await api(`/timesheet/favourites/${x.taskId}`, { method: "DELETE" });
    else await api("/timesheet/favourites", { method: "POST", body: JSON.stringify({ taskId: x.taskId }) });
    await qc.invalidateQueries({ queryKey: ["ts-tasks"] });
  }

  return (
    <div className="relative w-full max-w-md">
      <label htmlFor={`${listId}-input`} className="sr-only">
        {t("ts.addTask")}
      </label>
      <input
        ref={inputRef}
        id={`${listId}-input`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${listId}-${results[active].taskId}` : undefined}
        placeholder={`+ ${t("ts.addTaskPlaceholder")}`}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && results[active]) {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="h-10 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink-900 placeholder:text-ink-500"
      />
      {open && results.length > 0 && (
        <div
          id={listId}
          role="listbox"
          aria-label={t("ts.allTasks")}
          className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-[var(--radius-control)] border border-line bg-surface py-1 shadow-lg"
        >
          {results.map((x, i) => (
            // biome-ignore lint/a11y/useFocusableInteractive: combobox options are reached via aria-activedescendant, not focus
            <div
              key={x.taskId}
              id={`${listId}-${x.taskId}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(x);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${i === active ? "bg-brand-50" : ""}`}
            >
              <button
                type="button"
                tabIndex={-1}
                aria-label={t("ts.favourite")}
                aria-pressed={Boolean(x.favourite)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void toggleFavourite(x);
                }}
                className={x.favourite ? "text-brand-600" : "text-ink-500 hover:text-ink-900"}
              >
                {x.favourite ? "★" : "☆"}
              </button>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink-900">
                  {x.projectNumber} {x.projectName}
                </span>
                <span className="block truncate text-xs text-ink-500">
                  {x.wbs} {x.taskName}
                  {x.customerName ? ` · ${x.customerName}` : ""}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
