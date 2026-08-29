import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// La ruta base cambia según dónde se publique. En GitHub Pages el sitio
// cuelga de /cuadro/; en local, de la raíz.
const base = process.env.BASE_PATH ?? "/cuadro/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icono-192.png", "icono-512.png"],
      manifest: {
        name: "Cuadro — gestor de torneos",
        short_name: "Cuadro",
        description:
          "Gestor de torneos de tenis de mesa que funciona sin conexión. Mesa de control y tablero de árbitro.",
        lang: "es",
        start_url: base,
        scope: base,
        display: "fullscreen",
        orientation: "any",
        background_color: "#EFE6D2",
        theme_color: "#17110E",
        icons: [
          { src: "icono-192.png", sizes: "192x192", type: "image/png" },
          { src: "icono-512.png", sizes: "512x512", type: "image/png" },
          { src: "icono-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Las tipografías vienen de Google Fonts: se guardan en caché la
        // primera vez para que el gimnasio sin señal no rompa el diseño.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-css" },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-woff",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
