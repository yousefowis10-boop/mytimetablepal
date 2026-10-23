import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      injectRegister: false,
      manifest: {
        name: "MyTimetablePal",
        short_name: "TimetablePal",
        description: "School timetables, attendance, fees, buses and parents",
        lang: "ar",
        dir: "auto",
        start_url: "/",
        display: "standalone",
        background_color: "#f8fafc",
        theme_color: "#2563eb",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      injectManifest: { globPatterns: ["**/*.{js,css,html,svg,png,woff2}"], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
    }),
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: { outDir: "dist", chunkSizeWarningLimit: 2000 },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.js"],
    css: false,
  },
});
