import type { Torneo } from "./nucleo";

export const LLAVE = "cuadro.v03";
export const LLAVE_ROL = "cuadro.rol";
export const LLAVE_MESA = "cuadro.mesa";

export const nuevoId = (): string => Math.random().toString(36).slice(2, 9);

export const torneoVacio = (): Torneo => ({
  nombre: "",
  mesas: 4,
  formatoGrupos: 2,
  formatoFinales: 3,
  nGrupos: 2,
  clasifican: 2,
  jugadores: [],
  arbitros: [],
  grupos: [],
  partidos: [],
  relajaciones: [],
});

/** El almacenamiento puede estar bloqueado; la app sigue en memoria. */
export function guardar(t: Torneo): void {
  try {
    localStorage.setItem(LLAVE, JSON.stringify(t));
  } catch {
    /* sin persistencia: el torneo vive mientras la pestaña esté abierta */
  }
}

export function cargar(): Torneo | null {
  try {
    const crudo = localStorage.getItem(LLAVE);
    if (!crudo) return null;
    return { ...torneoVacio(), ...(JSON.parse(crudo) as Torneo) };
  } catch {
    return null;
  }
}

export function leer(llave: string): string | null {
  try {
    return localStorage.getItem(llave);
  } catch {
    return null;
  }
}

export function escribir(llave: string, valor: string): void {
  try {
    localStorage.setItem(llave, valor);
  } catch {
    /* ignorado a propósito */
  }
}

/**
 * Convierte texto pegado o un CSV en jugadores.
 * Acepta coma, punto y coma o tabulador, y se salta el encabezado.
 */
export function leerJugadores(texto: string): Array<{ nombre: string; club: string; rank: number }> {
  const filas = texto.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const out: Array<{ nombre: string; club: string; rank: number }> = [];

  filas.forEach((f, i) => {
    const c = f.split(/[,;\t]/).map((s) => s.trim().replace(/^"|"$/g, ""));
    const esEncabezado = i === 0 && /^(nombre|name|jugador|player)$/i.test(c[0] ?? "");
    if (esEncabezado) return;
    const nombre = c[0] ?? "";
    if (!nombre) return;
    out.push({ nombre, club: c[1] ?? "", rank: Number(c[2]) || 0 });
  });
  return out;
}
