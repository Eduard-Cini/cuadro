import { describe, expect, it } from "vitest";
import { avance, pasos, siguientePaso } from "./guia";
import { sortear } from "./sorteo";
import type { Jugador, Torneo } from "./tipos";

/**
 * La guía tiene una sola obligación: no mandar a nadie a un paso que
 * todavía no puede hacer, ni dar por hecho lo que falta. Se comprueba
 * sobre torneos en distintos momentos de su vida.
 */

const nuevoTorneo = (over: Partial<Torneo> = {}): Torneo => ({
  id: "t1",
  revision: 1,
  nombre: "",
  sede: "",
  modalidad: "individual",
  mesas: 2,
  formatoGrupos: 2,
  formatoFinales: 3,
  nGrupos: 2,
  clasifican: 2,
  descansoSet: 1,
  descansoJugador: 0,
  duracionTiempo: 60,
  duracionSupuesta: 20,
  validacionObligatoria: true,
  configurado: false,
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

const gente = (n: number): Jugador[] =>
  Array.from({ length: n }, (_, i) => ({ id: `j${i}`, nombre: `J${i}`, club: "", rank: 100 - i }));

const arbitros = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `a${i}`, nombre: `A${i}`, mesa: i + 1 }));

/** Un torneo con jugadores, árbitros y sorteo hecho. */
function sorteado(): Torneo {
  const t = nuevoTorneo({ nombre: "Copa", configurado: true, jugadores: gente(8), arbitros: arbitros(2) });
  const r = sortear(t.jugadores, t.nGrupos, { semilla: 7 });
  t.grupos = r.grupos;
  t.partidos = r.partidos;
  return t;
}

describe("guía del torneo", () => {
  it("a un torneo recién creado le manda configurarlo", () => {
    const paso = siguientePaso(nuevoTorneo(), false, 0);
    expect(paso?.id).toBe("torneo");
    expect(paso?.vista).toBe("torneo");
  });

  it("configurado y sin gente, toca cargar jugadores", () => {
    const paso = siguientePaso(nuevoTorneo({ nombre: "Copa", configurado: true }), false, 0);
    expect(paso?.id).toBe("jugadores");
  });

  it("con jugadores pero sin árbitros, toca registrarlos", () => {
    const t = nuevoTorneo({ nombre: "Copa", configurado: true, jugadores: gente(8) });
    expect(siguientePaso(t, false, 0)?.id).toBe("arbitros");
  });

  it("no manda a sortear antes de tener jugadores", () => {
    const lista = pasos(nuevoTorneo({ configurado: true }), false, 0);
    expect(lista.find((x) => x.id === "sorteo")?.bloqueado).toBe(true);
  });

  it("no manda a repartir mesas antes de sortear", () => {
    const t = nuevoTorneo({ nombre: "Copa", configurado: true, jugadores: gente(8), arbitros: arbitros(2) });
    const lista = pasos(t, false, 0);
    expect(lista.find((x) => x.id === "mesas")?.bloqueado).toBe(true);
    expect(lista.find((x) => x.id === "cuadro")?.bloqueado).toBe(true);
  });

  it("sin red, el paso de dar de alta las tablets queda bloqueado y lo dice", () => {
    const t = nuevoTorneo({ nombre: "Copa", configurado: true, jugadores: gente(8), arbitros: arbitros(2) });
    const alta = pasos(t, false, 0).find((x) => x.id === "alta")!;
    expect(alta.bloqueado).toBe(true);
    expect(alta.detalle).toContain("un solo aparato");
  });

  it("en red y con árbitros, el paso siguiente es repartir la aplicación", () => {
    const t = nuevoTorneo({ nombre: "Copa", configurado: true, jugadores: gente(8), arbitros: arbitros(2) });
    expect(siguientePaso(t, true, 1)?.id).toBe("alta");
  });

  it("trabajando sin red se salta el alta y manda directo al sorteo", () => {
    const t = nuevoTorneo({ nombre: "Copa", configurado: true, jugadores: gente(8), arbitros: arbitros(2) });
    expect(siguientePaso(t, false, 0)?.id).toBe("sorteo");
  });

  it("con el sorteo hecho toca repartir las mesas", () => {
    expect(siguientePaso(sorteado(), false, 0)?.id).toBe("mesas");
  });

  it("cada paso trae instrucción y explicación, y no están vacías", () => {
    for (const paso of pasos(sorteado(), true, 3)) {
      expect(paso.queHacer.length).toBeGreaterThan(20);
      expect(paso.porQue.length).toBeGreaterThan(60);
      expect(paso.titulo.length).toBeGreaterThan(3);
    }
  });

  it("el detalle informa del estado sin que haya que abrir la pestaña", () => {
    const t = sorteado();
    const lista = pasos(t, false, 0);
    expect(lista.find((x) => x.id === "jugadores")?.detalle).toContain("8 jugadores");
    expect(lista.find((x) => x.id === "sorteo")?.detalle).toContain("2 grupos");
  });

  it("avisa cuando hay menos jugadores de los que piden los grupos", () => {
    const t = nuevoTorneo({ nombre: "Copa", configurado: true, nGrupos: 4, jugadores: gente(3) });
    expect(pasos(t, false, 0).find((x) => x.id === "jugadores")?.detalle).toContain("pocos");
  });

  it("el avance crece conforme se completan pasos", () => {
    const vacio = avance(nuevoTorneo(), false, 0);
    const medio = avance(sorteado(), false, 0);
    expect(vacio.hechos).toBe(0);
    expect(medio.hechos).toBeGreaterThan(vacio.hechos);
    expect(medio.hechos).toBeLessThan(medio.total);
  });

  it("sin red, el alta no cuenta para el total", () => {
    const sinRed = avance(nuevoTorneo(), false, 0);
    const conRed = avance(nuevoTorneo(), true, 0);
    expect(sinRed.total).toBe(conRed.total - 1);
  });

  it("no se queda encallada: siempre hay un paso o ninguno, nunca uno bloqueado", () => {
    for (const t of [nuevoTorneo(), nuevoTorneo({ configurado: true }), sorteado()]) {
      const paso = siguientePaso(t, true, 0);
      if (paso) expect(paso.bloqueado).toBe(false);
    }
  });
});
