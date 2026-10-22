import type { MetadataRoute } from "next";

/**
 * PWA manifest (M8). The mark WITHOUT the name is used for icons everywhere —
 * the with-name lockup is reserved for about/app-info/contact content.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cogitex Maintenance Planner",
    short_name: "Cogitex",
    description:
      "Factory maintenance planner — machines, plans, work orders, faults, parts, repair marketplace and agent, in one console.",
    id: "/",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0b0c10",
    theme_color: "#0b0c10",
    icons: [
      { src: "/img/logo-mark-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/img/logo-mark-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/img/logo-mark-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
