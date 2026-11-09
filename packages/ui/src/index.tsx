/**
 * ARCnordic Tid design-system primitives (M0 skeleton). Styling uses the Tailwind tokens defined in
 * apps/web/src/app/globals.css. Radix primitives are added as components need them (dialogs, menus, popovers).
 */
import {
  type ButtonHTMLAttributes,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  useId,
} from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost";
const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-ink-500",
  secondary: "bg-surface text-ink-900 border border-line hover:bg-surface-alt",
  ghost: "text-ink-700 hover:bg-surface-alt",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }
>(function Button({ variant = "primary", className, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
});

export const TextField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | undefined; hint?: string }
>(function TextField({ label, error, hint, className, id, ...props }, ref) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = [error ? `${inputId}-err` : null, hint ? `${inputId}-hint` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={inputId} className="text-sm font-semibold text-ink-900">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cx(
          "h-10 rounded-[var(--radius-control)] border bg-surface px-3 text-ink-900 placeholder:text-ink-500",
          error ? "border-danger" : "border-line",
        )}
        {...props}
      />
      {hint && (
        <p id={`${inputId}-hint`} className="text-xs text-ink-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${inputId}-err`} role="alert" className="flex items-center gap-1 text-sm text-danger">
          <span aria-hidden="true">⚠</span>
          {error}
        </p>
      )}
    </div>
  );
});

export function Card({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rounded-lg border border-line bg-surface p-5", className)}>
      {title && <h2 className="mb-3 text-base font-medium">{title}</h2>}
      {children}
    </section>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "brand" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-[var(--radius-pill)] px-2.5 py-0.5 text-xs font-semibold",
        tone === "brand" ? "bg-brand-50 text-brand-800" : "bg-surface-alt text-ink-700",
      )}
    >
      {children}
    </span>
  );
}

/** Product wordmark "ARCtime": "ARC" in brand red (as in the ARCnordic logo), "time" in ink. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="ARCtime"
      className={cx("font-[family-name:var(--font-display)] text-xl tracking-tight", className)}
    >
      <span aria-hidden="true" className="font-semibold text-brand-600">
        ARC
      </span>
      <span aria-hidden="true" className="font-light text-ink-900">
        time
      </span>
    </span>
  );
}
