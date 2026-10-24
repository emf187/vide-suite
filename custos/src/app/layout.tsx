import type { Metadata, Viewport } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import "@/styles/globals.css";

/** Same type system as the Planner: DM Sans for prose, JetBrains Mono for tags/nums. */
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "CUSTOS Task Guardian", template: "%s · CUSTOS" },
  description:
    "Custos — the WhatsApp task guardian for the Cogitex suite: tasks to staff on WhatsApp, proof back to the dashboard, escalations until it's done.",
  icons: { icon: "/favicon.ico" },
};

export const viewport: Viewport = themeColor();

function themeColor() {
  return { themeColor: "#0c0c11" };
}

/** Theme boot script — same mechanism as the Planner, its own localStorage key. */
const BOOT = `try{
var t=localStorage.getItem('custos_theme');
if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.dataset.theme='dark';}
window.addEventListener('error',function(){},true);
}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      <body className={`${dmSans.variable} ${jetbrainsMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
