import { describe, expect, it } from "vitest";
import { bloquesSugeridos, contarVotos, leerVotos, partirEnBloques, proponerBloques, repartirBloques, silueta, sumarVotos } from "./votacion";
import { tablaSugerida, ventajaEntre, ventajaSugerida } from "./handicap";
import type { Jugador, Torneo, Voto } from "./tipos";

const jug = (nombre: string, id = nombre): Jugador => ({ id, nombre, club: "", rank: 0 });
const lista = (...nombres: string[]) => nombres.map((n) => jug(n));
const ordenDe = (l: Jugador[], votos: Voto[]) => contarVotos(l, votos).filas.map((f) => f.id);

describe("ranking por votación", () => {
  const p = lista("p1", "p2", "p3");

  it("el ejemplo: p1: p2,p1,p3 · p2: p1,p2,p3 · p3: p2,p1,p3 da p2, p1, p3", () => {
    const { votos, avisos } = leerVotos("p1: p2,p1,p3\np2: p1,p2,p3\np3:p2,p1,p3", p);
    expect(avisos).toEqual([]);
    expect(votos).toEqual([
      { quien: "p1", orden: ["p2", "p1", "p3"] },
      { quien: "p2", orden: ["p1", "p2", "p3"] },
      { quien: "p3", orden: ["p2", "p1", "p3"] },
    ]);
    const c = contarVotos(p, votos);
    expect(c.filas.map((f) => f.id)).toEqual(["p2", "p1", "p3"]);
    // Borda con 3: el 1.º vale 3, el 2.º 2 y el 3.º 1
    expect(c.filas.map((f) => f.puntos)).toEqual([8, 7, 3]);
    expect(c.filas[0].veces).toEqual([2, 1, 0]);
    expect(c.filas[0].promedio).toBeCloseTo(4 / 3);
    expect(c.duelos.p2.p1).toBe(2);
    expect(c.duelos.p1.p2).toBe(1);
  });

  it("no depende del orden en que estaba la lista", () => {
    const votos = leerVotos("p1: p2,p1,p3\np2: p1,p2,p3\np3: p2,p1,p3", p).votos;
    expect(ordenDe(lista("p3", "p1", "p2"), votos)).toEqual(["p2", "p1", "p3"]);
  });

  it("un empate a puntos lo decide el duelo entre los empatados", () => {
    const l = lista("B", "A", "D", "C");
    const votos: Voto[] = [
      { quien: "v1", orden: ["A", "B", "C", "D"] },
      { quien: "v2", orden: ["B", "C", "A", "D"] },
      { quien: "v3", orden: ["D", "A", "B", "C"] },
    ];
    const c = contarVotos(l, votos);
    // A y B suman 9; C y D, 6. A le gana a B 2–1 y C a D 2–1.
    expect(c.filas.map((f) => [f.id, f.puntos])).toEqual([
      ["A", 9],
      ["B", 9],
      ["C", 6],
      ["D", 6],
    ]);
    expect(c.filas[0].desempate).toBe("le gana el duelo a B, 2–1");
    expect(c.filas[1].desempate).toBe("pierde el duelo con A, 1–2");
    expect(c.filas.some((f) => f.empate)).toBe(false);
  });

  it("si los duelos empatan, cuentan los primeros lugares", () => {
    // Los tres suman 8 y todos los duelos quedan 2–2. B nunca es primero.
    const votos: Voto[] = [
      { quien: "1", orden: ["A", "B", "C"] },
      { quien: "2", orden: ["A", "B", "C"] },
      { quien: "3", orden: ["C", "B", "A"] },
      { quien: "4", orden: ["C", "B", "A"] },
    ];
    const c = contarVotos(lista("B", "C", "A"), votos);
    expect(c.filas.map((f) => f.puntos)).toEqual([8, 8, 8]);
    expect(c.duelos.A.B).toBe(2);
    expect(c.duelos.B.A).toBe(2);
    // A y C, con dos primeros lugares cada uno, no se separan: manda la lista
    expect(c.filas.map((f) => f.id)).toEqual(["C", "A", "B"]);
    expect(c.filas[2].desempate).toBe("0 veces en 1.º lugar");
    expect(c.filas.map((f) => f.empate)).toEqual([true, true, false]);
  });

  it("si nada los separa, queda el orden de la lista y se marca el empate", () => {
    const votos: Voto[] = [
      { quien: "1", orden: ["A", "B"] },
      { quien: "2", orden: ["B", "A"] },
    ];
    expect(ordenDe(lista("A", "B"), votos)).toEqual(["A", "B"]);
    const c = contarVotos(lista("B", "A"), votos);
    expect(c.filas.map((f) => f.id)).toEqual(["B", "A"]);
    expect(c.filas.every((f) => f.empate)).toBe(true);
  });

  it("quien falta en un voto no recibe puntos de él", () => {
    const { votos, avisos } = leerVotos("Ana: p1, p2", p);
    expect(avisos).toEqual(["Renglón 1: al voto de Ana le falta 1 nombre; esos no reciben puntos de ese voto."]);
    const c = contarVotos(p, votos);
    expect(c.filas.map((f) => [f.id, f.puntos])).toEqual([
      ["p1", 3],
      ["p2", 2],
      ["p3", 0],
    ]);
    expect(c.filas[2].promedio).toBeNull();
  });

  it("reconoce nombres sin acentos, por una palabra, por número y con numeración", () => {
    const l = [jug("Ortega Ana", "a"), jug("Ramírez Luis", "l"), jug("Salas Pedro", "s")];
    const { votos, avisos } = leerVotos("Iris: 1. ramirez luis, 2. Ana, 3. Pedro\nTeo: 3; 1; 2\nUma: Luis > Ortega Ana > Salas", l);
    expect(avisos).toEqual([]);
    expect(votos.map((v) => v.orden)).toEqual([
      ["l", "a", "s"],
      ["s", "a", "l"],
      ["l", "a", "s"],
    ]);
  });

  it("acepta lo copiado de WhatsApp y de una hoja de cálculo", () => {
    const texto = [
      "[11/11/26, 3:20 p. m.] p1: p2, p1, p3",
      "11/11/26, 15:21 - p2: p1, p2, p3",
      "p3\tp2\tp1\tp3",
    ].join("\n");
    const { votos, avisos } = leerVotos(texto, p);
    expect(avisos).toEqual([]);
    expect(votos.map((v) => v.quien)).toEqual(["p1", "p2", "p3"]);
    expect(ordenDe(p, votos)).toEqual(["p2", "p1", "p3"]);
  });

  it("separados solo por espacios también se leen", () => {
    expect(leerVotos("p1: p2 p1 p3", p).votos[0].orden).toEqual(["p2", "p1", "p3"]);
  });

  it("avisa lo repetido, a quien vota dos veces y aparta los nombres nuevos", () => {
    const { votos, avisos, desconocidos } = leerVotos("p1: p2, p9, p2, p1, p3\np1: p3, p2, p1\nhola", p);
    expect(votos).toEqual([{ quien: "p1", orden: ["p3", "p2", "p1"] }]);
    expect(avisos).toEqual([
      "Renglón 1: p2 aparece dos veces; cuenta el lugar más alto.",
      "p1 votó dos veces: vale el último.",
      "Renglón 3: no se reconoció a nadie de la lista y se dejó fuera.",
    ]);
    expect(desconocidos).toEqual(["P9"]);
  });

  it("con nombres reales que aún no están inscritos, los propone para inscribir", () => {
    const texto = "juan: carlo, juan, david\ncarlo: juan, carlo, david\ndavid: carlo, juan, david";
    const vacia = leerVotos(texto, []);
    expect(vacia.votos).toEqual([]);
    expect(vacia.desconocidos).toEqual(["Carlo", "Juan", "David"]);
    expect(vacia.avisos).toEqual([]);

    // Ya inscritos, con mayúsculas y apellido, se reconocen por el nombre
    const l = [jug("Juan Pérez", "j"), jug("Carlo Ruiz", "c"), jug("David López", "d")];
    const r = leerVotos(texto, l);
    expect(r.desconocidos).toEqual([]);
    expect(ordenDe(l, r.votos)).toEqual(["c", "j", "d"]);
    expect(contarVotos(l, r.votos).filas.map((f) => f.puntos)).toEqual([8, 7, 3]);
  });

  it("lee un voto en varios renglones, como llega por WhatsApp", () => {
    const l = lista("Juan", "Carlo", "David");
    const texto = [
      "[11/11/26, 5:01 p. m.] Juan: 1. Carlo",
      "2. Juan",
      "3. David",
      "Carlo:",
      "Juan",
      "Carlo",
      "David",
      "",
      "David: 3. David, 1. Carlo, 2. Juan",
    ].join("\n");
    const { votos, avisos } = leerVotos(texto, l);
    expect(avisos).toEqual([]);
    expect(votos).toEqual([
      { quien: "Juan", orden: ["Carlo", "Juan", "David"] },
      { quien: "Carlo", orden: ["Juan", "Carlo", "David"] },
      { quien: "David", orden: ["Carlo", "Juan", "David"] },
    ]);
  });

  it("al pasar a la tabla, el voto nuevo de alguien reemplaza al anterior", () => {
    const tabla: Voto[] = [
      { quien: "p1", orden: ["p1", "p2", "p3"] },
      { quien: "p2", orden: ["p2", "p1", "p3"] },
    ];
    const r = sumarVotos(tabla, [
      { quien: "P1", orden: ["p3", "p2", "p1"] },
      { quien: "p3", orden: ["p3", "p1", "p2"] },
    ]);
    expect(r.reemplazados).toEqual(["P1"]);
    expect(r.votos.map((v) => v.quien)).toEqual(["P1", "p2", "p3"]);
  });

  it("ignora huecos e inscripciones que ya no están", () => {
    const c = contarVotos(p, [{ quien: "x", orden: ["", "p3", "borrado", "p1", ""] }]);
    expect(c.validos).toBe(1);
    expect(c.filas.map((f) => [f.id, f.puntos])).toEqual([
      ["p3", 3],
      ["p1", 2],
      ["p2", 0],
    ]);
  });
});

describe("bloques de nivel", () => {
  it("corta donde están los saltos grandes de puntos", () => {
    // Dos que destacan, tres en medio y dos abajo
    expect(partirEnBloques([30, 29, 20, 19, 18, 9, 8], 3)).toEqual([1, 1, 2, 2, 2, 3, 3]);
    // El ejemplo de la votación: 8, 7 y 3 en dos bloques
    expect(partirEnBloques([8, 7, 3], 2)).toEqual([1, 1, 2]);
  });

  it("nunca separa a dos con los mismos puntos", () => {
    expect(partirEnBloques([5, 5, 5, 1], 3)).toEqual([1, 1, 1, 2]);
    expect(partirEnBloques([4, 4], 2)).toEqual([1, 1]);
  });

  it("sin votación, reparte por el lugar en la lista en bloques casi iguales", () => {
    const l = lista("a", "b", "c", "d", "e", "f");
    const b = repartirBloques(l, undefined, 3);
    expect(l.map((j) => b.get(j.id))).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it("propone unos tres por bloque y no más de cuatro bloques", () => {
    expect([2, 3, 6, 9, 12, 30].map(bloquesSugeridos)).toEqual([2, 2, 2, 3, 4, 4]);
  });
});

describe("hándicap por bloques", () => {
  const conBloques = (bloques: number[], tablaBloques?: number[][]) =>
    ({
      reglamento: "personalizado",
      puntosSet: 11,
      siembraManual: true,
      handicap: { activo: true, base: "bloque", escalon: 100, tope: 7, tablaBloques },
      jugadores: bloques.map((b, i) => ({ id: `j${i}`, nombre: `J${i}`, club: "", rank: 0, bloque: b || undefined })),
    }) as unknown as Torneo;

  it("los del mismo bloque no se dan ventaja; el de abajo la recibe del de arriba", () => {
    const t = conBloques([1, 1, 2, 3, 4]);
    expect(ventajaEntre(t, "j0", "j1")).toBeUndefined();
    expect(ventajaEntre(t, "j0", "j2")).toEqual({ lado: "b", puntos: 2 });
    expect(ventajaEntre(t, "j3", "j0")).toEqual({ lado: "a", puntos: 4 });
    expect(ventajaEntre(t, "j0", "j4")).toEqual({ lado: "b", puntos: 5 });
  });

  it("la tabla del juez manda sobre lo sugerido, sin pasar del tope", () => {
    const t = conBloques([1, 2, 3], [
      [0, 3, 9],
      [0, 0, 1],
    ]);
    expect(ventajaEntre(t, "j0", "j1")).toEqual({ lado: "b", puntos: 3 });
    expect(ventajaEntre(t, "j1", "j2")).toEqual({ lado: "b", puntos: 1 });
    expect(ventajaEntre(t, "j0", "j2")).toEqual({ lado: "b", puntos: 7 });
  });

  it("quien no tiene bloque no da ni recibe ventaja", () => {
    expect(ventajaEntre(conBloques([1, 0]), "j0", "j1")).toBeUndefined();
  });

  it("lo sugerido crece cada vez más despacio y se escala con los puntos del set", () => {
    expect([1, 2, 3, 4].map((d) => ventajaSugerida(d))).toEqual([2, 4, 5, 6]);
    expect([1, 2, 3].map((d) => ventajaSugerida(d, 21))).toEqual([4, 8, 10]);
    expect(tablaSugerida(3)).toEqual([
      [0, 2, 4],
      [0, 0, 2],
      [0, 0, 0],
    ]);
  });
});

describe("votos sin nombre de quien vota", () => {
  const texto = [
    "Juan, Miguel, Hazel, Diego, Nando, José, Iran, David, Caro",
    "",
    "Miguel, Juan, Nando, Hazel, Diego, José, David, Irán, Caro",
    "Miguel, Juan, José, Nando, Hazel, Diego, David, Iran, Marielle,Caro",
  ].join("\n");

  it("con la lista vacía, el primer nombre de cada renglón también se propone para inscribir", () => {
    expect(leerVotos(texto, []).desconocidos).toEqual([
      "Juan", "Miguel", "Hazel", "Diego", "Nando", "José", "Iran", "David", "Caro", "Marielle",
    ]);
  });

  it("ya inscritos, cada renglón es un voto anónimo y los acentos no importan", () => {
    const l = lista("Juan", "Miguel", "Hazel", "Diego", "Nando", "José", "Irán", "David", "Caro", "Marielle");
    const { votos, avisos } = leerVotos(texto, l);
    expect(votos.map((v) => v.quien)).toEqual(["Voto 1", "Voto 2", "Voto 3"]);
    expect(votos[2].orden).toHaveLength(10);
    expect(avisos[0]).toBe("Renglón 1: al voto 1 le falta 1 nombre; esos no reciben puntos de ese voto.");
  });
});

describe("número de bloques", () => {
  const puntos = [75, 73, 62, 53, 50, 47, 31, 25, 11, 10];

  it("la silueta prefiere 4 bloques en la votación de diez", () => {
    expect(silueta(puntos, partirEnBloques(puntos, 3))).toBeCloseTo(0.591, 3);
    expect(silueta(puntos, partirEnBloques(puntos, 4))).toBeCloseTo(0.692, 3);
  });

  it("propone la k de mejor silueta y la de la regla", () => {
    expect(proponerBloques(puntos).map((p) => [p.k, p.motivo])).toEqual([
      [4, "silueta"],
      [3, "regla"],
    ]);
  });

  it("si coinciden, la segunda propuesta es la siguiente mejor silueta", () => {
    const p = proponerBloques([8, 7, 3]);
    expect(p[0]).toMatchObject({ k: 2, motivo: "silueta" });
  });
});
