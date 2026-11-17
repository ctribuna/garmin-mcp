import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Garmin MCP",
  description: "Personal MCP server for Garmin Connect",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          background: "#0b0f14",
          color: "#e6edf3",
          lineHeight: 1.6,
        }}
      >
        {children}
      </body>
    </html>
  );
}
