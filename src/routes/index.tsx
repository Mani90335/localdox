import { createFileRoute } from "@tanstack/react-router";
import { DocsApp } from "@/components/docs/DocsApp";
import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from "@/lib/theme-color";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Localdox - AI Docs reader" },
      {
        name: "description",
        content:
          "Drop files to instantly view and edit a beautifully navigable workspace with support for Markdown, PDFs, Spreadsheets, Presentations, and more.",
      },
      { property: "og:title", content: "Localdox" },
      {
        property: "og:description",
        content: "Turn your files into a polished viewing experience.",
      },
      { name: "theme-color", content: THEME_COLOR_LIGHT, media: "(prefers-color-scheme: light)" },
      { name: "theme-color", content: THEME_COLOR_DARK, media: "(prefers-color-scheme: dark)" },
      { property: "og:image", content: "https://localdox.web.app/og-image.jpg" },
      { name: "twitter:image", content: "https://localdox.web.app/og-image.jpg" },
    ],
  }),
  component: DocsApp,
});
