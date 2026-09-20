import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon-32.png", "apple-touch-icon.png", "icon.svg"],
      manifest: {
        name: "Compra en Familia",
        short_name: "Compra",
        description: "La lista de la compra de casa, siempre al día.",
        lang: "es",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#FBF6EE",
        theme_color: "#FBF6EE",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // La app abre sin red: se precachea el "cascarón" (HTML, JS, CSS, fuentes latinas e iconos).
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}", "**/*-latin-*.woff2", "**/*-latin-ext-*.woff2"],
        navigateFallback: "/index.html",
        // Lo que no es la app (API, tiempo real, salud y el APK) nunca se sirve desde el service worker.
        navigateFallbackDenylist: [/^\/api\//, /^\/ws/, /^\/health/, /\.apk$/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  server: {
    proxy: {
      "/health": "http://localhost:3000",
      "/api": "http://localhost:3000",
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
});
