import { describe, expect, it } from "vitest";
import { clasificar, estadisticas } from "./clasificacion";
import { armarCuadro, propagar } from "./cuadro";
import { PUNTOS_SET, ganadorDe, partidoListo, reducir } from "./reglas";
import { repartir, sortear } from "./sorteo";
import type { Jugador, Lado, Partido } from "./tipos";

/* ---------- utilidades de prueba ---------- */

let contador = 0;
const nuevoPartido = (aId: string, bId: string): Partido => ({
  id: `p${contador++}`,
  etapa: "grupo",
  aId,
  bId,
  mesa: 0,
  eventos: [],
});

/** Convierte "aabb" en eventos. */
const conPuntos = (secuencia: string): Partido => {
  const p = nuevoPartido("A", "B");
  p.eventos = secuencia.split("").map((j) => ({ t: "punto" as const, j: j as Lado, ts: 0 }));
  return p;
};

/** Juega un set intercalando para que cierre en el marcador pedido. */
function jugarSet(p: Partido, a: number, b: number): void {
  let x = 0;
  let y = 0;
  while (x < a || y < b) {
    if (x < a && (y >= b || x / Math.max(a, 1) <= y / Math.max(b, 1))) {
      p.eventos.push({ t: "punto", j: "a", ts: 0 });
      x++;
    } else {
      p.eventos.push({ t: "punto", j: "b", ts: 0 });
      y++;
    }
  }
}
function jugarPartido(p: Partido, sets: Array<[number, number]>, invertido = false): void {
  p.eventos = [];
  for (const [a, b] of sets) jugarSet(p, invertido ? b : a, invertido ? a : b);
}

const jugadores = (...defs: Array<[string, string, number]>): Jugador[] =>
  defs.map(([nombre, club, rank]) => ({ id: nombre, nombre, club, rank }));

/* ---------- el saque ---------- */

describe("saque", () => {
  it("cambia cada dos puntos desde el inicio", () => {
    const esperado: Lado[] = ["a", "a", "b", "b", "a", "a", "b"];
    for (let n = 0; n <= 6; n++) {
      expect(reducir(conPuntos("a".repeat(n)), 3).saca).toBe(esperado[n]);
    }
  });

  it("cambia cada punto a partir de 10-10", () => {
    const empate = "ab".repeat(10); // 10-10
    const st = reducir(conPuntos(empate), 3);
    expect([st.pa, st.pb]).toEqual([10, 10]);
    expect(st.deuce).toBe(true);
    expect(reducir(conPuntos(empate), 3).saca).toBe("a");
    expect(reducir(conPuntos(empate + "a"), 3).saca).toBe("b");
    expect(reducir(conPuntos(empate + "ab"), 3).saca).toBe("a");
  });

  it("el sorteo del árbitro decide quién abre el primer juego", () => {
    const p = conPuntos("");
    expect(reducir(p, 3).saca).toBe("a");
    p.primeroSaque = "b";
    expect(reducir(p, 3).saca).toBe("b");
    // y la alternancia cada dos puntos parte de ahí
    p.eventos = "aa".split("").map((j) => ({ t: "punto" as const, j: j as Lado, ts: 0 }));
    expect(reducir(p, 3).saca).toBe("a");
  });

  it("en el juego siguiente saca quien recibió en el anterior", () => {
    const st = reducir(conPuntos("a".repeat(PUNTOS_SET)), 3);
    expect(st.juego).toBe(2);
    expect(st.saca).toBe("b");
  });
});

/* ---------- el set y el partido ---------- */

describe("set", () => {
  it("se gana con 11 puntos", () => {
    const st = reducir(conPuntos("a".repeat(11)), 3);
    expect(st.sets).toEqual({ a: 1, b: 0 });
    expect(st.historial).toEqual([{ a: 11, b: 0 }]);
  });

  it("no se gana con 11-10: hacen falta dos de diferencia", () => {
    expect(reducir(conPuntos("ab".repeat(10) + "a"), 3).sets).toEqual({ a: 0, b: 0 });
  });

  it("se gana con 12-10", () => {
    expect(reducir(conPuntos("ab".repeat(10) + "aa"), 3).sets).toEqual({ a: 1, b: 0 });
  });

  it("puede alargarse indefinidamente mientras no haya dos de ventaja", () => {
    const st = reducir(conPuntos("ab".repeat(18)), 3);
    expect([st.pa, st.pb]).toEqual([18, 18]);
    expect(st.terminado).toBe(false);
  });
});

describe("partido", () => {
  it("termina al llegar a los sets del formato", () => {
    expect(reducir(conPuntos("a".repeat(22)), 2).terminado).toBe(true);
    expect(reducir(conPuntos("a".repeat(22)), 3).terminado).toBe(false);
    expect(reducir(conPuntos("a".repeat(33)), 3).ganador).toBe("a");
  });

  it("deshacer un punto revierte incluso un set ya cerrado", () => {
    const p = conPuntos("a".repeat(11));
    expect(reducir(p, 3).sets.a).toBe(1);
    p.eventos.pop();
    const st = reducir(p, 3);
    expect(st.sets.a).toBe(0);
    expect([st.pa, st.pb]).toEqual([10, 0]);
  });
});

/* ---------- desempates ---------- */

describe("desempates del grupo", () => {
  const ids = ["Ramírez", "Vega", "Núñez", "Peña"];

  /** Triple empate que solo se rompe en el tercer criterio. */
  function grupoConTripleEmpate(): Partido[] {
    const ps: Partido[] = [];
    const gana = (g: string, pierde: string, sets: Array<[number, number]>) => {
      const p = nuevoPartido(g, pierde);
      jugarPartido(p, sets);
      ps.push(p);
    };
    gana("Ramírez", "Vega", [[11, 5], [11, 5]]);
    gana("Vega", "Núñez", [[11, 9], [11, 9]]);
    gana("Núñez", "Ramírez", [[11, 3], [11, 3]]);
    gana("Ramírez", "Peña", [[11, 2], [11, 2]]);
    gana("Vega", "Peña", [[11, 2], [11, 2]]);
    gana("Núñez", "Peña", [[11, 2], [11, 2]]);
    return ps;
  }

  it("cuenta 2 puntos por ganado y 1 por perdido", () => {
    const m = estadisticas(ids, grupoConTripleEmpate(), 2);
    expect(m["Ramírez"].pts).toBe(5);
    expect(m["Peña"].pts).toBe(3);
  });

  it("resuelve el triple empate por cociente de puntos entre los empatados", () => {
    const ps = grupoConTripleEmpate();
    // los tres tienen los mismos puntos y los mismos sets entre ellos;
    // solo el cociente de puntos de set los separa
    expect(clasificar(ids, ps, 2)).toEqual(["Núñez", "Ramírez", "Vega", "Peña"]);
  });

  it("un empate a dos se rompe por el resultado directo", () => {
    const ps: Partido[] = [];
    const a = nuevoPartido("X", "Y");
    jugarPartido(a, [[11, 9], [9, 11], [11, 8]]);
    ps.push(a);
    expect(clasificar(["X", "Y"], ps, 2)).toEqual(["X", "Y"]);
  });

  it("no rompe un empate imposible y conserva el orden para el sorteo", () => {
    const ps: Partido[] = [];
    const a = nuevoPartido("X", "Y");
    jugarPartido(a, [[11, 5], [5, 11], [11, 5]]);
    const b = nuevoPartido("Y", "X");
    jugarPartido(b, [[11, 5], [5, 11], [11, 5]]);
    ps.push(a, b);
    expect(clasificar(["X", "Y"], ps, 2)).toHaveLength(2);
  });
});

/* ---------- sorteo ---------- */

describe("sorteo", () => {
  it("reparte los sembrados uno por grupo", () => {
    const js = jugadores(
      ["A1", "Norte", 1500], ["A2", "Centro", 1450], ["A3", "Sur", 1400], ["A4", "Este", 1350],
    );
    const { grupos } = sortear(js, 2);
    const cabezas = grupos.map((g) => g.jugadores[0]);
    expect(cabezas).toContain("A1");
    expect(cabezas).toContain("A2");
  });

  it("separa a los jugadores del mismo club cuando es posible", () => {
    const js = jugadores(
      ["R", "Norte", 1500], ["O", "Centro", 1450], ["S", "Norte", 1400], ["V", "Centro", 1350],
      ["N", "Sur", 1300], ["I", "Sur", 1250], ["D", "Este", 1200], ["P", "Este", 1150],
    );
    const { grupos, relajaciones } = sortear(js, 2);
    expect(relajaciones).toEqual([]);
    for (const g of grupos) {
      const clubes = g.jugadores.map((id) => js.find((j) => j.id === id)!.club);
      expect(new Set(clubes).size).toBe(clubes.length);
    }
  });

  it("reporta la relajación cuando la restricción es infactible", () => {
    // cinco del mismo club en dos grupos: imposible separarlos
    const js = jugadores(
      ["U", "Norte", 900], ["D", "Norte", 880], ["T", "Norte", 860],
      ["C", "Norte", 840], ["Q", "Norte", 820], ["S", "Sur", 800],
    );
    const { relajaciones } = sortear(js, 2);
    expect(relajaciones.length).toBeGreaterThan(0);
    expect(relajaciones[0]).toMatch(/mismo club/);
  });

  it("genera todos contra todos dentro de cada grupo", () => {
    const js = jugadores(
      ["a", "", 0], ["b", "", 0], ["c", "", 0], ["d", "", 0],
      ["e", "", 0], ["f", "", 0], ["g", "", 0], ["h", "", 0],
    );
    const { partidos } = sortear(js, 2);
    expect(partidos).toHaveLength(12); // 2 grupos de 4 → 2 × C(4,2)
  });
});

describe("rol de mesas", () => {
  it("evita que un jugador juegue dos partidos seguidos cuando puede", () => {
    const ps = [
      nuevoPartido("a", "b"), nuevoPartido("a", "c"), nuevoPartido("a", "d"),
      nuevoPartido("b", "c"), nuevoPartido("b", "d"), nuevoPartido("c", "d"),
    ];
    const orden = repartir(ps);
    let choques = 0;
    for (let i = 1; i < orden.length; i++) {
      const p = orden[i - 1];
      const q = orden[i];
      if (q.aId === p.aId || q.aId === p.bId || q.bId === p.aId || q.bId === p.bId) choques++;
    }
    // la heurística voraz no garantiza el óptimo, pero debe mejorar el orden crudo
    expect(choques).toBeLessThan(orden.length - 1);
  });
});

/* ---------- cuadro ---------- */

describe("cuadro eliminatorio", () => {
  function torneoJugado() {
    const js = jugadores(
      ["R", "Norte", 1500], ["O", "Centro", 1450], ["S", "Norte", 1400], ["V", "Centro", 1350],
      ["N", "Sur", 1300], ["I", "Sur", 1250], ["D", "Este", 1200], ["P", "Este", 1150],
    );
    const { grupos, partidos } = sortear(js, 2);
    // gana siempre el de mejor ranking, para que el orden sea predecible
    for (const p of partidos) {
      const ra = js.find((j) => j.id === p.aId)!.rank;
      const rb = js.find((j) => j.id === p.bId)!.rank;
      jugarPartido(p, [[11, 4], [11, 4]], rb > ra);
    }
    return { grupos, partidos };
  }

  it("cruza primeros contra segundos de otro grupo", () => {
    const { grupos, partidos } = torneoJugado();
    const fin = armarCuadro(grupos, partidos, 2, 2);
    const r1 = fin.filter((p) => p.ronda === 0);
    expect(r1).toHaveLength(2);
    for (const p of r1) {
      const ga = grupos.find((g) => g.jugadores.includes(p.aId!))!;
      const gb = grupos.find((g) => g.jugadores.includes(p.bId!))!;
      expect(ga.id).not.toBe(gb.id);
    }
  });

  it("sube al ganador a la ronda siguiente", () => {
    const { grupos, partidos } = torneoJugado();
    const fin = armarCuadro(grupos, partidos, 2, 2);
    const primera = fin.filter((p) => p.ronda === 0);
    for (const p of primera) jugarPartido(p, [[11, 3], [11, 3], [11, 3]]);
    propagar(fin, 3);
    const final = fin.find((p) => p.ronda === 1)!;
    expect(final.aId).toBe(ganadorDe(primera[0], 3));
    expect(final.bId).toBe(ganadorDe(primera[1], 3));
  });

  it("pasa directo a quien no tiene rival", () => {
    const grupos = [{ id: "g", nombre: "Grupo A", jugadores: ["a", "b", "c"] }];
    const ps: Partido[] = [];
    const gana = (x: string, y: string) => {
      const p = nuevoPartido(x, y);
      p.grupoId = "g";
      jugarPartido(p, [[11, 2], [11, 2]]);
      ps.push(p);
    };
    gana("a", "b");
    gana("a", "c");
    gana("b", "c");
    const fin = armarCuadro(grupos, ps, 3, 2); // 3 clasificados → cuadro de 4
    expect(fin.filter((p) => p.ronda === 0)).toHaveLength(2);
    const conHueco = fin.find((p) => p.ronda === 0 && (!p.aId || !p.bId));
    expect(conHueco).toBeDefined();
    const final = fin.find((p) => p.ronda === 1)!;
    expect(final.aId || final.bId).toBeTruthy();
  });
});

describe("estado de partido incompleto", () => {
  it("un partido sin rival definido no cuenta como terminado", () => {
    const p: Partido = { id: "x", etapa: "final", ronda: 0, slot: 0, aId: "a", bId: null, mesa: 0, eventos: [] };
    expect(partidoListo(p, 3)).toBe(false);
  });
});
