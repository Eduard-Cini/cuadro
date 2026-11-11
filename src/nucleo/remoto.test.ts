import { describe, expect, it } from "vitest";
import { armarCuadro, propagar } from "./cuadro";
import { ganadorDe, reducir } from "./reglas";
import {
  aBase32,
  buscarResultados,
  codificarPartido,
  codificarResultado,
  deBase32,
  enlaceDe,
  leerPartido,
  mensajeResultado,
  partidoRemoto,
  registroDesdeCaptura,
  revisarResultado,
  revisarResultados,
  textoDeEnlaces,
} from "./remoto";
import type { PartidoRemoto, Sets } from "./remoto";
import { aplicarPaquete } from "./sincronizacion";
import type { Evento, Lado, Partido, Torneo } from "./tipos";

/*
 * Torneo a distancia: el partido sale en un enlace y el resultado vuelve
 * en un mensaje de WhatsApp. Lo que se prueba aquí es lo que puede fallar
 * en el camino: acentos, mensajes mochos, códigos repetidos, resultados de
 * otro torneo o de un sorteo que ya se rehízo.
 */

const torneo = (over: Partial<Torneo> = {}): Torneo => ({
  id: "t-prueba",
  revision: 1,
  nombre: "Torneo de Otoño",
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
  validacionObligatoria: true,
  configurado: true,
  modoGuiado: false,
  pinJuez: "",
  semillaSorteo: 0,
  actaSorteo: [],
  jugadores: [
    { id: "j1", nombre: "Begoña Muñoz", club: "", rank: 0 },
    { id: "j2", nombre: "José Ángel Núñez", club: "", rank: 0 },
    { id: "j3", nombre: "Lucía", club: "", rank: 0 },
  ],
  arbitros: [],
  grupos: [{ id: "g1", nombre: "Grupo A", jugadores: ["j1", "j2", "j3"] }],
  partidos: [
    { id: "p1", etapa: "grupo", grupoId: "g1", aId: "j1", bId: "j2", mesa: 0, orden: 0, eventos: [] },
    { id: "p2", etapa: "grupo", grupoId: "g1", aId: "j1", bId: "j3", mesa: 0, orden: 1, eventos: [] },
  ],
  relajaciones: [],
  ...over,
});

const ORIGEN = "https://ejemplo.github.io/cuadro/";
const TRES_UNO: Sets = [
  { a: 11, b: 7 },
  { a: 9, b: 11 },
  { a: 11, b: 5 },
];

let n = 0;
const punto = (j: Lado): Evento => ({ id: `e${n++}`, t: "punto", j, ts: 1000 + n, por: "remoto" });

describe("base 32", () => {
  it("ida y vuelta con bytes de todas las longitudes", () => {
    for (let k = 0; k < 40; k++) {
      const bytes = Uint8Array.from({ length: k }, (_, i) => (i * 37 + k * 11) & 255);
      expect([...deBase32(aBase32(bytes))!]).toEqual([...bytes]);
    }
  });

  it("solo usa letras y números que WhatsApp no convierte en formato", () => {
    const s = aBase32(Uint8Array.from({ length: 200 }, (_, i) => i));
    expect(s).toMatch(/^[0-9a-hjkmnp-tv-z]+$/);
  });

  it("rechaza caracteres fuera del alfabeto", () => {
    expect(deBase32("abc_def")).toBeNull();
    expect(deBase32("hola")).toBeNull(); // la «o» y la «l» no son del alfabeto
  });
});

describe("enlace del partido", () => {
  it("lleva nombres con acentos y eñes sin perder nada", () => {
    const t = torneo();
    const pr = partidoRemoto(t, t.partidos[0])!;
    const leido = leerPartido(codificarPartido(pr));
    expect(leido).toEqual(pr);
    expect(leido!.a.nombre).toBe("Begoña Muñoz");
    expect(leido!.b.nombre).toBe("José Ángel Núñez");
    expect(leido!.etapa).toBe("Grupo A");
  });

  it("lleva las reglas del partido: sets, puntos por set, hándicap y descanso", () => {
    const t = torneo({ formatoGrupos: 3, descansoSet: 0 });
    t.partidos[0].meta = 21;
    t.partidos[0].ventaja = { lado: "b", puntos: 4 };
    const leido = leerPartido(codificarPartido(partidoRemoto(t, t.partidos[0])!))!;
    expect(leido.setsPara).toBe(3);
    expect(leido.meta).toBe(21);
    expect(leido.ventaja).toEqual({ lado: "b", puntos: 4 });
    expect(leido.descanso).toBe(0);
  });

  it("un partido sin rival todavía no tiene enlace", () => {
    const t = torneo();
    expect(partidoRemoto(t, { ...t.partidos[0], bId: null })).toBeNull();
  });

  it("un enlace mocho o con una letra cambiada no se lee", () => {
    const t = torneo();
    const codigo = codificarPartido(partidoRemoto(t, t.partidos[0])!);
    expect(leerPartido(codigo.slice(0, -1))).toBeNull();
    expect(leerPartido(codigo.slice(0, Math.floor(codigo.length / 2)))).toBeNull();
    const i = 10;
    const otra = codigo[i] === "a" ? "b" : "a";
    expect(leerPartido(codigo.slice(0, i) + otra + codigo.slice(i + 1))).toBeNull();
    expect(leerPartido("")).toBeNull();
  });

  it("se lee igual aunque llegue en mayúsculas o con espacios alrededor", () => {
    const t = torneo();
    const codigo = codificarPartido(partidoRemoto(t, t.partidos[0])!);
    expect(leerPartido(`  ${codigo.toUpperCase()} `)).not.toBeNull();
  });

  it("cabe cómodo en un mensaje", () => {
    const t = torneo();
    expect(enlaceDe(ORIGEN, partidoRemoto(t, t.partidos[0])!).length).toBeLessThan(400);
  });

  it("el texto para el grupo trae un enlace por partido, agrupados por etapa", () => {
    const t = torneo();
    const texto = textoDeEnlaces(t, t.partidos, ORIGEN);
    expect(texto.match(/#jugar=/g)).toHaveLength(2);
    expect(texto.match(/^Grupo A$/gm)).toHaveLength(1);
    expect(texto).toContain("Begoña Muñoz vs José Ángel Núñez");
  });
});

/** Lo que haría un jugador: abre el enlace, juega y manda el mensaje. */
function mensajeDe(t: Torneo, p: Partido, sets: Sets, ts = 1_700_000_000_000): { pr: PartidoRemoto; msg: string } {
  const pr = leerPartido(codificarPartido(partidoRemoto(t, p)!))!;
  return { pr, msg: mensajeResultado(pr, sets, ts) };
}

describe("mensaje de resultado", () => {
  it("se lee el resultado dentro del texto que copia WhatsApp", () => {
    const t = torneo();
    const { msg } = mensajeDe(t, t.partidos[0], TRES_UNO);
    expect(msg).toContain("Begoña Muñoz 2-1 José Ángel Núñez");
    const pegado = `[11/11/26, 10:05] Begoña: ${msg}\n[11/11/26, 10:06] José: Gracias`;
    const { resultados, dañados } = buscarResultados(pegado);
    expect(dañados).toBe(0);
    expect(resultados).toHaveLength(1);
    expect(resultados[0].sets).toEqual(TRES_UNO);
    expect(resultados[0].partidoId).toBe("p1");
    expect(resultados[0].ts).toBe(1_700_000_000_000);
  });

  it("encuentra varios mensajes pegados juntos y no cuenta dos veces el mismo", () => {
    const t = torneo();
    const uno = mensajeDe(t, t.partidos[0], TRES_UNO).msg;
    const dos = mensajeDe(t, t.partidos[1], [
      { a: 3, b: 11 },
      { a: 8, b: 11 },
    ]).msg;
    const { resultados } = buscarResultados(`${uno}\n${dos}\n${uno}`);
    expect(resultados.map((r) => r.partidoId)).toEqual(["p1", "p2"]);
  });

  it("un código mocho se cuenta como dañado y no se registra", () => {
    const t = torneo();
    const { msg } = mensajeDe(t, t.partidos[0], TRES_UNO);
    const { resultados, dañados } = buscarResultados(msg.slice(0, -3));
    expect(resultados).toHaveLength(0);
    expect(dañados).toBe(1);
  });

  it("un texto sin códigos no encuentra nada", () => {
    expect(buscarResultados("Ana le ganó a Luis 3-1")).toEqual({ resultados: [], dañados: 0 });
  });
});

describe("registro en la mesa de control", () => {
  const revisar = (t: Torneo, msg: string) => revisarResultado(t, buscarResultados(msg).resultados[0], "juez");

  it("un resultado bueno entra registrado y aceptado", () => {
    const t = torneo();
    const rev = revisar(t, mensajeDe(t, t.partidos[0], TRES_UNO).msg);
    expect(rev.tipo).toBe("nuevo");
    if (rev.tipo !== "nuevo") return;
    t.partidos[0].eventos.push(...rev.eventos);
    const st = reducir(t.partidos[0], 2);
    expect(st.fase).toBe("validado");
    expect(st.historial).toEqual(TRES_UNO);
    expect(st.ganador).toBe("a");
  });

  it("pegar el mismo mensaje otra vez no duplica nada", () => {
    const t = torneo();
    const { msg } = mensajeDe(t, t.partidos[0], TRES_UNO);
    const rev = revisar(t, msg);
    if (rev.tipo !== "nuevo") throw new Error("debía entrar");
    t.partidos[0].eventos.push(...rev.eventos);
    expect(revisar(t, msg).tipo).toBe("repetido");
    // Y aunque los eventos llegaran dos veces por otro camino, se unen.
    const paq = { torneoId: t.id, revision: 1, desde: "x", partidos: [{ id: "p1", eventos: rev.eventos }] };
    expect(aplicarPaquete(t, paq)).toBe(0);
  });

  it("si los dos jugadores mandan el mismo resultado, el segundo sale como ya registrado", () => {
    const t = torneo();
    const de1 = mensajeDe(t, t.partidos[0], TRES_UNO, 1_700_000_000_000).msg;
    const de2 = mensajeDe(t, t.partidos[0], TRES_UNO, 1_700_000_090_000).msg;
    const revs = revisarResultados(t, buscarResultados(`${de1}\n${de2}`).resultados, "juez");
    expect(revs.map((r) => r.tipo)).toEqual(["nuevo", "repetido"]);
  });

  it("si mandan resultados distintos, el segundo no pisa al primero", () => {
    const t = torneo();
    const de1 = mensajeDe(t, t.partidos[0], TRES_UNO).msg;
    const de2 = mensajeDe(t, t.partidos[0], [
      { a: 7, b: 11 },
      { a: 11, b: 9 },
      { a: 5, b: 11 },
    ]).msg;
    const revs = revisarResultados(t, buscarResultados(`${de1}\n${de2}`).resultados, "juez");
    expect(revs[0].tipo).toBe("nuevo");
    expect(revs[1].tipo).toBe("error");
    if (revs[1].tipo === "error") expect(revs[1].motivo).toContain("ya tiene otro resultado");
  });

  it("revisar varios no toca el torneo original", () => {
    const t = torneo();
    revisarResultados(t, buscarResultados(mensajeDe(t, t.partidos[0], TRES_UNO).msg).resultados, "juez");
    expect(t.partidos[0].eventos).toHaveLength(0);
  });

  it("rechaza el resultado de otro torneo", () => {
    const t = torneo();
    const { msg } = mensajeDe(t, t.partidos[0], TRES_UNO);
    const rev = revisar({ ...t, id: "t-otro" }, msg);
    expect(rev.tipo).toBe("error");
  });

  it("rechaza el resultado de un partido que ya no existe o que ahora juegan otros", () => {
    const t = torneo();
    const { msg } = mensajeDe(t, t.partidos[0], TRES_UNO);
    expect(revisar({ ...t, partidos: [t.partidos[1]] }, msg).tipo).toBe("error");
    const rehecho = torneo();
    rehecho.partidos[0].bId = "j3";
    const rev = revisar(rehecho, msg);
    expect(rev.tipo).toBe("error");
    if (rev.tipo === "error") expect(rev.motivo).toContain("otras personas");
  });

  it("rechaza parciales imposibles aunque el código esté bien", () => {
    const t = torneo();
    const { msg } = mensajeDe(t, t.partidos[0], [
      { a: 11, b: 10 },
      { a: 11, b: 3 },
    ]);
    expect(revisar(t, msg).tipo).toBe("error");
  });

  it("valida con los puntos por set del partido, no siempre a 11", () => {
    const t = torneo();
    t.partidos[0].meta = 21;
    const a21: Sets = [
      { a: 21, b: 15 },
      { a: 23, b: 21 },
    ];
    expect(revisar(t, mensajeDe(t, t.partidos[0], a21).msg).tipo).toBe("nuevo");
    expect(revisar(t, mensajeDe(t, t.partidos[0], TRES_UNO).msg).tipo).toBe("error");
  });

  it("el resultado sale igual del marcador punto a punto, con hándicap incluido", () => {
    const t = torneo();
    t.partidos[0].ventaja = { lado: "b", puntos: 3 };
    // El tablero de los jugadores: mismo partido, eventos punto a punto.
    const pr = leerPartido(codificarPartido(partidoRemoto(t, t.partidos[0])!))!;
    const enTablero: Partido = { ...t.partidos[0], ventaja: pr.ventaja, eventos: [] };
    for (let s = 0; s < 2; s++) for (let i = 0; i < 11; i++) enTablero.eventos.push(punto("a"));
    const st = reducir(enTablero, pr.setsPara, pr.meta);
    expect(st.historial).toEqual([
      { a: 11, b: 3 },
      { a: 11, b: 3 },
    ]);
    const rev = revisar(t, mensajeResultado(pr, st.historial, Date.now()));
    expect(rev.tipo).toBe("nuevo");
  });

  it("al aceptarse, el ganador sube en la llave", () => {
    const t = torneo({ formatoFinales: 2 });
    const finales = armarCuadro(
      [
        { id: "g1", nombre: "Grupo A", jugadores: ["j1", "j2"] },
        { id: "g2", nombre: "Grupo B", jugadores: ["j3", "j4"] },
      ],
      [],
      2,
      2,
    );
    t.jugadores.push({ id: "j4", nombre: "Ramón", club: "", rank: 0 });
    t.partidos = finales;
    const semi = finales.find((p) => p.ronda === 0 && p.aId && p.bId)!;
    const rev = revisar(t, mensajeDe(t, semi, [
      { a: 4, b: 11 },
      { a: 9, b: 11 },
    ]).msg);
    if (rev.tipo !== "nuevo") throw new Error("debía entrar");
    semi.eventos.push(...rev.eventos);
    expect(ganadorDe(semi, 2, true)).toBe(semi.bId);
    propagar(t.partidos, 2, true);
    const final = t.partidos.find((p) => p.ronda === 1)!;
    expect([final.aId, final.bId]).toContain(semi.bId);
  });

  it("el código no se confunde con el de otro partido del mismo torneo", () => {
    const t = torneo();
    const pr2 = partidoRemoto(t, t.partidos[1])!;
    const codigo = codificarResultado(pr2, TRES_UNO, 1_700_000_000_000);
    expect(buscarResultados(codigo).resultados[0].partidoId).toBe("p2");
  });
});

describe("registro desde una captura", () => {
  it("entra registrado y aceptado con su nota", () => {
    const t = torneo();
    const r = registroDesdeCaptura(t, t.partidos[1], TRES_UNO, "juez", 5000);
    expect("eventos" in r).toBe(true);
    if (!("eventos" in r)) return;
    t.partidos[1].eventos.push(...r.eventos);
    const st = reducir(t.partidos[1], 2);
    expect(st.fase).toBe("validado");
    expect(st.porSets?.nota).toBe("Registrado desde una captura");
  });

  it("avisa si lo escrito no es un partido terminado", () => {
    const t = torneo();
    const r = registroDesdeCaptura(t, t.partidos[1], [{ a: 11, b: 4 }], "juez");
    expect("error" in r).toBe(true);
  });

  it("respeta los puntos por set del partido", () => {
    const t = torneo();
    t.partidos[1].meta = 15;
    const r = registroDesdeCaptura(
      t,
      t.partidos[1],
      [
        { a: 15, b: 9 },
        { a: 17, b: 15 },
      ],
      "juez",
    );
    expect("eventos" in r).toBe(true);
  });
});
