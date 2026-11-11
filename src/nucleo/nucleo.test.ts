import { describe, expect, it } from "vitest";
import { clasificar, estadisticas } from "./clasificacion";
import { armarCuadro, etiquetaEtapa, nombreRonda, podio, propagar } from "./cuadro";
import { PUNTOS_SET, ganadorDe, partidoListo, reducir } from "./reglas";
import { azar, repartir, sortear } from "./sorteo";
import { estadoMesas, sugerirAsignacion } from "./asignacion";
import { comoTexto, duracionEstimada, proyectar, ritmo } from "./agenda";
import { aplicarPaquete, paqueteDe, unir, unirEventos } from "./sincronizacion";
import { nombreDe } from "./tipos";
import type { Evento, Jugador, Lado, Partido, Torneo } from "./tipos";

/* ---------- utilidades de prueba ---------- */

let contador = 0;
/** Reloj monótono: los eventos se ordenan por tiempo, no por inserción. */
let reloj = 1000;

const nuevoPartido = (aId: string | null, bId: string | null): Partido => ({
  id: `p${contador++}`,
  etapa: "grupo",
  aId,
  bId,
  mesa: 0,
  orden: 0,
  eventos: [],
});

const punto = (j: Lado, ts = reloj++): Evento => ({ id: `e${contador++}`, t: "punto", j, ts, por: "arb" });

/** Cualquier otro evento, con identificador y reloj puestos. */
const otro = (e: Record<string, unknown>): Evento =>
  ({ id: `e${contador++}`, ts: reloj++, por: "arb", ...e }) as unknown as Evento;

const inicia = (saque: Lado, invertido = false) => otro({ t: "inicia", saque, invertido });
const reanuda = () => otro({ t: "reanuda" });
const anula = (ref: string) => otro({ t: "anula", ref });
const valida = () => otro({ t: "valida", por: "juez" });
const corrige = (sets: Array<{ a: number; b: number }>, nota = "") =>
  otro({ t: "corrige", sets, nota, por: "juez" });

/** Convierte "aabb" en eventos. */
const conPuntos = (secuencia: string): Partido => {
  const p = nuevoPartido("A", "B");
  p.eventos = secuencia.split("").map((j) => punto(j as Lado));
  return p;
};

/** Juega un set intercalando para que cierre en el marcador pedido. */
function jugarSet(p: Partido, a: number, b: number): void {
  let x = 0;
  let y = 0;
  while (x < a || y < b) {
    if (x < a && (y >= b || x / Math.max(a, 1) <= y / Math.max(b, 1))) {
      p.eventos.push(punto("a"));
      x++;
    } else {
      p.eventos.push(punto("b"));
      y++;
    }
  }
}

/** Juega el partido entero, con su descanso entre sets. */
function jugarPartido(p: Partido, sets: Array<[number, number]>): Partido {
  sets.forEach(([x, y], i) => {
    if (i) p.eventos.push(reanuda());
    jugarSet(p, x, y);
  });
  return p;
}

const nuevoTorneo = (over: Partial<Torneo> = {}): Torneo => ({
  id: "t1",
  revision: 1,
  nombre: "Prueba",
  sede: "",
  modalidad: "individual",
  mesas: 2,
  formatoGrupos: 2,
  formatoFinales: 3,
  nGrupos: 2,
  clasifican: 2,
  descansoSet: 1,
  descansoJugador: 10,
  duracionTiempo: 60,
  duracionSupuesta: 20,
  validacionObligatoria: false,
  configurado: true,
  modoGuiado: false,
  pinJuez: "",
  semillaSorteo: 0,
  actaSorteo: [],
  jugadores: [],
  arbitros: [],
  grupos: [],
  partidos: [],
  relajaciones: [],
  ...over,
});

/* ---------- saque ---------- */

describe("saque", () => {
  it("cambia cada dos puntos desde el inicio", () => {
    expect(reducir(conPuntos(""), 2).saca).toBe("a");
    expect(reducir(conPuntos("a"), 2).saca).toBe("a");
    expect(reducir(conPuntos("aa"), 2).saca).toBe("b");
    expect(reducir(conPuntos("aab"), 2).saca).toBe("b");
    expect(reducir(conPuntos("aabb"), 2).saca).toBe("a");
  });

  it("cambia cada punto a partir de 10-10", () => {
    const p = conPuntos("");
    jugarSet(p, 10, 10);
    const antes = reducir(p, 2).saca;
    p.eventos.push(punto("a"));
    expect(reducir(p, 2).saca).not.toBe(antes);
    p.eventos.push(punto("b"));
    expect(reducir(p, 2).saca).toBe(antes);
  });

  it("el sorteo del árbitro decide quién abre el primer juego", () => {
    const p = nuevoPartido("A", "B");
    p.eventos.push(inicia("b"));
    expect(reducir(p, 2).saca).toBe("b");
    p.eventos.push(punto("a"), punto("a"));
    expect(reducir(p, 2).saca).toBe("a");
  });

  it("vale el último inicia: el árbitro puede corregirse antes de empezar", () => {
    const p = nuevoPartido("A", "B");
    p.eventos.push(inicia("b"), inicia("a", true));
    const st = reducir(p, 2);
    expect(st.saca).toBe("a");
    expect(st.invertido).toBe(true);
  });

  it("en el juego siguiente saca quien recibió en el anterior", () => {
    const p = nuevoPartido("A", "B");
    jugarSet(p, 11, 5);
    p.eventos.push(reanuda());
    expect(reducir(p, 3).juego).toBe(2);
    expect(reducir(p, 3).saca).toBe("b");
  });
});

/* ---------- set ---------- */

describe("set", () => {
  it("se gana con 11 puntos", () => {
    const p = nuevoPartido("A", "B");
    jugarSet(p, PUNTOS_SET, 4);
    expect(reducir(p, 2).sets).toEqual({ a: 1, b: 0 });
  });

  it("no se gana con 11-10: hacen falta dos de diferencia", () => {
    const p = nuevoPartido("A", "B");
    jugarSet(p, 10, 10);
    p.eventos.push(punto("a"));
    const st = reducir(p, 2);
    expect(st.sets).toEqual({ a: 0, b: 0 });
    expect([st.pa, st.pb]).toEqual([11, 10]);
  });

  it("se gana con 12-10", () => {
    const p = nuevoPartido("A", "B");
    jugarSet(p, 10, 10);
    p.eventos.push(punto("a"), punto("a"));
    expect(reducir(p, 2).sets).toEqual({ a: 1, b: 0 });
    expect(reducir(p, 2).historial).toEqual([{ a: 12, b: 10 }]);
  });

  it("puede alargarse indefinidamente mientras no haya dos de ventaja", () => {
    const p = nuevoPartido("A", "B");
    jugarSet(p, 20, 20);
    expect(reducir(p, 2).sets).toEqual({ a: 0, b: 0 });
    expect(reducir(p, 2).pa).toBe(20);
  });
});

/* ---------- descanso entre sets ---------- */

describe("descanso entre sets", () => {
  it("al cerrar un set el partido queda en descanso, no en el 0-0 del siguiente", () => {
    const p = nuevoPartido("A", "B");
    jugarSet(p, 11, 5);
    const st = reducir(p, 3);
    expect(st.fase).toBe("descanso");
    expect(st.descansoDesde).not.toBeNull();
    expect(st.historial).toEqual([{ a: 11, b: 5 }]);
  });

  it("reanudar lo devuelve al juego", () => {
    const p = nuevoPartido("A", "B");
    jugarSet(p, 11, 5);
    p.eventos.push(reanuda());
    const st = reducir(p, 3);
    expect(st.fase).toBe("en-juego");
    expect(st.descansoDesde).toBeNull();
  });

  it("anotar el primer punto también levanta el descanso", () => {
    const p = nuevoPartido("A", "B");
    jugarSet(p, 11, 5);
    p.eventos.push(punto("b"));
    expect(reducir(p, 3).fase).toBe("en-juego");
  });

  it("no hay descanso cuando el set que cerró terminó el partido", () => {
    const p = jugarPartido(nuevoPartido("A", "B"), [
      [11, 5],
      [11, 7],
    ]);
    const st = reducir(p, 2);
    expect(st.terminado).toBe(true);
    expect(st.fase).toBe("por-validar");
  });

  it("deshacer el punto que cerró el set cancela el descanso", () => {
    const p = nuevoPartido("A", "B");
    jugarSet(p, 11, 5);
    p.eventos.push(anula(p.eventos[p.eventos.length - 1].id));
    const st = reducir(p, 3);
    expect(st.fase).toBe("en-juego");
    expect(st.sets).toEqual({ a: 0, b: 0 });
    expect(st.pa).toBe(10);
  });

  it("un reanudar viejo no cuenta para el descanso del set siguiente", () => {
    const p = nuevoPartido("A", "B");
    jugarSet(p, 11, 5);
    p.eventos.push(reanuda());
    jugarSet(p, 11, 6);
    expect(reducir(p, 3).fase).toBe("descanso");
  });
});

/* ---------- deshacer como anulación ---------- */

describe("deshacer", () => {
  it("revierte incluso un set ya cerrado", () => {
    const p = nuevoPartido("A", "B");
    jugarSet(p, 11, 9);
    expect(reducir(p, 2).sets.a).toBe(1);
    p.eventos.push(anula(p.eventos[p.eventos.length - 1].id));
    const st = reducir(p, 2);
    expect(st.sets.a).toBe(0);
    expect(st.pa).toBe(10);
    expect(st.pb).toBe(9);
  });

  it("no borra nada: el punto anulado sigue en el registro", () => {
    const p = conPuntos("aab");
    const antes = p.eventos.length;
    p.eventos.push(anula(p.eventos[2].id));
    expect(p.eventos.length).toBe(antes + 1);
    expect(reducir(p, 2).pb).toBe(0);
  });

  it("anular un punto de en medio recalcula lo que vino después", () => {
    const p = conPuntos("abab");
    p.eventos.push(anula(p.eventos[0].id));
    const st = reducir(p, 2);
    expect(st.pa).toBe(1);
    expect(st.pb).toBe(2);
    // Con un punto menos, el turno de saque también se corre.
    expect(st.saca).toBe("b");
  });
});

/* ---------- validación y corrección ---------- */

describe("validación del juez", () => {
  const terminado = () =>
    jugarPartido(nuevoPartido("A", "B"), [
      [11, 4],
      [11, 6],
    ]);

  it("el partido terminado queda por validar", () => {
    expect(reducir(terminado(), 2).fase).toBe("por-validar");
  });

  it("con validación obligatoria no cuenta hasta que el juez lo acepta", () => {
    const p = terminado();
    expect(partidoListo(p, 2, true)).toBe(false);
    expect(partidoListo(p, 2, false)).toBe(true);
    p.eventos.push(valida());
    expect(reducir(p, 2).fase).toBe("validado");
    expect(partidoListo(p, 2, true)).toBe(true);
  });

  it("la corrección del juez manda sobre lo que digan los puntos", () => {
    const p = terminado();
    expect(reducir(p, 2).ganador).toBe("a");
    p.eventos.push(
      corrige(
        [
          { a: 9, b: 11 },
          { a: 8, b: 11 },
        ],
        "el árbitro anotó al revés los dos sets",
      ),
    );
    const st = reducir(p, 2);
    expect(st.ganador).toBe("b");
    expect(st.corregido).toBe(true);
    expect(st.correccion?.nota).toContain("al revés");
    expect(st.correccion?.por).toBe("juez");
    expect(ganadorDe(p, 2)).toBe("B");
  });

  it("corregir no borra el registro: se puede auditar qué anotó el árbitro", () => {
    const p = terminado();
    const puntos = p.eventos.filter((e) => e.t === "punto").length;
    p.eventos.push(corrige([{ a: 11, b: 0 }]));
    expect(p.eventos.filter((e) => e.t === "punto").length).toBe(puntos);
  });
});

/* ---------- desempates del grupo ---------- */

describe("desempates del grupo", () => {
  const jugado = (a: string, b: string, sets: Array<[number, number]>): Partido =>
    jugarPartido(nuevoPartido(a, b), sets);

  it("cuenta 2 puntos por ganado y 1 por perdido", () => {
    const ps = [
      jugado("A", "B", [
        [11, 5],
        [11, 7],
      ]),
    ];
    const m = estadisticas(["A", "B"], ps, 2);
    expect(m.A.pts).toBe(2);
    expect(m.B.pts).toBe(1);
  });

  it("la cascada no se detiene: llega al cociente de puntos si hace falta", () => {
    // Ciclo cerrado: A gana a B, B gana a C, C gana a A. Los tres quedan
    // con 3 puntos y con 2-2 en sets, así que los dos primeros criterios
    // no separan a nadie y todo se decide en el tercero.
    //   A: 40 puntos a favor, 32 en contra  → 1.25
    //   B: 32 a favor, 32 en contra         → 1.00
    //   C: 32 a favor, 40 en contra         → 0.80
    const ps = [
      jugado("A", "B", [
        [11, 5],
        [11, 5],
      ]),
      jugado("B", "C", [
        [11, 5],
        [11, 5],
      ]),
      jugado("C", "A", [
        [11, 9],
        [11, 9],
      ]),
    ];
    const m = estadisticas(["A", "B", "C"], ps, 2);
    expect([m.A.pts, m.B.pts, m.C.pts]).toEqual([3, 3, 3]);
    expect([m.A.sg - m.A.sp, m.B.sg - m.B.sp, m.C.sg - m.C.sp]).toEqual([0, 0, 0]);
    expect(clasificar(["A", "B", "C"], ps, 2)).toEqual(["A", "B", "C"]);
  });

  it("entre dos empatados manda el partido entre ellos, no la tabla general", () => {
    // A y B terminan con 5 puntos cada uno. Por cociente global B va muy
    // por delante —le pasó por encima a C y a D— pero A le ganó el partido
    // directo, y el reglamento mira primero eso, aplicado solo entre los
    // dos empatados.
    const ps = [
      jugado("A", "B", [
        [11, 9],
        [11, 9],
      ]),
      jugado("A", "C", [
        [11, 9],
        [11, 9],
      ]),
      jugado("A", "D", [
        [9, 11],
        [9, 11],
      ]),
      jugado("B", "C", [
        [11, 0],
        [11, 0],
      ]),
      jugado("B", "D", [
        [11, 0],
        [11, 0],
      ]),
      jugado("C", "D", [
        [11, 0],
        [11, 0],
      ]),
    ];
    const m = estadisticas(["A", "B", "C", "D"], ps, 2);
    expect(m.A.pts).toBe(m.B.pts);
    expect(m.B.tg / m.B.tp).toBeGreaterThan(m.A.tg / m.A.tp);
    const orden = clasificar(["A", "B", "C", "D"], ps, 2);
    expect(orden.indexOf("A")).toBeLessThan(orden.indexOf("B"));
  });

  it("no rompe un empate imposible y conserva el orden para el sorteo", () => {
    const ps = [
      jugado("A", "B", [
        [11, 5],
        [11, 5],
      ]),
      jugado("B", "C", [
        [11, 5],
        [11, 5],
      ]),
      jugado("C", "A", [
        [11, 5],
        [11, 5],
      ]),
    ];
    expect(clasificar(["A", "B", "C"], ps, 2)).toEqual(["A", "B", "C"]);
  });

  it("con validación obligatoria, un resultado sin validar no mueve la tabla", () => {
    const ps = [
      jugado("A", "B", [
        [11, 5],
        [11, 7],
      ]),
    ];
    expect(estadisticas(["A", "B"], ps, 2, true).A.pj).toBe(0);
    ps[0].eventos.push(valida());
    expect(estadisticas(["A", "B"], ps, 2, true).A.pj).toBe(1);
  });
});

/* ---------- sorteo ---------- */

describe("sorteo", () => {
  const gente = (n: number, club = (i: number) => `C${i}`): Jugador[] =>
    Array.from({ length: n }, (_, i) => ({ id: `j${i}`, nombre: `J${i}`, club: club(i), rank: 100 - i }));

  it("reparte los sembrados uno por grupo", () => {
    const { grupos } = sortear(gente(8), 4);
    const cabezas = ["j0", "j1", "j2", "j3"];
    for (const g of grupos) expect(g.jugadores.filter((x) => cabezas.includes(x)).length).toBe(1);
  });

  it("separa a los jugadores del mismo club cuando es posible", () => {
    const js = gente(8, (i) => (i < 2 ? "Norte" : `C${i}`));
    const { grupos, relajaciones } = sortear(js, 4);
    expect(relajaciones).toEqual([]);
    for (const g of grupos) expect(g.jugadores.filter((x) => x === "j0" || x === "j1").length).toBeLessThan(2);
  });

  it("reporta la relajación cuando la restricción es infactible", () => {
    const { relajaciones, acta } = sortear(gente(6, () => "Norte"), 2);
    expect(relajaciones.length).toBeGreaterThan(0);
    expect(acta.join(" ")).toContain("no se pudieron cumplir");
  });

  it("genera todos contra todos dentro de cada grupo", () => {
    const { grupos, partidos } = sortear(gente(6), 2);
    const esperados = grupos.reduce((n, g) => n + (g.jugadores.length * (g.jugadores.length - 1)) / 2, 0);
    expect(partidos.length).toBe(esperados);
  });

  it("la misma semilla da el mismo sorteo", () => {
    const js = gente(12);
    const uno = sortear(js, 3, { semilla: 4242 });
    const dos = sortear(js, 3, { semilla: 4242 });
    expect(uno.grupos.map((g) => g.jugadores)).toEqual(dos.grupos.map((g) => g.jugadores));
  });

  it("semillas distintas dan sorteos distintos", () => {
    const js = gente(12);
    const uno = sortear(js, 3, { semilla: 1 });
    const dos = sortear(js, 3, { semilla: 2 });
    expect(uno.grupos.map((g) => g.jugadores)).not.toEqual(dos.grupos.map((g) => g.jugadores));
  });

  it("el sorteo por computadora respeta la siembra igual que el manual", () => {
    const { grupos } = sortear(gente(12), 4, { semilla: 31337 });
    const cabezas = ["j0", "j1", "j2", "j3"];
    for (const g of grupos) expect(g.jugadores.filter((x) => cabezas.includes(x)).length).toBe(1);
  });

  it("el acta deja constancia de la semilla usada", () => {
    const { acta } = sortear(gente(4), 2, { semilla: 777 });
    expect(acta[0]).toContain("777");
  });

  it("el generador con semilla es reproducible", () => {
    const a = azar(9);
    const b = azar(9);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

/* ---------- rol de mesas ---------- */

describe("rol de mesas", () => {
  /** Cuántas veces alguien juega dos partidos seguidos. */
  const seguidos = (orden: Partido[]): number => {
    let n = 0;
    for (let i = 1; i < orden.length; i++) {
      const x = orden[i];
      const y = orden[i - 1];
      if (x.aId === y.aId || x.aId === y.bId || x.bId === y.aId || x.bId === y.bId) n++;
    }
    return n;
  };

  it("reduce los partidos seguidos, aunque con cuatro jugadores no pueda evitarlos todos", () => {
    // En un todos contra todos de cuatro, cada partido comparte jugador
    // con cuatro de los otros cinco: no existe un orden sin choques. Lo
    // que se pide al reparto es que baje de los cuatro del orden natural.
    const lista = [
      nuevoPartido("A", "B"),
      nuevoPartido("A", "C"),
      nuevoPartido("A", "D"),
      nuevoPartido("B", "C"),
      nuevoPartido("B", "D"),
      nuevoPartido("C", "D"),
    ];
    const natural = seguidos(lista);
    const repartido = seguidos(repartir(lista));
    expect(natural).toBe(4);
    expect(repartido).toBeLessThanOrEqual(2);
  });

  it("con jugadores de sobra no deja a nadie dos veces seguidas", () => {
    const lista = [
      nuevoPartido("A", "B"),
      nuevoPartido("A", "C"),
      nuevoPartido("D", "E"),
      nuevoPartido("D", "F"),
      nuevoPartido("G", "H"),
    ];
    expect(seguidos(repartir(lista))).toBe(0);
  });

  it("numera el rol para que las mesas sepan el turno", () => {
    const orden = repartir([nuevoPartido("A", "B"), nuevoPartido("C", "D")]);
    expect(orden.map((p) => p.orden)).toEqual([0, 1]);
  });
});

/* ---------- cuadro eliminatorio ---------- */

describe("cuadro eliminatorio", () => {
  const grupoListo = (nombre: string, ids: string[]) => ({
    grupo: { id: nombre, nombre, jugadores: ids },
    partidos: ids.flatMap((x, i) =>
      ids.slice(i + 1).map((y) => {
        const p = jugarPartido(nuevoPartido(x, y), [
          [11, 3],
          [11, 3],
        ]);
        p.grupoId = nombre;
        return p;
      }),
    ),
  });

  it("cruza primeros contra segundos de otro grupo", () => {
    const g1 = grupoListo("G1", ["a1", "a2"]);
    const g2 = grupoListo("G2", ["b1", "b2"]);
    const finales = armarCuadro([g1.grupo, g2.grupo], [...g1.partidos, ...g2.partidos], 2, 2);
    const primera = finales.filter((p) => p.ronda === 0);
    expect(primera.length).toBe(2);
    for (const p of primera) {
      const mismoGrupo =
        (p.aId?.startsWith("a") && p.bId?.startsWith("a")) || (p.aId?.startsWith("b") && p.bId?.startsWith("b"));
      expect(mismoGrupo).toBe(false);
    }
  });

  it("sube al ganador a la ronda siguiente", () => {
    const finales: Partido[] = [
      { ...nuevoPartido("a1", "b2"), etapa: "final", ronda: 0, slot: 0 },
      { ...nuevoPartido("b1", "a2"), etapa: "final", ronda: 0, slot: 1 },
      { ...nuevoPartido(null, null), etapa: "final", ronda: 1, slot: 0 },
    ];
    jugarPartido(finales[0], [
      [11, 2],
      [11, 2],
    ]);
    propagar(finales, 2);
    expect(finales[2].aId).toBe("a1");
    expect(finales[2].bId).toBe(null);
  });

  it("con validación obligatoria el ganador no sube hasta que el juez acepta", () => {
    const finales: Partido[] = [
      { ...nuevoPartido("a1", "b2"), etapa: "final", ronda: 0, slot: 0 },
      { ...nuevoPartido("b1", "a2"), etapa: "final", ronda: 0, slot: 1 },
      { ...nuevoPartido(null, null), etapa: "final", ronda: 1, slot: 0 },
    ];
    jugarPartido(finales[0], [
      [11, 2],
      [11, 2],
    ]);
    propagar(finales, 2, true);
    expect(finales[2].aId).toBe(null);
    finales[0].eventos.push(valida());
    propagar(finales, 2, true);
    expect(finales[2].aId).toBe("a1");
  });

  it("cada fase se llama como la llama la gente", () => {
    expect(nombreRonda(0, 1)).toBe("Final");
    expect(nombreRonda(0, 2)).toBe("Semifinal");
    expect(nombreRonda(0, 3)).toBe("Cuartos de final");
    expect(nombreRonda(1, 3)).toBe("Semifinal");
    expect(nombreRonda(0, 4)).toBe("Octavos de final");
  });

  it("un partido de grupo se anuncia con el nombre de su grupo", () => {
    const g = { id: "G1", nombre: "Grupo B", jugadores: ["a1", "a2"] };
    const p = { ...nuevoPartido("a1", "a2"), grupoId: "G1" };
    expect(etiquetaEtapa({ grupos: [g], partidos: [p] }, p)).toBe("Grupo B");
  });

  it("el podio no existe hasta que la final está resuelta", () => {
    const finales: Partido[] = [
      { ...nuevoPartido("a1", "b2"), etapa: "final", ronda: 0, slot: 0 },
      { ...nuevoPartido("b1", "a2"), etapa: "final", ronda: 0, slot: 1 },
      { ...nuevoPartido(null, null), etapa: "final", ronda: 1, slot: 0 },
    ];
    const t = { grupos: [], partidos: finales, formatoFinales: 2, validacionObligatoria: false };
    expect(podio(t)).toBe(null);

    jugarPartido(finales[0], [
      [11, 2],
      [11, 2],
    ]);
    jugarPartido(finales[1], [
      [2, 11],
      [2, 11],
    ]);
    propagar(finales, 2);
    expect(podio(t)).toBe(null); // la final todavía no se ha jugado

    jugarPartido(finales[2], [
      [11, 9],
      [11, 9],
    ]);
    const r = podio(t)!;
    expect(r.campeon).toBe("a1");
    expect(r.subcampeon).toBe("a2");
    expect(r.terceros.sort()).toEqual(["b1", "b2"]);
  });

  it("pasa directo a quien no tiene rival", () => {
    const finales: Partido[] = [
      { ...nuevoPartido("a1", null), etapa: "final", ronda: 0, slot: 0 },
      { ...nuevoPartido("b1", "a2"), etapa: "final", ronda: 0, slot: 1 },
      { ...nuevoPartido(null, null), etapa: "final", ronda: 1, slot: 0 },
    ];
    propagar(finales, 2);
    expect(finales[2].aId).toBe("a1");
  });
});

/* ---------- asignación de mesas ---------- */

describe("asignación de mesas", () => {
  const torneoCon = (partidos: Partido[], over: Partial<Torneo> = {}) =>
    nuevoTorneo({
      mesas: 2,
      descansoJugador: 0,
      jugadores: ["A", "B", "C", "D", "E", "F"].map((x) => ({ id: x, nombre: x, club: "", rank: 0 })),
      arbitros: [
        { id: "r1", nombre: "Ruiz", mesa: 1 },
        { id: "r2", nombre: "Lara", mesa: 2 },
      ],
      partidos,
      ...over,
    });

  it("llena las mesas libres y pone en cada una a su árbitro", () => {
    const pr = sugerirAsignacion(torneoCon([nuevoPartido("A", "B"), nuevoPartido("C", "D")]));
    expect(pr.asignaciones.length).toBe(2);
    expect(pr.asignaciones.map((x) => x.mesa).sort()).toEqual([1, 2]);
    expect(pr.asignaciones.find((x) => x.mesa === 1)?.arbitroId).toBe("r1");
  });

  it("no toca una mesa que está ocupada", () => {
    const enJuego = nuevoPartido("A", "B");
    enJuego.mesa = 1;
    enJuego.eventos.push(punto("a"));
    const pr = sugerirAsignacion(torneoCon([enJuego, nuevoPartido("C", "D"), nuevoPartido("E", "F")]));
    expect(pr.asignaciones.length).toBe(1);
    expect(pr.asignaciones[0].mesa).toBe(2);
  });

  it("no manda a un jugador a dos mesas a la vez", () => {
    const pr = sugerirAsignacion(torneoCon([nuevoPartido("A", "B"), nuevoPartido("A", "C")]));
    expect(pr.asignaciones.length).toBe(1);
    expect(pr.espera[0].razon).toContain("ya entró");
  });

  it("un jugador que está en la mesa no entra en la propuesta", () => {
    const enJuego = nuevoPartido("A", "B");
    enJuego.mesa = 1;
    enJuego.eventos.push(punto("a"));
    const pr = sugerirAsignacion(torneoCon([enJuego, nuevoPartido("A", "C")]));
    expect(pr.asignaciones.length).toBe(0);
    expect(pr.espera[0].razon).toContain("está jugando");
  });

  it("con el descanso sin cumplir propone igual, pero avisa de a quién le falta", () => {
    // El descanso es recomendación, no ley física: si bloqueara, recién
    // acabada una ronda no se podría mandar nada con todas las mesas
    // libres, que es justo cuando hace falta repartir.
    const recien = jugarPartido(nuevoPartido("A", "B"), [
      [11, 2],
      [11, 2],
    ]);
    const ahora = reducir(recien, 2).hasta! + 60_000;
    const pr = sugerirAsignacion(torneoCon([recien, nuevoPartido("A", "C")], { descansoJugador: 10 }), ahora);
    expect(pr.asignaciones.length).toBe(1);
    expect(pr.asignaciones[0].motivo).toContain("descanso");
    expect(pr.asignaciones[0].motivo).toMatch(/faltan \d+ min/);
  });

  it("prefiere a quien ya descansó frente a quien acaba de jugar", () => {
    const recien = jugarPartido(nuevoPartido("A", "B"), [
      [11, 2],
      [11, 2],
    ]);
    const ahora = reducir(recien, 2).hasta! + 60_000;
    const descansado = nuevoPartido("E", "F");
    const cansado = nuevoPartido("A", "C");
    const t = torneoCon([recien, cansado, descansado], { descansoJugador: 10, mesas: 1 });
    const pr = sugerirAsignacion(t, ahora);
    const elegido = t.partidos.find((p) => p.id === pr.asignaciones[0].partidoId)!;
    expect([elegido.aId, elegido.bId]).toEqual(["E", "F"]);
    expect(pr.asignaciones[0].motivo).not.toContain("descanso");
  });

  it("nunca manda a un jugador a dos mesas, aunque el descanso ya no bloquee", () => {
    const enJuego = nuevoPartido("A", "B");
    enJuego.mesa = 1;
    enJuego.eventos.push(punto("a"));
    const pr = sugerirAsignacion(torneoCon([enJuego, nuevoPartido("A", "C")], { descansoJugador: 0 }));
    expect(pr.asignaciones.length).toBe(0);
    expect(pr.espera[0].razon).toContain("está jugando");
  });

  it("atiende la eliminatoria antes que los partidos de grupo", () => {
    const final: Partido = { ...nuevoPartido("A", "B"), etapa: "final", ronda: 0, slot: 0 };
    const pr = sugerirAsignacion(torneoCon([nuevoPartido("C", "D"), final], { mesas: 1 }));
    expect(pr.asignaciones[0].partidoId).toBe(final.id);
    expect(pr.asignaciones[0].motivo).toContain("Eliminatoria");
  });

  it("prefiere la mesa que tiene árbitro", () => {
    const pr = sugerirAsignacion(
      torneoCon([nuevoPartido("A", "B")], { arbitros: [{ id: "r2", nombre: "Lara", mesa: 2 }] }),
    );
    expect(pr.asignaciones[0].mesa).toBe(2);
    expect(pr.ociosas).toEqual([1]);
  });

  it("la foto de mesas dice qué se juega en cada una", () => {
    const p = nuevoPartido("A", "B");
    p.mesa = 2;
    const mesas = estadoMesas(torneoCon([p]));
    expect(mesas[0].libre).toBe(true);
    expect(mesas[1].partido?.id).toBe(p.id);
    expect(mesas[1].arbitro).toBe("Lara");
  });
});

/* ---------- agenda y tiempos ---------- */

describe("agenda", () => {
  it("sin partidos medidos usa la duración supuesta", () => {
    const r = ritmo(nuevoTorneo({ duracionSupuesta: 27 }));
    expect(r.medido).toBe(false);
    expect(r.porSet).toBeCloseTo(27 / 2.7, 5);
  });

  it("mide el ritmo real en cuanto hay partidos terminados", () => {
    // Cuatro partidos de dos sets, veinte minutos cada uno: diez por set.
    const partidos = Array.from({ length: 4 }, (_, k) => {
      const p = nuevoPartido(`x${k}`, `y${k}`);
      const base = 1_000_000 + k * 10_000_000;
      for (let i = 0; i < 11; i++) p.eventos.push({ id: `u${k}-${i}`, t: "punto", j: "a", ts: base + i, por: "arb" });
      for (let i = 0; i < 11; i++)
        p.eventos.push({ id: `v${k}-${i}`, t: "punto", j: "a", ts: base + 20 * 60_000 + i, por: "arb" });
      return p;
    });
    const r = ritmo(nuevoTorneo({ partidos }));
    expect(r.medido).toBe(true);
    expect(r.medidos).toBe(4);
    expect(r.porSet).toBeGreaterThan(8);
    expect(r.porSet).toBeLessThan(12);
  });

  it("el que está en la mesa aparece sin espera y el resto en cola", () => {
    const jugando = nuevoPartido("A", "B");
    jugando.mesa = 1;
    jugando.eventos.push(punto("a"));
    const turnos = proyectar(
      nuevoTorneo({
        mesas: 1,
        descansoJugador: 0,
        partidos: [jugando, nuevoPartido("C", "D"), nuevoPartido("E", "F")],
      }),
    );
    expect(turnos[0].jugando).toBe(true);
    expect(turnos[0].espera).toBe(0);
    expect(turnos[1].espera).toBeGreaterThan(0);
    expect(turnos[2].espera).toBeGreaterThan(turnos[1].espera);
  });

  it("reparte la cola entre las mesas disponibles", () => {
    const turnos = proyectar(
      nuevoTorneo({ mesas: 2, descansoJugador: 0, partidos: [nuevoPartido("A", "B"), nuevoPartido("C", "D")] }),
    );
    expect(new Set(turnos.map((x) => x.mesa))).toEqual(new Set([1, 2]));
    expect(turnos.every((x) => x.espera === 0)).toBe(true);
  });

  it("no pone a un jugador en dos mesas al mismo tiempo", () => {
    const turnos = proyectar(
      nuevoTorneo({ mesas: 2, descansoJugador: 0, partidos: [nuevoPartido("A", "B"), nuevoPartido("A", "C")] }),
    );
    expect(turnos[1].espera).toBeGreaterThan(0);
  });

  it("respeta la mesa que ya fijó el juez", () => {
    const p = nuevoPartido("A", "B");
    p.mesa = 2;
    const turnos = proyectar(nuevoTorneo({ mesas: 3, descansoJugador: 0, partidos: [p] }));
    expect(turnos[0].mesa).toBe(2);
    expect(turnos[0].mesaFirme).toBe(true);
  });

  it("los partidos terminados ya no aparecen en la agenda", () => {
    const listo = jugarPartido(nuevoPartido("A", "B"), [
      [11, 2],
      [11, 2],
    ]);
    const turnos = proyectar(nuevoTorneo({ partidos: [listo, nuevoPartido("C", "D")] }));
    expect(turnos.map((x) => x.partidoId)).not.toContain(listo.id);
  });

  it("la duración estimada sigue a los sets que de verdad se juegan", () => {
    // Seis partidos de dos sets y veinte minutos cada uno. Suponer 2.7
    // sets por partido, como se hacía antes, inflaba la cuenta a 25.
    const partidos = Array.from({ length: 6 }, (_, k) => {
      const p = nuevoPartido(`x${k}`, `y${k}`);
      const base = 1_000_000 + k * 10_000_000;
      for (let i = 0; i < 11; i++) p.eventos.push({ id: `d${k}-${i}`, t: "punto", j: "a", ts: base + i * 54_000, por: "arb" });
      for (let i = 0; i < 11; i++)
        p.eventos.push({ id: `e${k}-${i}`, t: "punto", j: "a", ts: base + 600_000 + i * 54_000, por: "arb" });
      return p;
    });
    const t = nuevoTorneo({ partidos, formatoGrupos: 2, duracionSupuesta: 20 });
    const r = ritmo(t);
    expect(r.medido).toBe(true);
    expect(r.setsPorPartido).toBe(2);
    expect(duracionEstimada(t, 2)).toBeGreaterThan(15);
    expect(duracionEstimada(t, 2)).toBeLessThan(23);
  });

  it("sin nada medido, la duración es la supuesta del torneo", () => {
    expect(duracionEstimada(nuevoTorneo({ duracionSupuesta: 20 }), 2)).toBe(20);
  });

  it("dice el tiempo en palabras", () => {
    expect(comoTexto(0)).toBe("ya");
    expect(comoTexto(7)).toBe("en 7 min");
    expect(comoTexto(70)).toBe("en 1 h 10 min");
    expect(comoTexto(120)).toBe("en 2 h");
  });
});

/* ---------- sincronización ---------- */

describe("sincronización", () => {
  it("unir dos registros no depende del orden", () => {
    const x: Evento[] = [punto("a", 10), punto("b", 20)];
    const y: Evento[] = [punto("a", 30)];
    expect(unirEventos(x, y).map((e) => e.id)).toEqual(unirEventos(y, x).map((e) => e.id));
  });

  it("unir dos veces lo mismo no duplica nada", () => {
    const x: Evento[] = [punto("a", 10), punto("b", 20)];
    expect(unirEventos(x, x).length).toBe(2);
    expect(unirEventos(unirEventos(x, x), x).length).toBe(2);
  });

  it("los eventos de las dos copias acaban en las dos", () => {
    const base = nuevoPartido("A", "B");
    const local = nuevoTorneo({ partidos: [{ ...base, eventos: [punto("a", 10)] }] });
    const remoto = nuevoTorneo({ partidos: [{ ...base, eventos: [punto("b", 20)] }] });
    const { torneo, resumen } = unir(local, remoto);
    expect(torneo.partidos[0].eventos.length).toBe(2);
    expect(resumen.eventosNuevos).toBe(1);
    expect(resumen.partidosTocados).toBe(1);
  });

  it("la estructura de mayor revisión manda, pero los puntos no se pierden", () => {
    const base = nuevoPartido("A", "B");
    const viejo = nuevoTorneo({ revision: 3, nombre: "viejo", partidos: [{ ...base, eventos: [punto("a", 10)] }] });
    const nuevo = nuevoTorneo({ revision: 7, nombre: "nuevo", partidos: [{ ...base, eventos: [] }] });
    const { torneo, resumen } = unir(viejo, nuevo);
    expect(torneo.nombre).toBe("nuevo");
    expect(resumen.estructura).toBe("remoto");
    expect(torneo.partidos[0].eventos.length).toBe(1);
  });

  it("un partido que ya no existe tras un nuevo sorteo no resucita", () => {
    const viejo = nuevoTorneo({ revision: 1, partidos: [{ ...nuevoPartido("A", "B"), eventos: [punto("a", 10)] }] });
    const resorteado = nuevoTorneo({ revision: 2, partidos: [nuevoPartido("C", "D")] });
    const { torneo } = unir(viejo, resorteado);
    expect(torneo.partidos.length).toBe(1);
    expect(torneo.partidos[0].aId).toBe("C");
  });

  it("no mezcla dos torneos distintos que ya tienen contenido", () => {
    const gente = [{ id: "A", nombre: "A", club: "", rank: 0 }];
    const a = nuevoTorneo({ id: "t1", jugadores: gente });
    const b = nuevoTorneo({ id: "t2", nombre: "otro", revision: 99, jugadores: gente });
    const { torneo, resumen } = unir(a, b);
    expect(resumen.compatible).toBe(false);
    expect(torneo.nombre).toBe("Prueba");
  });

  it("una tablet recién instalada adopta el torneo que le llega", () => {
    const reciennacida = nuevoTorneo({ id: "t-nueva" });
    const delJuez = nuevoTorneo({
      id: "t-real",
      nombre: "Copa",
      revision: 4,
      jugadores: [{ id: "A", nombre: "A", club: "", rank: 0 }],
      partidos: [nuevoPartido("A", "B")],
    });
    const { torneo, resumen } = unir(reciennacida, delJuez);
    expect(resumen.compatible).toBe(true);
    expect(torneo.id).toBe("t-real");
    expect(torneo.nombre).toBe("Copa");
  });

  it("y no se deja borrar por un torneo vacío que llegue después", () => {
    const conDatos = nuevoTorneo({
      id: "t-real",
      nombre: "Copa",
      jugadores: [{ id: "A", nombre: "A", club: "", rank: 0 }],
      partidos: [nuevoPartido("A", "B")],
    });
    const vacio = nuevoTorneo({ id: "t-otra", revision: 999 });
    const { torneo, resumen } = unir(conDatos, vacio);
    expect(resumen.compatible).toBe(true);
    expect(torneo.nombre).toBe("Copa");
  });

  it("el paquete del árbitro lleva solo lo suyo", () => {
    const conJuego = { ...nuevoPartido("A", "B"), eventos: [punto("a", 10)] };
    const sinJuego = nuevoPartido("C", "D");
    const paq = paqueteDe(nuevoTorneo({ partidos: [conJuego, sinJuego] }), "tablet-1");
    expect(paq.partidos.length).toBe(1);
    expect(paq.partidos[0].id).toBe(conJuego.id);
  });

  it("aplicar el mismo paquete dos veces no cambia nada", () => {
    const p = nuevoPartido("A", "B");
    const enElJuez = nuevoTorneo({ partidos: [{ ...p, eventos: [] }] });
    const enLaTablet = nuevoTorneo({ partidos: [{ ...p, eventos: [punto("a", 10), punto("b", 20)] }] });
    const paq = paqueteDe(enLaTablet, "tablet-1");
    expect(aplicarPaquete(enElJuez, paq)).toBe(2);
    expect(aplicarPaquete(enElJuez, paq)).toBe(0);
    expect(enElJuez.partidos[0].eventos.length).toBe(2);
  });

  it("el marcador es el mismo en las dos copias tras sincronizar", () => {
    const p = nuevoPartido("A", "B");
    jugarSet(p, 11, 7);
    const tablet = nuevoTorneo({ partidos: [p] });
    const juez = nuevoTorneo({ partidos: [{ ...p, eventos: [] }] });
    aplicarPaquete(juez, paqueteDe(tablet, "tablet-1"));
    expect(reducir(juez.partidos[0], 2).sets).toEqual(reducir(tablet.partidos[0], 2).sets);
  });

  it("dos árbitros que sincronizan en desorden llegan al mismo marcador", () => {
    const p = nuevoPartido("A", "B");
    jugarSet(p, 11, 9);
    const mitad = Math.floor(p.eventos.length / 2);
    const uno = nuevoTorneo({ partidos: [{ ...p, eventos: p.eventos.slice(0, mitad) }] });
    const dos = nuevoTorneo({ partidos: [{ ...p, eventos: p.eventos.slice(mitad) }] });
    const izq = unir(uno, dos).torneo;
    const der = unir(dos, uno).torneo;
    expect(reducir(izq.partidos[0], 2)).toEqual(reducir(der.partidos[0], 2));
    expect(reducir(izq.partidos[0], 2).sets.a).toBe(1);
  });
});

/* ---------- casos incompletos ---------- */

describe("estado de partido incompleto", () => {
  it("un partido sin rival definido no cuenta como terminado", () => {
    const p = nuevoPartido("a1", null);
    expect(partidoListo(p, 2)).toBe(false);
    expect(ganadorDe(p, 2)).toBe(null);
  });

  it("un partido recién creado está sin iniciar", () => {
    expect(reducir(nuevoPartido("A", "B"), 2).fase).toBe("sin-iniciar");
  });
});

/* ============================================================
   TIEMPO MUERTO Y TARJETAS

   Son las dos cosas que el árbitro hace en la mesa además de contar, y
   las dos tienen consecuencias sobre el marcador o sobre el partido. Se
   comprueban aquí porque el reglamento las define, no la pantalla.
   ============================================================ */

const tiempo = (lado: Lado) => otro({ t: "tiempo", lado });
const tarjeta = (lado: Lado, color: "amarilla" | "roja", puntos: 0 | 1 | 2, motivo = "") =>
  otro({ t: "tarjeta", lado, color, puntos, motivo });

describe("tiempo muerto", () => {
  it("cada lado tiene el suyo y se gasta al pedirlo", () => {
    const p = conPuntos("ab");
    expect(reducir(p, 2).tiempoGastado).toEqual({ a: false, b: false });

    p.eventos.push(tiempo("a"));
    const st = reducir(p, 2);
    expect(st.tiempoGastado).toEqual({ a: true, b: false });
    expect(st.tiempoLado).toBe("a");
    expect(st.tiempoDesde).not.toBeNull();
  });

  it("el del contrario sigue disponible", () => {
    const p = conPuntos("ab");
    p.eventos.push(tiempo("a"));
    p.eventos.push(punto("b"));
    p.eventos.push(tiempo("b"));
    expect(reducir(p, 2).tiempoGastado).toEqual({ a: true, b: true });
  });

  it("se acaba en cuanto se vuelve a jugar", () => {
    const p = conPuntos("ab");
    p.eventos.push(tiempo("a"));
    p.eventos.push(punto("a"));
    const st = reducir(p, 2);
    expect(st.tiempoDesde).toBeNull();
    expect(st.tiempoLado).toBeNull();
    // Gastado sigue gastado: se pide una vez por partido.
    expect(st.tiempoGastado.a).toBe(true);
  });

  it("no cuenta como punto ni mueve el saque", () => {
    const conTiempo = conPuntos("aabb");
    conTiempo.eventos.push(tiempo("b"));
    const sinTiempo = conPuntos("aabb");
    const x = reducir(conTiempo, 2);
    const y = reducir(sinTiempo, 2);
    expect([x.pa, x.pb, x.saca, x.jugados]).toEqual([y.pa, y.pb, y.saca, y.jugados]);
  });
});

describe("tarjetas", () => {
  it("la amarilla sola avisa y no toca el marcador", () => {
    const p = conPuntos("aab");
    p.eventos.push(tarjeta("b", "amarilla", 0, "retrasar el juego"));
    const st = reducir(p, 2);
    expect(st.pa).toBe(2);
    expect(st.pb).toBe(1);
    expect(st.tarjetas).toHaveLength(1);
    expect(st.tarjetas[0]).toMatchObject({ lado: "b", color: "amarilla", puntos: 0, motivo: "retrasar el juego" });
  });

  it("la penalización le da el punto al contrario", () => {
    const p = conPuntos("aab");
    p.eventos.push(tarjeta("b", "amarilla", 1, "segunda falta"));
    const st = reducir(p, 2);
    expect(st.pa).toBe(3);
    expect(st.pb).toBe(1);
  });

  it("dos puntos de penalización pueden cerrar el set", () => {
    const p = nuevoPartido("A", "B");
    jugarSet(p, 10, 5);
    // 10–5 con A a un punto: la penalización de dos se lo lleva.
    p.eventos.push(tarjeta("b", "amarilla", 2, "tercera falta"));
    const st = reducir(p, 2);
    expect(st.sets).toEqual({ a: 1, b: 0 });
    expect(st.historial[0]).toEqual({ a: 11, b: 5 });
  });

  it("los puntos de penalización cuentan en la tira del set", () => {
    const p = conPuntos("ab");
    p.eventos.push(tarjeta("b", "amarilla", 1, ""));
    expect(reducir(p, 2).puntosDelSet).toEqual(["a", "b", "a"]);
  });

  it("la roja descalifica y le da el partido al otro", () => {
    const p = nuevoPartido("A", "B");
    jugarSet(p, 11, 4);
    p.eventos.push(reanuda());
    jugarSet(p, 3, 11);
    p.eventos.push(reanuda());
    p.eventos.push(punto("a"));
    p.eventos.push(tarjeta("a", "roja", 0, "conducta antideportiva"));

    const st = reducir(p, 2);
    expect(st.descalificado).toBe("a");
    expect(st.terminado).toBe(true);
    expect(st.ganador).toBe("b");
    expect(st.sets).toEqual({ a: 1, b: 2 });
  });

  it("una roja al que iba ganando le quita el partido igual", () => {
    const p = nuevoPartido("A", "B");
    jugarSet(p, 11, 2);
    p.eventos.push(reanuda());
    jugarSet(p, 9, 3);
    p.eventos.push(tarjeta("a", "roja", 0, "insultos"));

    const st = reducir(p, 2);
    expect(st.ganador).toBe("b");
    expect(st.sets).toEqual({ a: 1, b: 2 });
  });

  it("el partido descalificado entra en la tabla como cualquier otro", () => {
    const p = nuevoPartido("A", "B");
    jugarSet(p, 11, 5);
    p.eventos.push(tarjeta("a", "roja", 0, "agresión"));
    p.eventos.push(valida());

    expect(ganadorDe(p, 2, true)).toBe("B");
    const m = estadisticas(["A", "B"], [p], 2, true);
    expect(m.B.pg).toBe(1);
    expect(m.A.pp).toBe(1);
    expect(m.B.sg).toBe(2);
  });

  it("deshacer una tarjeta le devuelve el punto al que lo perdió", () => {
    const p = conPuntos("aab");
    const t = tarjeta("b", "amarilla", 1, "");
    p.eventos.push(t);
    expect(reducir(p, 2).pa).toBe(3);
    p.eventos.push(anula(t.id));
    const st = reducir(p, 2);
    expect(st.pa).toBe(2);
    expect(st.tarjetas).toHaveLength(0);
  });

  it("deshacer la roja devuelve el partido a donde estaba", () => {
    const p = nuevoPartido("A", "B");
    jugarSet(p, 11, 5);
    const roja = tarjeta("a", "roja", 0, "por error");
    p.eventos.push(roja);
    expect(reducir(p, 2).terminado).toBe(true);
    p.eventos.push(anula(roja.id));
    const st = reducir(p, 2);
    expect(st.descalificado).toBeNull();
    expect(st.terminado).toBe(false);
    expect(st.sets).toEqual({ a: 1, b: 0 });
  });
});

describe("modalidad", () => {
  it("una pareja se lee con los dos nombres", () => {
    expect(nombreDe({ id: "x", nombre: "Ana Ruiz", nombre2: "Luis Paz", club: "", rank: 0 })).toBe(
      "Ana Ruiz / Luis Paz",
    );
  });

  it("en individual se lee solo el suyo", () => {
    expect(nombreDe({ id: "x", nombre: "Ana Ruiz", club: "", rank: 0 })).toBe("Ana Ruiz");
    expect(nombreDe({ id: "x", nombre: "Ana Ruiz", nombre2: "  ", club: "", rank: 0 })).toBe("Ana Ruiz");
  });

  it("sin inscripción devuelve la raya", () => {
    expect(nombreDe(null)).toBe("—");
    expect(nombreDe(undefined, "por definir")).toBe("por definir");
  });

  it("el sorteo trata a la pareja como un competidor", () => {
    const parejas: Jugador[] = Array.from({ length: 8 }, (_, i) => ({
      id: `d${i}`,
      nombre: `Uno ${i}`,
      nombre2: `Dos ${i}`,
      club: `Club ${i % 2}`,
      rank: 100 - i,
    }));
    const r = sortear(parejas, 2, { semilla: 7 });
    expect(r.grupos).toHaveLength(2);
    expect(r.grupos.flatMap((g) => g.jugadores)).toHaveLength(8);
    // Seis partidos por grupo de cuatro, como en individual.
    expect(r.partidos).toHaveLength(12);
  });
});
