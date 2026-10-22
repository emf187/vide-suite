import type { Metadata, Viewport } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import "@/styles/globals.css";
import { RegisterSw } from "@/components/pwa/register-sw";

/**
 * Type system: DM Sans for all UI text (client-selected — sleeker, warmer than
 * Inter); JetBrains Mono is reserved for tags, ids and numerals (see the
 * .mono/.tag + .tnum utilities). Self-hosted at build via next/font so there is
 * no runtime font dependency (Vercel-friendly).
 */
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "COGITEX Maintenance Planner",
    template: "%s · COGITEX Planner",
  },
  description:
    "Documentation, planning and inventory for factory maintenance teams — everything about a machine, its repairs, parts and next job in one place.",
  icons: {
    icon: [{ url: "/img/brand-mark.png", type: "image/png" }],
    apple: [{ url: "/img/brand-mark.png", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#faf9f7",
};

/**
 * Pre-hydration theme boot + toggle delegation. Both run as plain browser JS,
 * BEFORE and independent of React hydration — so dark/light always works even
 * if hydration is delayed or blocked. The topbar button carries
 * data-action="theme-toggle"; this listener handles clicks globally, writes
 * localStorage and syncs the moon/sun icon.
 */
const THEME_BOOT_SCRIPT = `(
  function(){
    try{
      var t=localStorage.getItem('cogitex_theme');
      document.documentElement.dataset.theme=(t==='dark')?'dark':'light';
    }catch(e){document.documentElement.dataset.theme='light';}
    var sync=function(){
      var b=document.getElementById('theme-btn');
      if(!b)return;
      var dark=document.documentElement.dataset.theme==='dark';
      b.textContent=dark?'\\u25D1':'\\u25D0';
      b.title=dark?'Switch to light mode':'Switch to dark mode';
    };
    window.__cogitexToggleTheme=function(){
      var root=document.documentElement;
      var next=root.dataset.theme==='dark'?'light':'dark';
      root.dataset.theme=next;
      try{localStorage.setItem('cogitex_theme',next);}catch(e){}
      sync();
    };
    document.addEventListener('click',function(e){
      var t=e.target&&e.target.closest?e.target.closest('[data-action="theme-toggle"]'):null;
      if(t){e.preventDefault();window.__cogitexToggleTheme();}
    });
    if(document.readyState!=='loading')sync();
    else document.addEventListener('DOMContentLoaded',sync);
  }
)();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning
      className={`${dmSans.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        {children}
        <RegisterSw />
      </body>
    </html>
  );
}
