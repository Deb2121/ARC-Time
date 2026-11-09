"use client";

/**
 * Last-resort error page when even the root layout fails (no providers or translations available, so the text is
 * Danish with an English line). Technical details only go to the browser console.
 */
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="da">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f3f3f3", color: "#1f1f1f" }}>
        <main style={{ maxWidth: 520, margin: "96px auto", padding: "0 24px" }}>
          <h1 style={{ fontWeight: 400 }}>Noget gik galt</h1>
          <p>Siden kunne ikke vises. Prøv igen om lidt. / Something went wrong – please try again.</p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: "#CA0538",
              color: "#fff",
              border: 0,
              borderRadius: 6,
              padding: "10px 16px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Prøv igen
          </button>
          {error.digest && <p style={{ fontSize: 12, color: "#666" }}>Reference: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
