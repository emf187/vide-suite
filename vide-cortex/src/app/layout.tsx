import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { DM_Sans } from "next/font/google";
import "./globals.css";

/**
 * DM Sans — the suite UI typeface (client-selected). Self-hosted at build via
 * next/font (no runtime font fetch — deploy-friendly). JetBrains Mono stays
 * reserved for tags/ids/numerals via the .tnum utility and font-mono classes.
 */
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "COGITEX VIDE CORTEX", template: "COGITEX VIDE CORTEX — %s" },
  description: "Industrial fault detection and predictive maintenance control room.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * Applies the saved theme before first paint so there is no flash of the wrong theme.
 * Light paper is the suite default; the dark variant remains a stored choice.
 * Must stay tiny and dependency-free; key name matches STORAGE_KEYS.theme.
 */
const THEME_SCRIPT = `try{document.documentElement.dataset.theme=localStorage.getItem("vide_theme")==="dark"?"dark":"light"}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning className={dmSans.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
