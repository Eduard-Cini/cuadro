import type { EstadoPartido, Lado, Partido } from "./tipos";

/** Todos los sets se juegan a 11 con dos de diferencia. */
export const PUNTOS_SET = 11;

/**
 * Recorre los eventos del partido y devuelve el estado.
 *
 * Es una función pura: mismos eventos, mismo resultado. Por eso deshacer
 * un punto es simplemente quitar el último evento y volver a llamar, y por
 * eso el estado se puede reconstruir en cualquier dispositivo a partir de
 * la lista de eventos.
 *
 * Reglas implementadas, pendientes de confirmación del árbitro (A2, A6):
 *  - El set se gana con 11 puntos y dos de ventaja.
 *  - El saque cambia cada dos puntos; desde 10-10, cada punto.
 *  - En cada juego posterior saca primero quien recibió en el anterior.
 *
 * Quién abre el primer juego lo decide el sorteo del árbitro antes de
 * empezar, y viaja en el propio partido.
 */
export function reducir(p: Partido, setsPara: number, meta = PUNTOS_SET): EstadoPartido {
  const sets = { a: 0, b: 0 };
  let pa = 0;
  let pb = 0;
  let juego = 1;
  let primero: Lado = p.primeroSaque ?? "a";
  const historial: Array<{ a: number; b: number }> = [];
  let finDeSet = false;

  const gana = (x: number, y: number) => x >= meta && x - y >= 2;

  for (const ev of p.eventos) {
    if (ev.t !== "punto") continue;
    if (ev.j === "a") pa++;
    else pb++;

    if (gana(pa, pb) || gana(pb, pa)) {
      sets[pa > pb ? "a" : "b"]++;
      historial.push({ a: pa, b: pb });
      pa = 0;
      pb = 0;
      juego++;
      primero = primero === "a" ? "b" : "a";
      finDeSet = true;
    }
  }

  const terminado = sets.a >= setsPara || sets.b >= setsPara;
  const ganador: Lado | null = sets.a >= setsPara ? "a" : sets.b >= setsPara ? "b" : null;

  const total = pa + pb;
  const deuce = pa >= meta - 1 && pb >= meta - 1;
  const base = (meta - 1) * 2;
  const turnos = deuce ? base / 2 + (total - base) : Math.floor(total / 2);
  const saca: Lado = turnos % 2 === 0 ? primero : primero === "a" ? "b" : "a";

  return { sets, pa, pb, juego, saca, historial, terminado, ganador, finDeSet, deuce };
}

export const partidoListo = (p: Partido, setsPara: number): boolean =>
  !!(p.aId && p.bId) && reducir(p, setsPara).terminado;

export function ganadorDe(p: Partido, setsPara: number): string | null {
  const st = reducir(p, setsPara);
  if (!st.terminado) return null;
  return st.ganador === "a" ? p.aId : p.bId;
}
