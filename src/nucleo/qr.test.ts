import { describe, expect, it } from "vitest";
import { CAPACIDAD_MAXIMA, bitsDeFormato, correccion, decodificar, generador, qr, qrRuta } from "./qr";

/**
 * El QR se comprueba de tres maneras, porque un código mal construido
 * sigue pareciendo un código y a simple vista no se distingue de uno bueno.
 *
 *  1. Reed–Solomon, por su definición: la palabra completa tiene que ser
 *     divisible por el polinomio generador. Eso no depende de copiar
 *     números de ninguna tabla.
 *  2. La información de formato, contra el valor que fija la norma.
 *  3. El símbolo entero, leyéndolo de vuelta: si sale el mismo texto, el
 *     recorrido en zigzag, la máscara y el entrelazado son correctos.
 */

/** Resto de dividir un polinomio por otro en GF(256). */
function divisiblePor(palabra: Uint8Array, g: Uint8Array): boolean {
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

  const r = Uint8Array.from(palabra);
  for (let i = 0; i + g.length <= r.length; i++) {
    const guia = r[i];
    if (!guia) continue;
    for (let k = 0; k < g.length; k++) r[i + k] ^= mul(g[k], guia);
  }
  return r.every((v) => v === 0);
}

describe("Reed–Solomon sobre GF(256)", () => {
  it("el generador tiene el grado pedido y empieza por uno", () => {
    for (const grado of [7, 10, 15, 18, 20, 26]) {
      const g = generador(grado);
      expect(g.length).toBe(grado + 1);
      expect(g[0]).toBe(1);
    }
  });

  it("datos más corrección son divisibles por el generador, que es la definición", () => {
    const datos = Uint8Array.from({ length: 19 }, (_, i) => (i * 37 + 11) & 0xff);
    const ec = correccion(datos, 7);
    expect(ec.length).toBe(7);
    const palabra = new Uint8Array(datos.length + ec.length);
    palabra.set(datos);
    palabra.set(ec, datos.length);
    expect(divisiblePor(palabra, generador(7))).toBe(true);
  });

  it("cambiar un byte de los datos cambia la corrección", () => {
    const datos = Uint8Array.from({ length: 19 }, () => 0x42);
    const a = correccion(datos, 7);
    datos[5] = 0x43;
    expect([...correccion(datos, 7)]).not.toEqual([...a]);
  });

  it("un mensaje de ceros da corrección de ceros", () => {
    expect([...correccion(new Uint8Array(19), 7)]).toEqual(new Array(7).fill(0));
  });
});

describe("información de formato", () => {
  it("coincide con el valor de la norma para nivel L y máscara 0", () => {
    // ISO/IEC 18004, tabla de secuencias de información de formato.
    expect(bitsDeFormato(0).toString(2).padStart(15, "0")).toBe("111011111000100");
  });

  it("las ocho máscaras dan ocho valores distintos", () => {
    const vistos = new Set(Array.from({ length: 8 }, (_, k) => bitsDeFormato(k)));
    expect(vistos.size).toBe(8);
  });

  it("nunca sale todo ceros, que se confundiría con el fondo", () => {
    for (let k = 0; k < 8; k++) expect(bitsDeFormato(k)).not.toBe(0);
  });
});

describe("el símbolo completo", () => {
  it("lo que se codifica se puede volver a leer", () => {
    for (const texto of [
      "http://192.168.1.108:8099",
      "http://10.0.0.5:8080/#a=K7M2QX",
      "A",
      "TTorneo",
      "http://192.168.100.100:8099/#alta=ZZ9Q2M&m=3",
    ]) {
      expect(decodificar(qr(texto))).toBe(texto);
    }
  });

  it("aguanta acentos y eñes", () => {
    expect(decodificar(qr("Núñez · mesa 3"))).toBe("Núñez · mesa 3");
  });

  it("crece de versión cuando el texto no cabe en la anterior", () => {
    const chico = qr("hola");
    const grande = qr("x".repeat(100));
    expect(chico.tam).toBe(21); // versión 1
    expect(grande.tam).toBeGreaterThan(chico.tam);
    expect(decodificar(grande)).toBe("x".repeat(100));
  });

  it("usa dos bloques entrelazados en la versión más grande y sigue leyéndose", () => {
    const texto = "y".repeat(130);
    const g = qr(texto);
    expect(g.tam).toBe(41); // versión 6
    expect(decodificar(g)).toBe(texto);
  });

  it("avisa en vez de producir un código roto cuando no cabe", () => {
    expect(() => qr("z".repeat(CAPACIDAD_MAXIMA + 1))).toThrow(/no cabe/);
  });

  it("los tres cuadrados de las esquinas están donde tienen que estar", () => {
    const { tam, modulos } = qr("http://192.168.1.1:8080");
    for (const [f0, c0] of [
      [0, 0],
      [0, tam - 7],
      [tam - 7, 0],
    ]) {
      expect(modulos[f0][c0]).toBe(true); // esquina del anillo
      expect(modulos[f0 + 1][c0 + 1]).toBe(false); // hueco blanco
      expect(modulos[f0 + 3][c0 + 3]).toBe(true); // centro macizo
    }
  });

  it("la línea de temporización alterna", () => {
    const { tam, modulos } = qr("http://192.168.1.1:8080");
    for (let i = 8; i < tam - 8; i++) {
      expect(modulos[6][i]).toBe(i % 2 === 0);
      expect(modulos[i][6]).toBe(i % 2 === 0);
    }
  });

  it("no sale ni casi todo negro ni casi todo blanco", () => {
    const { tam, modulos } = qr("http://192.168.1.108:8099/#a=K7M2QX");
    const oscuros = modulos.flat().filter(Boolean).length;
    const proporcion = oscuros / (tam * tam);
    expect(proporcion).toBeGreaterThan(0.3);
    expect(proporcion).toBeLessThan(0.7);
  });

  it("la ruta SVG tiene un rectángulo por módulo oscuro", () => {
    const { d, tam } = qrRuta("TTorneo");
    const { modulos } = qr("TTorneo");
    expect(d.match(/M/g)?.length).toBe(modulos.flat().filter(Boolean).length);
    expect(tam).toBe(21);
  });
});

/*
 * 4. Contra un generador ajeno.
 *
 * Las tres pruebas de arriba no vieron que la información de formato iba
 * transpuesta —escrita por la fila 8 donde la norma la quiere por la
 * columna 8—, porque el lector de esta casa la leía transpuesta también:
 * el error se cancelaba consigo mismo y ningún teléfono reconocía el
 * código. Estas rejillas salieron de la biblioteca `qrcode` de npm con la
 * misma máscara, y se comprobó que un lector independiente (jsQR) las lee
 * desde una captura de la pantalla. Si alguna vez cambia un solo módulo,
 * hay que volver a apuntar un teléfono antes de dar el cambio por bueno.
 */
const REFERENCIA: Record<string, string[]> = {
  hola: ["#######..#..#.#######","#.....#.#..#..#.....#","#.###.#..#....#.###.#","#.###.#.#..#..#.###.#","#.###.#...###.#.###.#","#.....#.###.#.#.....#","#######.#.#.#.#######","..........###........","#####.####..##.#.#.#.","...#.#......#..#.#..#","##.####.####.#..##.#.","..#..#.###.....####..","####..##.###.#..#...#","........#..####..#..#","#######.##..#.##..##.","#.....#...#####..##..","#.###.#.##..#..#...#.","#.###.#.###.#..#..#..","#.###.#.#.##.#..###..","#.....#.#......##.#..","#######.##.#.#..#.##."],
  "http://192.168.1.114:8080/#alta=K7M2QX": ["#######...#.#.###..#..#######","#.....#.#.#....#..#...#.....#","#.###.#.....#.#...#...#.###.#","#.###.#.###.#.#######.#.###.#","#.###.#..#...##..#.#..#.###.#","#.....#.##.##..##.#...#.....#","#######.#.#.#.#.#.#.#.#######",".........###...##.##.........","#####.####.#.....#####.#.#.#.","....##.#..#.##.##..#..#.#...#","##..###.#.#..####.#....##....","..#.##......##..#.#.###.#..#.",".#.#.###.##.#.#####.##.#.##..","##.#.............###..#.#.#.#","####.########..###..###...#..","..........##..#......#.#...#.",".####.##.#.#.....##.##....#..","###.##.####.#####.##.##.###.#","#.##..#.##...######.#.#..##..","#..###.#.#..##.##....##.#..#.","#.##.##.#...#.#.##..#####.###","........##........###...#####","#######.#.###..##.###.#.###..","#.....#..#.#..##....#...#..##","#.###.#.##.#...#.#..#######..","#.###.#.##..###.###.##.#...##","#.###.#.#.#..###...##.#.##.#.","#.....#.###.##.##.#.##.##..#.","#######.###.#.####.......##.."],
};

describe("contra un generador ajeno", () => {
  for (const [texto, filas] of Object.entries(REFERENCIA)) {
    it(`«${texto}» sale módulo por módulo igual que en la biblioteca de referencia`, () => {
      const { modulos } = qr(texto);
      expect(modulos.map((f) => f.map((v) => (v ? "#" : ".")).join(""))).toEqual(filas);
    });
  }
});
