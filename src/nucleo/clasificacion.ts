import { partidoListo, reducir } from "./reglas";
import type { Fila, Partido } from "./tipos";

/** Tabla del grupo a partir de los partidos ya terminados. */
export function estadisticas(ids: string[], partidos: Partido[], setsPara: number): Record<string, Fila> {
  const m: Record<string, Fila> = {};
  for (const id of ids) m[id] = { id, pj: 0, pg: 0, pp: 0, pts: 0, sg: 0, sp: 0, tg: 0, tp: 0 };

  for (const p of partidos) {
    if (!p.aId || !p.bId) continue;
    if (!m[p.aId] || !m[p.bId]) continue;
    if (!partidoListo(p, setsPara)) continue;

    const st = reducir(p, setsPara);
    const A = m[p.aId];
    const B = m[p.bId];
    A.pj++;
    B.pj++;
    A.pts += st.ganador === "a" ? 2 : 1;
    B.pts += st.ganador === "b" ? 2 : 1;
    if (st.ganador === "a") {
      A.pg++;
      B.pp++;
    } else {
      B.pg++;
      A.pp++;
    }
    A.sg += st.sets.a;
    A.sp += st.sets.b;
    B.sg += st.sets.b;
    B.sp += st.sets.a;
    for (const s of st.historial) {
      A.tg += s.a;
      A.tp += s.b;
      B.tg += s.b;
      B.tp += s.a;
    }
  }
  return m;
}

const razon = (g: number, p: number): number => (p === 0 ? (g === 0 ? 1 : 9999) : g / p);

/** Parte una lista en bloques de valor igual, de mayor a menor. */
function bloques(ids: string[], valor: (id: string) => number): string[][] {
  const v = new Map(ids.map((id) => [id, valor(id)] as const));
  const claves = [...new Set(ids.map((id) => v.get(id)!))].sort((x, y) => y - x);
  return claves.map((k) => ids.filter((id) => v.get(id) === k));
}

/**
 * Rompe un empate.
 *
 * La sutileza del reglamento está aquí: cada criterio se aplica *solo entre
 * los empatados*, y si el bloque se parte, cada subgrupo que sigue empatado
 * vuelve a empezar la cascada desde el primer criterio con su propia
 * sub-tabla. Es la fuente clásica de errores al llevar la tabla a mano.
 *
 * Orden: resultados entre ellos, cociente de sets, cociente de puntos.
 * Si nada los separa, el reglamento manda sorteo y aquí se conserva el
 * orden actual para que el árbitro decida.
 */
export function romper(ids: string[], todos: Partido[], setsPara: number): string[] {
  if (ids.length <= 1) return ids;

  const sub = todos.filter((p) => p.aId && p.bId && ids.includes(p.aId) && ids.includes(p.bId));
  const m = estadisticas(ids, sub, setsPara);

  const criterios: Array<(id: string) => number> = [
    (id) => m[id].pts,
    (id) => razon(m[id].sg, m[id].sp),
    (id) => razon(m[id].tg, m[id].tp),
  ];

  for (const c of criterios) {
    const bs = bloques(ids, c);
    if (bs.length > 1) {
      const out: string[] = [];
      for (const b of bs) out.push(...(b.length > 1 ? romper(b, todos, setsPara) : b));
      return out;
    }
  }
  return ids;
}

/** Orden final del grupo: por puntos y, dentro de cada empate, por la cascada. */
export function clasificar(ids: string[], todos: Partido[], setsPara: number): string[] {
  const m = estadisticas(ids, todos, setsPara);
  const out: string[] = [];
  for (const b of bloques(ids, (id) => m[id].pts)) {
    out.push(...(b.length > 1 ? romper(b, todos, setsPara) : b));
  }
  return out;
}
