import { describe, expect, it } from "vitest";
import { sugerirAsignacion } from "./asignacion";

import type { Partido, Torneo } from "./tipos";

/** El caso que reportó el usuario: mesas libres y nada que mandar. */
let c = 0;
let reloj = Date.now() - 60 * 60 * 1000;
const np = (a: string, b: string): Partido =>
  ({ id: `p${c++}`, etapa: "grupo", aId: a, bId: b, mesa: 0, orden: c, eventos: [] });
const pt = (j: "a" | "b") => ({ id: `e${c++}`, t: "punto" as const, j, ts: (reloj += 20_000), por: "x" });

function jugado(a: string, b: string): Partido {
  const p = np(a, b);
  for (let s = 0; s < 2; s++) for (let i = 0; i < 11; i++) p.eventos.push(pt("a"));
  return p;
}

const torneo = (partidos: Partido[]): Torneo => ({
  id: "t", revision: 1, nombre: "", sede: "", mesas: 3, formatoGrupos: 2, formatoFinales: 3,
  nGrupos: 2, clasifican: 2, descansoSet: 1, descansoJugador: 10, duracionSupuesta: 20,
  modalidad: "individual", duracionTiempo: 60,
  validacionObligatoria: false, configurado: true, modoGuiado: false, pinJuez: "", semillaSorteo: 0,
  actaSorteo: [], jugadores: ["A","B","C","D","E","F"].map((x) => ({ id: x, nombre: x, club: "", rank: 0 })),
  arbitros: [1, 2, 3].map((m) => ({ id: `r${m}`, nombre: `R${m}`, mesa: m })),
  grupos: [], partidos, relajaciones: [],
});

describe("la cola con las mesas libres", () => {
  it("propone aunque todos acaben de jugar: es el caso de después de cada ronda", () => {
    // Tres partidos recién terminados; los seis jugadores acaban de salir.
    const t = torneo([jugado("A", "B"), jugado("C", "D"), jugado("E", "F"), np("A", "C"), np("B", "D"), np("E", "A")]);
    const pr = sugerirAsignacion(t, reloj + 60_000);
    expect(pr.asignaciones.length).toBeGreaterThan(0);
    expect(pr.ociosas.length).toBe(3 - pr.asignaciones.length);
  });

  it("y avisa de a quién le falta descanso en vez de esconder el partido", () => {
    const t = torneo([jugado("A", "B"), np("A", "C")]);
    const pr = sugerirAsignacion(t, reloj + 60_000);
    expect(pr.asignaciones.length).toBe(1);
    expect(pr.asignaciones[0].motivo).toMatch(/faltan \d+ min de descanso/);
  });

  it("un partido cuyos jugadores no han jugado nunca no arrastra descanso", () => {
    const t = torneo([jugado("A", "B"), np("E", "F")]);
    const pr = sugerirAsignacion(t, reloj + 60_000);
    const elegido = t.partidos.find((p) => p.id === pr.asignaciones[0].partidoId)!;
    expect([elegido.aId, elegido.bId]).toEqual(["E", "F"]);
    expect(pr.asignaciones[0].motivo).not.toContain("descanso");
  });
});
