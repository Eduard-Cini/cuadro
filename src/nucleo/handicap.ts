import { PUNTOS_SET } from "./reglas";
import type { Jugador, Lado, Torneo } from "./tipos";

/** Lo que fija el reglamento de la ITTF y un torneo formal no deja tocar. */
export const FORMAL = { puntosSet: PUNTOS_SET, descansoSet: 1, duracionTiempo: 60 } as const;

/** A cuántos puntos se juega cada set en este torneo. */
export const puntosDe = (t: Pick<Torneo, "puntosSet" | "reglamento">): number =>
  t.reglamento === "formal" ? PUNTOS_SET : Math.max(5, Math.min(99, Math.floor(Number(t.puntosSet) || PUNTOS_SET)));

/**
 * La lista en el orden de la siembra: el primero es el mejor.
 *
 * Es el orden que se ve en la pestaña de jugadores: el que fijó el juez
 * con las flechas, o por ranking si no lo ha tocado. Sin ranking y sin
 * tocar, queda el orden en que se cargaron.
 */
export const enOrdenDeSiembra = (t: Pick<Torneo, "jugadores" | "siembraManual">): Jugador[] =>
  t.siembraManual ? t.jugadores : [...t.jugadores].sort((a, b) => b.rank - a.rank);

/**
 * Ventaja de hándicap entre dos inscripciones.
 *
 * El de menor nivel empieza cada set con puntos de ventaja, sin pasar del
 * tope. El tope nunca deja que un set se gane sin jugarlo: con sets a 11,
 * como mucho se empieza 9–0.
 *
 * La diferencia sale de una de dos partes. Por ranking: un punto por cada
 * `escalon` puntos de diferencia; a quien no tiene ranking no se le da
 * ventaja, que es preferible a inventarla. Por lugar: `porLugar` puntos
 * por cada lugar que los separa en la lista, del 1 al n; no hace falta
 * ranking, solo que el juez haya ordenado la lista.
 */
export function ventajaEntre(
  t: Pick<Torneo, "handicap" | "jugadores" | "siembraManual" | "puntosSet" | "reglamento">,
  aId: string | null,
  bId: string | null,
): { lado: Lado; puntos: number } | undefined {
  const h = t.handicap;
  if (!h?.activo || t.reglamento === "formal" || !aId || !bId) return undefined;
  const tope = Math.max(0, Math.min(puntosDe(t) - 2, Number(h.tope) || 0));

  if (h.base === "bloque") {
    const a = t.jugadores.find((j) => j.id === aId)?.bloque;
    const b = t.jugadores.find((j) => j.id === bId)?.bloque;
    // Sin bloque no se calcula, y entre los del mismo bloque no hay ventaja
    if (!a || !b || a === b) return undefined;
    const puntos = Math.min(tope, ventajaEntreBloques(h.tablaBloques, Math.min(a, b), Math.max(a, b), puntosDe(t)));
    if (puntos <= 0) return undefined;
    // El del bloque de abajo (número mayor) es quien recibe la ventaja
    return { lado: a > b ? "a" : "b", puntos };
  }

  if (h.base === "lugar") {
    const orden = enOrdenDeSiembra(t);
    const ia = orden.findIndex((j) => j.id === aId);
    const ib = orden.findIndex((j) => j.id === bId);
    if (ia < 0 || ib < 0) return undefined;
    const porLugar = Math.max(0, Number(h.porLugar) || 1);
    const puntos = Math.min(tope, Math.floor(Math.abs(ia - ib) * porLugar));
    if (puntos <= 0) return undefined;
    // El que está más abajo en la lista es quien recibe la ventaja.
    return { lado: ia > ib ? "a" : "b", puntos };
  }

  const a = t.jugadores.find((j) => j.id === aId);
  const b = t.jugadores.find((j) => j.id === bId);
  if (!a?.rank || !b?.rank) return undefined;
  const escalon = Math.max(1, Number(h.escalon) || 1);
  const puntos = Math.min(tope, Math.floor(Math.abs(a.rank - b.rank) / escalon));
  if (puntos <= 0) return undefined;
  return { lado: a.rank < b.rank ? "a" : "b", puntos };
}

/**
 * Ventaja que se propone entre dos bloques separados por `d` (1 si son
 * vecinos), con sets a `meta` puntos.
 *
 * Con sets a 11 se propone 2, 4, 5, 6, 7… La razón, con un modelo simple:
 * si el mejor gana cada punto con probabilidad p, sin ventaja necesita 11
 * de los primeros 21 puntos; con h de ventaja para el otro, 11 de los
 * primeros 21 − h. El set queda parejo cuando lo que espera ganar en esos
 * puntos es 10.5, o sea con h ≈ 21 − 10.5 / p. Eso da h ≈ 2 para p = 0.55,
 * 3.5 para 0.60, 5 para 0.65, 6 para 0.70 y 7 para 0.75: cada punto de
 * diferencia en el nivel pide menos ventaja que el anterior, y por eso la
 * escala crece cada vez más despacio en lugar de ir de dos en dos. Se
 * empieza bajo a propósito: la votación es una primera estimación, y una
 * ventaja de más hace que el mejor pierda sin haber jugado mal, que es
 * peor experiencia que un partido algo cargado. Con sets a otra cantidad
 * se escala en proporción.
 */
export function ventajaSugerida(d: number, meta: number = PUNTOS_SET): number {
  if (d <= 0) return 0;
  const base = d === 1 ? 2 : d === 2 ? 4 : 2 + d;
  return Math.round((base * meta) / PUNTOS_SET);
}

/** La tabla sugerida para k bloques: `tabla[i][j]` con i < j, cero en lo demás. */
export function tablaSugerida(k: number, meta: number = PUNTOS_SET): number[][] {
  return Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => (j > i ? ventajaSugerida(j - i, meta) : 0)),
  );
}

/**
 * Los puntos que da el bloque `alto` al bloque `bajo` (alto < bajo,
 * contando desde 1): lo que diga la tabla del juez, o lo sugerido si esa
 * casilla no está.
 */
export function ventajaEntreBloques(
  tabla: number[][] | undefined,
  alto: number,
  bajo: number,
  meta: number = PUNTOS_SET,
): number {
  const v = tabla?.[alto - 1]?.[bajo - 1];
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : ventajaSugerida(bajo - alto, meta);
}

/**
 * Pone la ventaja a cada partido que todavía no empieza.
 *
 * Un partido con algo anotado ya no se toca: si el juez cambia un ranking
 * a media jornada, el marcador de un partido en juego no puede saltar.
 * Los que aún no empiezan sí se recalculan, y así un cruce de la
 * eliminatoria recibe su ventaja en cuanto se sabe quién lo juega.
 */
export function aplicarHandicap(t: Torneo): void {
  for (const p of t.partidos) {
    if (p.eventos.length) continue;
    const v = ventajaEntre(t, p.aId, p.bId);
    if (v) p.ventaja = v;
    else delete p.ventaja;
  }
}

/**
 * Deja el torneo coherente con sus reglas.
 *
 * En un torneo formal, lo que fija el reglamento se impone aquí y no en la
 * pantalla: así no depende de que un formulario esconda bien un campo, y
 * un archivo cargado de otro aparato tampoco puede traer un «formal» con
 * sets a 21. Después se escribe en cada partido sin empezar a cuántos
 * puntos se juega y con qué ventaja.
 *
 * Se llama en cada cambio de estructura que hace el juez.
 */
export function aplicarReglas(t: Torneo): void {
  if (t.reglamento === "formal") {
    t.puntosSet = FORMAL.puntosSet;
    t.descansoSet = FORMAL.descansoSet;
    t.duracionTiempo = FORMAL.duracionTiempo;
    t.validacionObligatoria = true;
    if (t.handicap?.activo) t.handicap = { ...t.handicap, activo: false };
  }
  const meta = puntosDe(t);
  for (const p of t.partidos) {
    if (p.eventos.length) continue;
    if (meta !== PUNTOS_SET) p.meta = meta;
    else delete p.meta;
  }
  aplicarHandicap(t);
}
