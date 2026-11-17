import { getRedisConfig, isAuthConfigured, isWriteEnabled } from "@/lib/config";

export const dynamic = "force-dynamic";

const code = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 6,
  padding: "2px 6px",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "0.9em",
} as const;

function Row({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <li style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: "1px solid #21262d" }}>
      <span aria-hidden style={{ color: ok ? "#3fb950" : "#d29922" }}>{ok ? "●" : "○"}</span>
      <span>
        <strong>{label}</strong>
        <br />
        <span style={{ color: "#8b949e" }}>{detail}</span>
      </span>
    </li>
  );
}

export default function Home() {
  const auth = isAuthConfigured();
  const redis = Boolean(getRedisConfig());
  const write = isWriteEnabled();

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "64px 16px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Garmin MCP</h1>
      <p style={{ color: "#8b949e", marginTop: 0 }}>
        A personal Model Context Protocol server for Garmin Connect.
      </p>

      <h2 style={{ fontSize: 18, marginTop: 40 }}>Server configuration</h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        <Row
          label="Access secret"
          ok={auth}
          detail={auth ? "MCP_AUTH_TOKEN is set." : "Set MCP_AUTH_TOKEN (at least 24 characters) in the Vercel project."}
        />
        <Row
          label="Token storage"
          ok={redis}
          detail={
            redis
              ? "Upstash Redis is connected; Garmin tokens are stored encrypted."
              : "No Redis connected. Add Upstash for Redis from the Vercel Storage tab so refreshed tokens persist."
          }
        />
        <Row
          label="Write tools"
          ok={write}
          detail={write ? "Workout creation and scheduling are enabled." : "Read-only. Set GARMIN_ENABLE_WRITE=true to allow creating workouts."}
        />
      </ul>

      <h2 style={{ fontSize: 18, marginTop: 40 }}>Connect an AI client</h2>
      <p>
        Add a custom connector with the URL <span style={code}>{"https://<this-host>/api/mcp/<MCP_AUTH_TOKEN>"}</span>, or use{" "}
        <span style={code}>/api/mcp</span> with an <span style={code}>Authorization: Bearer</span> header.
      </p>
      <p style={{ color: "#8b949e" }}>
        Garmin account status is not shown here because this page is public. Ask your AI client to run the{" "}
        <span style={code}>garmin_status</span> tool.
      </p>
    </main>
  );
}
