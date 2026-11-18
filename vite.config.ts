import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

import { readFileSync } from "node:fs";

const paquete = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig(({ mode }) => {
  // La ruta base cambia según dónde se publique. En GitHub Pages el sitio
  // cuelga de /ttorneo/; servido por el relevo del gimnasio, de la raíz.
  //
  // Va por modo y no por variable de entorno a propósito: en Windows, una
  // variable cuyo valor es «/» se convierte en una ruta del sistema antes
  // de llegar aquí, y el sitio se compila con enlaces rotos.
  const base = mode === "relevo" ? "/" : (process.env.BASE_PATH ?? "/ttorneo/");

  return {
  base,
  /*
   * La versión viaja dentro del compilado.
   *
   * Sin ella no hay forma de saber, mirando una tablet, si está corriendo
   * lo último o una copia que el navegador guardó hace tres semanas. Y esa
   * es justo la pregunta que aparece cuando algo «ya se había arreglado»
   * pero en la mesa sigue fallando.
   */
  define: {
    __VERSION__: JSON.stringify(paquete.version),
    __COMPILADO__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ")),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icono-192.png", "icono-512.png"],
      manifest: {
        name: "TTorneo — gestor de torneos de tenis de mesa",
        short_name: "TTorneo",
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
        // La versión nueva toma el control en cuanto está, sin esperar a
        // que se cierren todas las pestañas. En un torneo nadie va a
        // cerrar la aplicación de las seis tablets para que se actualicen.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Todo lo que la aplicación necesita está en el propio paquete: no
        // hay tipografías ni recursos que pedir a ningún servidor externo,
        // que es lo que permite instalarla en una tablet que nunca ha
        // tenido conexión.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
    }),
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  };
});
