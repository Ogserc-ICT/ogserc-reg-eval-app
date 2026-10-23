import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The default bottom-left position covers the sidebar's Sign out button.
  devIndicators: { position: "bottom-right" },
  // A separate build folder lets a production build run beside the dev server (perf checks).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // A self-contained server (server.js + only the node_modules it needs) for the Docker image.
  // Vercel builds its own functions, so not there.
  output: process.env.VERCEL ? undefined : "standalone",
  // PDFs read fonts and images from assets/ at run time; include them in every server function.
  outputFileTracingIncludes: { "/**": ["./assets/fonts/*.ttf", "./assets/*.png"] },
  // Native argon2 binding must not be bundled.
  serverExternalPackages: ["@node-rs/argon2"],
  // The workbook import uploads the .xlsm (about 3 MB) through a server action (default limit 1 MB).
  // On Vercel, requests are capped at 4.5 MB whatever this says.
  experimental: { serverActions: { bodySizeLimit: "26mb" } },
};

export default nextConfig;
