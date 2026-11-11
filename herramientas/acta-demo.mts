/*
 * Escribe el acta de un torneo como HTML suelto, para poder imprimirla
 * fuera del navegador de la aplicación y revisar cómo sale en papel.
 *
 *   npx vite-node herramientas/acta-demo.mts jornada.json acta.html
 */
import { readFileSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Informe } from "../src/componentes/Informe";
import type { Torneo } from "../src/nucleo";

const [entrada = "public/_demo.json", salida = "acta.html"] = process.argv.slice(2);

(globalThis as unknown as { __VERSION__: string }).__VERSION__ = JSON.parse(
  readFileSync("package.json", "utf8"),
).version;

const t = JSON.parse(readFileSync(entrada, "utf8")) as Torneo;
const cuerpo = renderToStaticMarkup(createElement(Informe, { t, alSalir: () => {} }));
const css = ["src/fuentes.css", "src/estilos.css"].map((f) => readFileSync(f, "utf8")).join("\n");

writeFileSync(
  salida,
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Acta</title>` +
    `<style>${css}</style></head><body>${cuerpo}</body></html>`,
  "utf8",
);
process.stderr.write(`escrito ${salida}\n`);
