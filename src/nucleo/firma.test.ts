import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  bytes,
  codigoLegible,
  hex,
  hmac,
  hmacHex,
  huella,
  igualSeguro,
  pruebaPeticion,
  sha256Hex,
  tokenNuevo,
} from "./firma";

/**
 * Criptografía comprobada contra los vectores oficiales.
 *
 * Estos no son casos inventados para que pasen: son los del apéndice de
 * FIPS 180-4 y del RFC 4231. Una implementación propia de SHA-256 sin
 * estas pruebas no vale nada, porque los errores de este tipo de código no
 * se notan usándolo —sigue devolviendo algo de 32 bytes— sino solo al
 * compararlo con la norma.
 */

const repetir = (b: number, n: number) => new Uint8Array(n).fill(b);

describe("SHA-256 contra los vectores de FIPS 180-4", () => {
  it("la cadena vacía", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("«abc»", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("un mensaje de 448 bits", () => {
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("un mensaje que ocupa más de un bloque", () => {
    expect(
      sha256Hex(
        "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
      ),
    ).toBe("cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1");
  });

  /**
   * Barrido contra la implementación de la biblioteca estándar.
   *
   * Los vectores publicados comprueban unas pocas longitudes, y por eso no
   * bastan: esta implementación estuvo dando un resumen incorrecto para
   * todo mensaje de longitud 55 módulo 64 —reservaba un bloque de relleno
   * de más— y los cuatro vectores de arriba pasaban igual, porque ninguno
   * cae en ese caso. El fallo apareció en el simulacro como firmas que no
   * cuadraban al azar, según el tamaño del cuerpo de la petición.
   *
   * Comparar longitud a longitud contra `node:crypto` cubre todas las
   * fronteras de bloque de una vez, que es lo que hacía falta.
   */
  it("coincide con node:crypto en todas las longitudes hasta 200 bytes", () => {
    const malas: number[] = [];
    for (let n = 0; n <= 200; n++) {
      const texto = "a".repeat(n);
      const patron = createHash("sha256").update(texto, "utf8").digest("hex");
      if (sha256Hex(texto) !== patron) malas.push(n);
    }
    expect(malas).toEqual([]);
  });

  it("también con texto acentuado, donde los bytes no son los caracteres", () => {
    const malas: number[] = [];
    for (let n = 0; n <= 120; n++) {
      const texto = "áñé".repeat(n).slice(0, n + 7);
      const patron = createHash("sha256").update(texto, "utf8").digest("hex");
      if (sha256Hex(texto) !== patron) malas.push(n);
    }
    expect(malas).toEqual([]);
  });

  it("y el HMAC coincide con node:crypto sobre las mismas fronteras", () => {
    const malas: number[] = [];
    for (let n = 50; n <= 130; n++) {
      const texto = "b".repeat(n);
      const patron = createHmac("sha256", "clave").update(texto, "utf8").digest("hex");
      if (hmacHex("clave", texto) !== patron) malas.push(n);
    }
    expect(malas).toEqual([]);
  });

  it("acepta acentos y eñes sin romperse", () => {
    expect(sha256Hex("Núñez")).toHaveLength(64);
    expect(sha256Hex("Núñez")).not.toBe(sha256Hex("Nunez"));
  });
});

describe("HMAC-SHA-256 contra los vectores del RFC 4231", () => {
  it("caso 1: clave corta", () => {
    expect(hex(hmac(repetir(0x0b, 20), bytes("Hi There")))).toBe(
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    );
  });

  it("caso 2: clave y mensaje de texto", () => {
    expect(hex(hmac(bytes("Jefe"), bytes("what do ya want for nothing?")))).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  it("caso 3: mensaje largo", () => {
    expect(hex(hmac(repetir(0xaa, 20), repetir(0xdd, 50)))).toBe(
      "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe",
    );
  });

  it("caso 6: clave más larga que el bloque, que hay que resumir antes", () => {
    expect(
      hex(hmac(repetir(0xaa, 131), bytes("Test Using Larger Than Block-Size Key - Hash Key First"))),
    ).toBe("60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54");
  });
});

describe("comparación en tiempo constante", () => {
  it("dice la verdad", () => {
    expect(igualSeguro("abc", "abc")).toBe(true);
    expect(igualSeguro("abc", "abd")).toBe(false);
    expect(igualSeguro("abc", "abcd")).toBe(false);
    expect(igualSeguro("", "")).toBe(true);
  });
});

describe("códigos y tokens", () => {
  it("el código de alta no lleva caracteres que se confundan al dictarlos", () => {
    for (let i = 0; i < 40; i++) {
      expect(codigoLegible()).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    }
  });

  it("dos códigos seguidos no salen iguales", () => {
    const vistos = new Set(Array.from({ length: 50 }, () => codigoLegible()));
    expect(vistos.size).toBeGreaterThan(45);
  });

  it("el token es largo y distinto cada vez", () => {
    const a = tokenNuevo();
    expect(a).toHaveLength(48);
    expect(a).not.toBe(tokenNuevo());
  });

  it("la huella identifica el token sin revelarlo", () => {
    const t = tokenNuevo();
    expect(huella(t)).toBe(huella(t));
    expect(huella(t)).toHaveLength(8);
    expect(t).not.toContain(huella(t).toLowerCase());
  });
});

describe("prueba de identidad de una petición", () => {
  const token = "un-token-cualquiera";
  const base = () => pruebaPeticion(token, "POST", "/api/paquete", 7, '{"a":1}');

  it("es la misma para la misma petición", () => {
    expect(base()).toBe(pruebaPeticion(token, "POST", "/api/paquete", 7, '{"a":1}'));
  });

  it("cambia si cambia el token", () => {
    expect(base()).not.toBe(pruebaPeticion("otro", "POST", "/api/paquete", 7, '{"a":1}'));
  });

  it("cambia si cambia el contador, que es lo que impide repetirla", () => {
    expect(base()).not.toBe(pruebaPeticion(token, "POST", "/api/paquete", 8, '{"a":1}'));
  });

  it("cambia si cambia el cuerpo, que es lo que impide alterarlo por el camino", () => {
    expect(base()).not.toBe(pruebaPeticion(token, "POST", "/api/paquete", 7, '{"a":2}'));
  });

  it("cambia si cambia la ruta, que es lo que impide reusarla en otra operación", () => {
    expect(base()).not.toBe(pruebaPeticion(token, "POST", "/api/estructura", 7, '{"a":1}'));
    expect(base()).not.toBe(pruebaPeticion(token, "GET", "/api/paquete", 7, '{"a":1}'));
  });

  it("no deja adivinar el token", () => {
    expect(base()).not.toContain(token);
    expect(base()).toMatch(/^[0-9a-f]{64}$/);
  });
});
