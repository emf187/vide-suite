import type { Metadata, Viewport } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import "@/styles/globals.css";

/** Same type system as the Planner: DM Sans for prose; JetBrains Mono reserved for tags, ids and numerals. */
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "CUSTOS Task Guardian",
    template: "%s · CUSTOS",
  },
  description:
    "Custos — the WhatsApp task guardian of the Cogitex suite: tasks to staff in ordinary WhatsApp, proof back to the dashboard, silence escalating until it is done.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#faf9f7",
};

/**
 * Pre-hydration theme boot + toggle delegation — ported from the Planner.
 * Plain browser JS that runs BEFORE and independent of React hydration, so
 * dark/light always works. The topbar button carries data-action=
 * "theme-toggle"; this global listener toggles, persists (custos_theme) and
 * syncs the moon/sun glyph.
 */
const THEME_BOOT_SCRIPT = `(
  function(){
    try{
      var t=localStorage.getItem('custos_theme');
      document.documentElement.dataset.theme=(t==='dark')?'dark':'light';
    }catch(e){document.documentElement.dataset.theme='light';}
    var sync=function(){
      var b=document.getElementById('theme-btn');
      if(!b)return;
      var dark=document.documentElement.dataset.theme==='dark';
      b.textContent=dark?'\\u25D1':'\\u25D0';
      b.title=dark?'Switch to light mode':'Switch to dark mode';
    };
    window.__custosToggleTheme=function(){
      var root=document.documentElement;
      var next=root.dataset.theme==='dark'?'light':'dark';
      root.dataset.theme=next;
      try{localStorage.setItem('custos_theme',next);}catch(e){}
      sync();
    };
    document.addEventListener('click',function(e){
      var t=e.target&&e.target.closest?e.target.closest('[data-action="theme-toggle"]'):null;
      if(t){e.preventDefault();window.__custosToggleTheme();}
    });
    if(document.readyState!=='loading')sync();
    else document.addEventListener('DOMContentLoaded',sync);
  }
)();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning className={`${dmSans.variable} ${jetbrainsMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
