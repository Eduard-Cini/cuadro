import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Jugar } from "./componentes/Jugar";
import "./fuentes.css";
import "./estilos.css";

/*
 * Un enlace de partido a distancia (#jugar=…) abre solo el tablero de ese
 * partido, sin la aplicación completa: ni papeles, ni relevo, ni el torneo
 * guardado en este navegador.
 *
 * Si la dirección cambia sin recargar (se toca otro enlace con la página
 * abierta), se recarga para que entre lo que corresponde.
 */
const esPartidoADistancia = () => location.hash.startsWith("#jugar=");
const alArrancar = esPartidoADistancia();
window.addEventListener("hashchange", () => {
  if (alArrancar || esPartidoADistancia()) location.reload();
});

createRoot(document.getElementById("raiz")!).render(
  <StrictMode>{alArrancar ? <Jugar /> : <App />}</StrictMode>,
);
