import { describe, expect, it } from "vitest";
import { setsDe } from "./asignacion";
import { armarCuadro, ordenDeSiembra, propagar } from "./cuadro";
import type { Grupo, Partido } from "./tipos";

/*
 * La siembra de la eliminatoria.
 *
 * Sin partidos jugados, la tabla de cada grupo queda en el orden de su
 * lista: el primero de la lista es el primero del grupo. Así se puede
 * probar el acomodo sin jugar nada.
 */

const grupos = (...tamaños: number[]): Grupo[] =>
  tamaños.map((k, g) => {
    const letra = String.fromCharCode(65 + g);
    return { id: letra, nombre: `Grupo ${letra}`, jugadores: Array.from({ length: k }, (_, i) => `${letra}${i + 1}`) };
  });

const grupoDe = (id: string | null) => id?.[0] ?? "";
const primera = (fin: Partido[]) => fin.filter((p) => p.ronda === 0).sort((a, b) => a.slot! - b.slot!);
const lugares = (fin: Partido[]) => primera(fin).flatMap((p) => [p.aId, p.bId]);
/** Mitad del cuadro (0 arriba, 1 abajo) en que quedó cada jugador. */
const mitad = (fin: Partido[], id: string) => {
  const ls = lugares(fin);
  return ls.indexOf(id) < ls.length / 2 ? 0 : 1;
};

describe("orden de siembra", () => {
  it("es el de siempre: el 1 y el 2 solo se ven en la final", () => {
    expect(ordenDeSiembra(2)).toEqual([1, 2]);
    expect(ordenDeSiembra(4)).toEqual([1, 4, 2, 3]);
    expect(ordenDeSiembra(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it("en la primera ronda cada partido suma n + 1", () => {
    for (const n of [2, 4, 8, 16, 32]) {
      const o = ordenDeSiembra(n);
      for (let i = 0; i < n; i += 2) expect(o[i] + o[i + 1]).toBe(n + 1);
      expect([...o].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    }
  });
});

describe("cuadro desde los grupos", () => {
  it("dos grupos: primero contra segundo del otro grupo", () => {
    const fin = armarCuadro(grupos(4, 4), [], 2, 2);
    expect(primera(fin).map((p) => [p.aId, p.bId])).toEqual([
      ["A1", "B2"],
      ["B1", "A2"],
    ]);
  });

  it("tres grupos: descansan los dos mejores, no se repite un cruce de grupo y el 1 y el 2 van en mitades distintas", () => {
    const fin = armarCuadro(grupos(4, 4, 3), [], 2, 2);
    const r0 = primera(fin);
    expect(r0).toHaveLength(4);
    // Descansan A1 y B1.
    expect(r0.filter((p) => !p.aId || !p.bId).map((p) => p.aId ?? p.bId).sort()).toEqual(["A1", "B1"]);
    // Ningún partido de la primera ronda es entre dos del mismo grupo.
    for (const p of r0) if (p.aId && p.bId) expect(grupoDe(p.aId)).not.toBe(grupoDe(p.bId));
    // A1 y B1 solo se pueden ver en la final.
    expect(mitad(fin, "A1")).not.toBe(mitad(fin, "B1"));
    // Cada segundo, en la mitad contraria a la de su primero.
    for (const g of ["A", "B", "C"]) expect(mitad(fin, `${g}2`)).not.toBe(mitad(fin, `${g}1`));
  });

  it("los que descansan suben solos a la segunda ronda", () => {
    const fin = armarCuadro(grupos(4, 4, 3), [], 2, 2);
    const semis = fin.filter((p) => p.ronda === 1);
    expect(semis.flatMap((p) => [p.aId, p.bId]).filter(Boolean).sort()).toEqual(["A1", "B1"]);
  });

  it("cuatro grupos: cada segundo en la mitad contraria a su primero y los primeros repartidos", () => {
    const fin = armarCuadro(grupos(3, 3, 3, 3), [], 2, 2);
    for (const p of primera(fin)) expect(grupoDe(p.aId)).not.toBe(grupoDe(p.bId));
    for (const g of ["A", "B", "C", "D"]) expect(mitad(fin, `${g}2`)).not.toBe(mitad(fin, `${g}1`));
    expect(mitad(fin, "A1")).not.toBe(mitad(fin, "B1"));
    expect(mitad(fin, "C1")).not.toBe(mitad(fin, "D1"));
  });

  it("con un solo grupo no hay a quién separar y sigue la siembra", () => {
    const fin = armarCuadro(grupos(5), [], 4, 2);
    expect(primera(fin).map((p) => [p.aId, p.bId])).toEqual([
      ["A1", "A4"],
      ["A2", "A3"],
    ]);
  });

  it("tres por grupo con tres grupos: nadie repite rival de grupo en la primera ronda", () => {
    const fin = armarCuadro(grupos(4, 4, 4), [], 3, 2);
    for (const p of primera(fin)) if (p.aId && p.bId) expect(grupoDe(p.aId)).not.toBe(grupoDe(p.bId));
  });
});

describe("propagar con descansos", () => {
  const p = (ronda: number, slot: number, aId: string | null, bId: string | null): Partido =>
    ({ id: `r${ronda}s${slot}`, etapa: "final", ronda, slot, aId, bId, mesa: 0, orden: 0, eventos: [] }) as Partido;

  it("en semis, el lugar vacío espera al ganador y nadie pasa a la final", () => {
    const f = [p(0, 0, "A", null), p(0, 1, "B", "C"), p(0, 2, "D", null), p(0, 3, "E", "F"), p(1, 0, null, null), p(1, 1, null, null), p(2, 0, null, null)];
    propagar(f, 2);
    expect([f[4].aId, f[4].bId]).toEqual(["A", null]);
    expect([f[5].aId, f[5].bId]).toEqual(["D", null]);
    expect([f[6].aId, f[6].bId]).toEqual([null, null]);
  });
});

describe("semis y final a más sets", () => {
  const p = (ronda: number, slot: number): Partido =>
    ({ id: `r${ronda}s${slot}`, etapa: "final", ronda, slot, aId: null, bId: null, mesa: 0, orden: 0, eventos: [] }) as Partido;
  const partidos = [p(0, 0), p(0, 1), p(0, 2), p(0, 3), p(1, 0), p(1, 1), p(2, 0)];

  it("cuartos con el formato de la llave; semis y final con el suyo", () => {
    const t = { partidos, formatoGrupos: 2, formatoFinales: 2 as const, formatoSemis: 3 as const };
    expect(partidos.map((x) => setsDe(t, x))).toEqual([2, 2, 2, 2, 3, 3, 3]);
  });

  it("sin el ajuste, toda la llave igual", () => {
    const t = { partidos, formatoGrupos: 2, formatoFinales: 2 as const };
    expect(partidos.map((x) => setsDe(t, x))).toEqual([2, 2, 2, 2, 2, 2, 2]);
  });

  it("un cuarto ganado 2-0 sigue contando aunque las semis vayan a 3 de 5", () => {
    const f = partidos.map((x) => ({ ...x }));
    f[0].aId = "A"; f[0].bId = "B";
    f[0].eventos = [{ id: "r", t: "resultado", sets: [{ a: 11, b: 5 }, { a: 11, b: 7 }], ts: 1, por: "juez" }] as Partido["eventos"];
    const t = { partidos: f, formatoGrupos: 2, formatoFinales: 2 as const, formatoSemis: 3 as const };
    propagar(f, (x) => setsDe(t, x));
    expect(f[4].aId).toBe("A");
  });
});
