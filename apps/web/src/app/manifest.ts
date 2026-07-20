import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "A11y Check — 웹 접근성 점검",
    short_name: "A11y Check",
    description: "WCAG 2.2 + KWCAG 2.2 기준 웹 접근성 자동 점검 보고서",
    start_url: "/",
    display: "standalone",
    background_color: "#faf8f3",
    theme_color: "#0b5d54",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
