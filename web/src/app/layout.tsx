import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "MailHost", description: "Self-hosted multi-domain mail platform" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
