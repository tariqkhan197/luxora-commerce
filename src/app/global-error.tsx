"use client";

/** Last-resort boundary for errors thrown in the root layout. Must render its own <html>. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 1.5rem", maxWidth: 560, margin: "0 auto" }}>
        <p style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.6 }}>Luxora</p>
        <h1 style={{ fontSize: 28, fontWeight: 400, marginTop: 16 }}>The application failed to load.</h1>
        <p style={{ marginTop: 12, lineHeight: 1.6, opacity: 0.75 }}>
          This is usually a configuration problem. {error.digest ? `Reference: ${error.digest}.` : ""}
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: 24,
            padding: "10px 18px",
            background: "#1c1a17",
            color: "#fff",
            border: 0,
            borderRadius: 6,
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
