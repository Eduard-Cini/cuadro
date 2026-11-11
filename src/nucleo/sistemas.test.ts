import { describe, expect, it } from "vitest";
import { podio } from "./cuadro";
import { pasos } from "./guia";
import { aplicarHandicap, aplicarReglas, puntosDe, ventajaEntre } from "./handicap";
import { mesasDestino, moverDeMesa, quitarDeMesa } from "./asignacion";
import { actividadPorAutor, autorDe, deshechosDe, mesaDondeSeJugo, quienDirigio } from "./actividad";
import { reducir, revisarParciales } from "./reglas";
import { calendarioCircular, sortear } from "./sorteo";
import { aplicarPaquete } from "./sincronizacion";
import type { Evento, Jugador, Lado, Partido, Torneo } from "./tipos";
import { envioDe } from "../almacen";

/*
 * Lo que se agregó en noviembre de 2026: todos contra todos, hándicap,
 * resultado escrito por sets (la mesa autogestionada) y siembra por el
 * orden de la lista.
 */

let n = 0;
let reloj = 1000;
const ev = (e: Record<string, unknown>, por = "arb"): Evento =>
  ({ id: `x${n++}`, ts: reloj++, por, ...e }) as unknown as Evento;
const punto = (j: Lado, por = "arb") => ev({ t: "punto", j }, por);

const jugadores = (k: number, rank: (i: number) => number = () => 0): Jugador[] =>
  Array.from({ length: k }, (_, i) => ({ id: `j${i}`, nombre: `J${i}`, club: `C${i}`, rank: rank(i) }));

const torneo = (over: Partial<Torneo> = {}): Torneo => ({
  id: "t",
  revision: 1,
  nombre: "Prueba",
  sede: "",
  modalidad: "individual",
  mesas: 2,
  formatoGrupos: 2,
  formatoFinales: 3,
  nGrupos: 1,
  clasifican: 2,
  descansoSet: 1,
  descansoJugador: 0,
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

/** Gana el lado `g` todos los sets 11-0 a punta de puntos. */
function ganar(p: Partido, g: Lado, setsPara = 2, por = "arb") {
  for (let s = 0; s < setsPara; s++) {
    if (s) p.eventos.push(ev({ t: "reanuda" }, por));
    const st = reducir(p, setsPara);
    const faltan = 11 - (g === "a" ? st.pa : st.pb);
    for (let i = 0; i < faltan; i++) p.eventos.push(punto(g, por));
  }
}

/* ---------- todos contra todos ---------- */

describe("calendario de todos contra todos", () => {
  for (const k of [2, 3, 4, 5, 6, 7, 8, 11]) {
    it(`con ${k} jugadores, cada pareja se enfrenta exactamente una vez`, () => {
      const ids = Array.from({ length: k }, (_, i) => `j${i}`);
      const rondas = calendarioCircular(ids);
      expect(rondas.length).toBe(k % 2 ? k : k - 1);

      const vistos = new Set<string>();
      for (const ronda of rondas) {
        const enJornada = new Set<string>();
        for (const [a, b] of ronda) {
          // Nadie juega dos veces en la misma jornada.
          expect(enJornada.has(a) || enJornada.has(b)).toBe(false);
          enJornada.add(a);
          enJornada.add(b);
          const llave = [a, b].sort().join("-");
          expect(vistos.has(llave)).toBe(false);
          vistos.add(llave);
        }
        expect(ronda.length).toBe(Math.floor(k / 2));
      }
      expect(vistos.size).toBe((k * (k - 1)) / 2);
    });
  }

  it("con número impar, cada quien descansa exactamente una jornada", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const descansos = new Map(ids.map((x) => [x, 0]));
    for (const ronda of calendarioCircular(ids)) {
      for (const x of ids) if (!ronda.some(([a, b]) => a === x || b === x)) descansos.set(x, descansos.get(x)! + 1);
    }
    expect([...descansos.values()]).toEqual([1, 1, 1, 1, 1]);
  });

  it("el sorteo por jornadas arma un solo grupo con la jornada en cada partido", () => {
    const r = sortear(jugadores(6), 1, { semilla: 7, jornadas: true });
    expect(r.grupos).toHaveLength(1);
    expect(r.grupos[0].nombre).toBe("Todos contra todos");
    expect(r.partidos).toHaveLength(15);
    expect(r.partidos.every((p) => p.jornada && p.jornada >= 1 && p.jornada <= 5)).toBe(true);
    // El rol de juego sigue las jornadas.
    const js = r.partidos.map((p) => p.jornada!);
    expect([...js].sort((a, b) => a - b)).toEqual(js);
  });

  it("no hay podio hasta que se juegan todos, y después lo da la tabla", () => {
    const r = sortear(jugadores(3), 1, { jornadas: true });
    const t = torneo({ sistema: "todos", jugadores: jugadores(3), grupos: r.grupos, partidos: r.partidos });
    expect(podio(t)).toBe(null);

    // j0 gana todo, j1 le gana a j2.
    for (const p of t.partidos) {
      const gana = [p.aId, p.bId].includes("j0") ? "j0" : "j1";
      ganar(p, p.aId === gana ? "a" : "b");
    }
    const r3 = podio(t)!;
    expect(r3.campeon).toBe("j0");
    expect(r3.subcampeon).toBe("j1");
    expect(r3.terceros).toEqual(["j2"]);
  });

  it("la guía no pide eliminatoria", () => {
    const t = torneo({ sistema: "todos", jugadores: jugadores(4) });
    const ids = pasos(t, false, 0).map((x) => x.id);
    expect(ids).not.toContain("cuadro");
    expect(pasos(t, false, 0).find((x) => x.id === "sorteo")!.titulo).toBe("Arma el calendario");
  });
});

/* ---------- siembra sin ranking ---------- */

describe("siembra por el orden de la lista", () => {
  it("sin ranking, los primeros de la lista son las cabezas de grupo", () => {
    const js = jugadores(8);
    const r = sortear(js, 4, { siembraManual: true });
    const cabezas = r.grupos.map((g) => g.jugadores[0]).sort();
    expect(cabezas).toEqual(["j0", "j1", "j2", "j3"]);
  });

  it("manda sobre el ranking cuando el juez la pide", () => {
    const js = jugadores(4, (i) => 1000 + i * 100); // j3 es el de más ranking
    const porRanking = sortear(js, 2, {});
    const manual = sortear(js, 2, { siembraManual: true });
    expect(porRanking.grupos.map((g) => g.jugadores[0]).sort()).toEqual(["j2", "j3"]);
    expect(manual.grupos.map((g) => g.jugadores[0]).sort()).toEqual(["j0", "j1"]);
    expect(manual.acta.join(" ")).toContain("orden que fijó el juez");
  });
});

/* ---------- hándicap ---------- */

describe("hándicap", () => {
  const base = () =>
    torneo({
      handicap: { activo: true, escalon: 100, tope: 5 },
      jugadores: [
        { id: "fuerte", nombre: "F", club: "", rank: 1600 },
        { id: "debil", nombre: "D", club: "", rank: 1320 },
        { id: "nuevo", nombre: "N", club: "", rank: 0 },
        { id: "lejos", nombre: "L", club: "", rank: 400 },
      ],
    });

  it("un punto por escalón de diferencia, para el de menor ranking", () => {
    expect(ventajaEntre(base(), "fuerte", "debil")).toEqual({ lado: "b", puntos: 2 });
    expect(ventajaEntre(base(), "debil", "fuerte")).toEqual({ lado: "a", puntos: 2 });
  });

  it("no pasa del tope y sin ranking no hay ventaja", () => {
    expect(ventajaEntre(base(), "fuerte", "lejos")).toEqual({ lado: "b", puntos: 5 });
    expect(ventajaEntre(base(), "fuerte", "nuevo")).toBeUndefined();
    expect(ventajaEntre({ ...base(), handicap: { activo: false, escalon: 100, tope: 5 } }, "fuerte", "debil")).toBeUndefined();
  });

  it("cada set empieza con la ventaja y se gana a 11", () => {
    const p: Partido = { id: "h", etapa: "grupo", aId: "fuerte", bId: "debil", mesa: 1, orden: 0, eventos: [], ventaja: { lado: "b", puntos: 3 } };
    expect(reducir(p, 2)).toMatchObject({ pa: 0, pb: 3 });
    for (let i = 0; i < 8; i++) p.eventos.push(punto("b"));
    const st = reducir(p, 2);
    expect(st.sets).toEqual({ a: 0, b: 1 });
    expect(st.historial).toEqual([{ a: 0, b: 11 }]);
    // El set siguiente vuelve a empezar 0–3.
    p.eventos.push(ev({ t: "reanuda" }));
    expect(reducir(p, 2)).toMatchObject({ pa: 0, pb: 3 });
  });

  it("el saque cambia cada dos puntos jugados, sin contar la ventaja", () => {
    const p: Partido = { id: "s", etapa: "grupo", aId: "a", bId: "b", mesa: 1, orden: 0, eventos: [], ventaja: { lado: "a", puntos: 3 } };
    expect(reducir(p, 2).saca).toBe("a");
    p.eventos.push(punto("b"));
    expect(reducir(p, 2).saca).toBe("a");
    p.eventos.push(punto("b"));
    expect(reducir(p, 2).saca).toBe("b");
  });

  it("nunca deja ganar un set sin jugarlo", () => {
    const p: Partido = { id: "m", etapa: "grupo", aId: "a", bId: "b", mesa: 1, orden: 0, eventos: [], ventaja: { lado: "a", puntos: 15 } };
    expect(reducir(p, 2).pa).toBe(9);
  });

  it("se aplica a los partidos sin empezar y respeta los empezados", () => {
    const t = base();
    t.partidos = [
      { id: "1", etapa: "grupo", aId: "fuerte", bId: "debil", mesa: 0, orden: 0, eventos: [] },
      { id: "2", etapa: "grupo", aId: "fuerte", bId: "lejos", mesa: 0, orden: 1, eventos: [punto("a")] },
    ];
    aplicarHandicap(t);
    expect(t.partidos[0].ventaja).toEqual({ lado: "b", puntos: 2 });
    expect(t.partidos[1].ventaja).toBeUndefined();
    // Si se apaga, se quita de lo que no ha empezado.
    t.handicap = { activo: false, escalon: 100, tope: 5 };
    aplicarHandicap(t);
    expect(t.partidos[0].ventaja).toBeUndefined();
  });
});

/* ---------- resultado por sets ---------- */

describe("resultado escrito por sets", () => {
  const partido = (): Partido => ({ id: "r", etapa: "grupo", aId: "a", bId: "b", mesa: 0, orden: 0, eventos: [] });

  it("cierra el partido y espera al juez", () => {
    const p = partido();
    p.eventos.push(ev({ t: "resultado", sets: [{ a: 11, b: 7 }, { a: 9, b: 11 }, { a: 11, b: 5 }], nota: "" }, "autogestion:d1:Luis"));
    const st = reducir(p, 2);
    expect(st.sets).toEqual({ a: 2, b: 1 });
    expect(st.ganador).toBe("a");
    expect(st.fase).toBe("por-validar");
    expect(st.porSets?.por).toBe("autogestion:d1:Luis");
    p.eventos.push(ev({ t: "valida" }, "juez"));
    expect(reducir(p, 2).fase).toBe("validado");
  });

  it("la corrección del juez manda sobre lo escrito", () => {
    const p = partido();
    p.eventos.push(ev({ t: "resultado", sets: [{ a: 11, b: 7 }, { a: 11, b: 9 }], nota: "" }));
    p.eventos.push(ev({ t: "corrige", sets: [{ a: 7, b: 11 }, { a: 9, b: 11 }], nota: "al revés" }, "juez"));
    const st = reducir(p, 2);
    expect(st.ganador).toBe("b");
    expect(st.porSets).toBe(null);
    expect(st.corregido).toBe(true);
  });

  it("revisa los parciales antes de guardarlos", () => {
    expect(revisarParciales([{ a: 11, b: 7 }, { a: 11, b: 9 }], 2)).toBe(null);
    expect(revisarParciales([{ a: 12, b: 10 }, { a: 13, b: 11 }], 2)).toBe(null);
    expect(revisarParciales([{ a: 11, b: 10 }, { a: 11, b: 3 }], 2)).toMatch(/set 1/);
    expect(revisarParciales([{ a: 15, b: 10 }, { a: 11, b: 3 }], 2)).toMatch(/dos exactos/);
    expect(revisarParciales([{ a: 11, b: 3 }], 2)).toMatch(/Faltan sets/);
    expect(revisarParciales([{ a: 11, b: 3 }, { a: 11, b: 3 }, { a: 3, b: 11 }], 2)).toMatch(/ya estaba decidido/);
    expect(revisarParciales([], 2)).toMatch(/Falta/);
  });
});

/* ---------- mesa autogestionada ---------- */

describe("envío de una mesa autogestionada", () => {
  it("lleva solo lo anotado en ese aparato y aplicarlo dos veces no duplica", () => {
    const yo = "autogestion:d1:Ana";
    const t = torneo({
      partidos: [
        { id: "a", etapa: "grupo", aId: "x", bId: "y", mesa: 0, orden: 0, eventos: [punto("a", "juez")] },
        { id: "b", etapa: "grupo", aId: "x", bId: "z", mesa: 0, orden: 1, eventos: [] },
      ],
    });
    t.partidos[1].eventos.push(ev({ t: "resultado", sets: [{ a: 11, b: 2 }, { a: 11, b: 4 }], nota: "" }, yo));
    // Cambiar de nombre a media tarde no deja nada fuera: manda el aparato.
    t.partidos[0].eventos.push(punto("b", "autogestion:d1:Ana María"));

    const envio = envioDe(t, "autogestion:d1", "Ana");
    expect(envio.partidos.map((x) => x.id).sort()).toEqual(["a", "b"]);
    expect(envio.partidos.find((x) => x.id === "a")!.eventos).toHaveLength(1);

    const juez = torneo({
      partidos: [
        { id: "a", etapa: "grupo", aId: "x", bId: "y", mesa: 0, orden: 0, eventos: [t.partidos[0].eventos[0]] },
        { id: "b", etapa: "grupo", aId: "x", bId: "z", mesa: 0, orden: 1, eventos: [] },
      ],
    });
    const paq = { torneoId: envio.torneoId, revision: 1, desde: envio.desde, partidos: envio.partidos };
    expect(aplicarPaquete(juez, paq)).toBe(2);
    expect(aplicarPaquete(juez, paq)).toBe(0);
    expect(reducir(juez.partidos[1], 2).fase).toBe("por-validar");
  });
});

/* ---------- hándicap por lugar en la lista ---------- */

describe("hándicap por lugar, sin ranking", () => {
  const base = () =>
    torneo({
      siembraManual: true,
      handicap: { activo: true, base: "lugar", escalon: 100, porLugar: 2, tope: 7 },
      jugadores: jugadores(5), // j0 es el 1, j4 es el 5; nadie tiene ranking
    });

  it("da los puntos por cada lugar de diferencia al que está más abajo", () => {
    expect(ventajaEntre(base(), "j0", "j1")).toEqual({ lado: "b", puntos: 2 });
    expect(ventajaEntre(base(), "j3", "j1")).toEqual({ lado: "a", puntos: 4 });
  });

  it("respeta el tope", () => {
    expect(ventajaEntre(base(), "j0", "j4")).toEqual({ lado: "b", puntos: 7 });
  });

  it("sigue el orden que fijó el juez, no el de carga", () => {
    const t = base();
    t.jugadores = [t.jugadores[4], ...t.jugadores.slice(0, 4)]; // j4 sube al primer lugar
    expect(ventajaEntre(t, "j4", "j0")).toEqual({ lado: "b", puntos: 2 });
  });

  it("sin siembra manual, el orden es el del ranking", () => {
    const t = torneo({
      handicap: { activo: true, base: "lugar", escalon: 100, porLugar: 1, tope: 7 },
      jugadores: jugadores(3, (i) => 1000 + i * 100), // j2 es el mejor
    });
    expect(ventajaEntre(t, "j0", "j2")).toEqual({ lado: "a", puntos: 2 });
  });
});

/* ---------- formal o personalizado ---------- */

describe("reglas del torneo", () => {
  it("el formal impone el reglamento aunque la configuración diga otra cosa", () => {
    const t = torneo({
      reglamento: "formal",
      puntosSet: 21,
      descansoSet: 0,
      duracionTiempo: 30,
      validacionObligatoria: false,
      handicap: { activo: true, escalon: 100, tope: 5 },
      jugadores: [
        { id: "a", nombre: "A", club: "", rank: 1500 },
        { id: "b", nombre: "B", club: "", rank: 1000 },
      ],
      partidos: [{ id: "p", etapa: "grupo", aId: "a", bId: "b", mesa: 0, orden: 0, eventos: [] }],
    });
    aplicarReglas(t);
    expect(t.puntosSet).toBe(11);
    expect(t.descansoSet).toBe(1);
    expect(t.duracionTiempo).toBe(60);
    expect(t.validacionObligatoria).toBe(true);
    expect(t.handicap?.activo).toBe(false);
    expect(t.partidos[0].meta).toBeUndefined();
    expect(t.partidos[0].ventaja).toBeUndefined();
  });

  it("el personalizado juega a los puntos que se eligieron, solo en lo que no empieza", () => {
    const t = torneo({
      puntosSet: 21,
      partidos: [
        { id: "nuevo", etapa: "grupo", aId: "a", bId: "b", mesa: 0, orden: 0, eventos: [] },
        { id: "empezado", etapa: "grupo", aId: "a", bId: "c", mesa: 0, orden: 1, eventos: [punto("a")] },
      ],
    });
    aplicarReglas(t);
    expect(puntosDe(t)).toBe(21);
    expect(t.partidos[0].meta).toBe(21);
    expect(t.partidos[1].meta).toBeUndefined();
  });

  it("un set a 21 no se cierra con 11", () => {
    const p: Partido = { id: "m", etapa: "grupo", aId: "a", bId: "b", mesa: 0, orden: 0, eventos: [], meta: 21 };
    for (let i = 0; i < 11; i++) p.eventos.push(punto("a"));
    expect(reducir(p, 2)).toMatchObject({ pa: 11, sets: { a: 0, b: 0 } });
    for (let i = 0; i < 10; i++) p.eventos.push(punto("a"));
    expect(reducir(p, 2).sets).toEqual({ a: 1, b: 0 });
    expect(revisarParciales([{ a: 21, b: 15 }, { a: 21, b: 19 }], 2, 21)).toBe(null);
    expect(revisarParciales([{ a: 11, b: 5 }, { a: 11, b: 3 }], 2, 21)).toMatch(/llegar a 21/);
  });
});

/* ---------- mover partidos entre mesas ---------- */

describe("mover un partido de mesa", () => {
  const base = () =>
    torneo({
      mesas: 3,
      arbitros: [
        { id: "emma", nombre: "Emma", mesa: 1 },
        { id: "luis", nombre: "Luis", mesa: 2 },
      ],
      partidos: [
        { id: "p1", etapa: "grupo", aId: "a", bId: "b", mesa: 1, orden: 0, eventos: [] },
        { id: "p2", etapa: "grupo", aId: "c", bId: "d", mesa: 2, orden: 1, eventos: [] },
        { id: "p3", etapa: "grupo", aId: "e", bId: "f", mesa: 0, orden: 2, eventos: [] },
      ],
    });

  it("a una mesa libre, y el árbitro pasa a ser el de esa mesa", () => {
    const t = base();
    expect(mesasDestino(t, "p2")).toEqual([1, 3]);
    expect(moverDeMesa(t, "p2", 3)).toBe(true);
    expect(t.partidos[1]).toMatchObject({ mesa: 3, arbitroId: undefined });
  });

  it("a una ocupada sin empezar, se intercambian", () => {
    const t = base();
    expect(moverDeMesa(t, "p2", 1)).toBe(true);
    expect(t.partidos[1]).toMatchObject({ mesa: 1, arbitroId: "emma" });
    expect(t.partidos[0]).toMatchObject({ mesa: 2, arbitroId: "luis" });
  });

  it("uno empezado no desplaza a otro ni vuelve a la cola", () => {
    const t = base();
    t.partidos[1].eventos.push(punto("a"));
    expect(mesasDestino(t, "p2")).toEqual([3]);
    expect(moverDeMesa(t, "p2", 1)).toBe(false);
    expect(quitarDeMesa(t, "p2")).toBe(false);
  });

  it("uno sin empezar vuelve a la cola", () => {
    const t = base();
    expect(quitarDeMesa(t, "p1")).toBe(true);
    expect(t.partidos[0].mesa).toBe(0);
  });
});

/* ---------- lo que hizo cada quien, para el acta ---------- */

describe("actividad leída del registro", () => {
  const conArbitros = (partidos: Partido[]) =>
    torneo({
      arbitros: [
        { id: "emma", nombre: "Emma", mesa: 1 },
        { id: "rafa", nombre: "Rafa", mesa: 2 },
        { id: "sole", nombre: "Sole", mesa: 3 },
      ],
      partidos,
    });

  it("el árbitro sale de quién anotó, aunque al validar se haya liberado la mesa", () => {
    const p: Partido = { id: "x", etapa: "grupo", aId: "a", bId: "b", mesa: 0, orden: 0, eventos: [] };
    ganar(p, "a", 2, "rafa");
    p.eventos.push(ev({ t: "valida" }, "juez"));
    const t = conArbitros([p]);
    expect(quienDirigio(t, p)?.nombre).toBe("Rafa");
    expect(mesaDondeSeJugo(t, p)).toBe(2);
    p.jugadaEn = 3;
    expect(mesaDondeSeJugo(t, p)).toBe(3);
  });

  it("cuenta partidos, puntos y deshechos por árbitro, y lista a los que no dirigieron", () => {
    const p: Partido = { id: "y", etapa: "grupo", aId: "a", bId: "b", mesa: 0, orden: 0, eventos: [] };
    const malo = punto("b", "emma");
    p.eventos.push(punto("a", "emma"), malo, ev({ t: "anula", ref: malo.id }, "emma"));
    ganar(p, "a", 2, "emma");
    const filas = actividadPorAutor(conArbitros([p]));
    const emma = filas.find((f) => f.autor.nombre === "Emma")!;
    expect(emma).toMatchObject({ partidos: 1, deshechos: 1 });
    expect(emma.puntos).toBe(2 + 21);
    expect(filas.map((f) => f.autor.nombre)).toEqual(["Emma", "Rafa", "Sole"]);
  });

  it("dice qué se deshizo, de quién era el punto y cómo iba el partido", () => {
    const p: Partido = { id: "z", etapa: "grupo", aId: "a", bId: "b", mesa: 0, orden: 0, eventos: [] };
    for (let i = 0; i < 7; i++) p.eventos.push(punto("a", "rafa"));
    for (let i = 0; i < 4; i++) p.eventos.push(punto("b", "rafa"));
    const malo = punto("b", "rafa");
    p.eventos.push(malo, ev({ t: "anula", ref: malo.id }, "rafa"));
    const [d] = deshechosDe(conArbitros([p]), p);
    expect(d).toMatchObject({ que: "punto", lado: "b", set: 1, marcador: { a: 7, b: 5 }, por: "rafa" });
    expect(d.deshecho).toBeGreaterThan(d.anotado);
  });

  it("un punto que cerró un set se describe con el marcador de ese set", () => {
    const p: Partido = { id: "w", etapa: "grupo", aId: "a", bId: "b", mesa: 0, orden: 0, eventos: [] };
    for (let i = 0; i < 10; i++) p.eventos.push(punto("a", "rafa"));
    const ultimo = punto("a", "rafa");
    p.eventos.push(ultimo, ev({ t: "anula", ref: ultimo.id }, "rafa"));
    const [d] = deshechosDe(conArbitros([p]), p);
    expect(d).toMatchObject({ set: 1, marcador: { a: 11, b: 0 } });
  });

  it("nombra a la mesa de control, a una mesa autogestionada y a una tablet sin alta", () => {
    const t = conArbitros([]);
    expect(autorDe(t, "juez").nombre).toBe("Mesa de control");
    expect(autorDe(t, "autogestion:d1:Luis").nombre).toBe("Mesa autogestionada · Luis");
    expect(autorDe(t, "d-abc123").tipo).toBe("aparato");
  });
});
