/**
 * Identidad de los mensajes: SHA-256 y HMAC.
 *
 * Va implementado a mano y no con `crypto.subtle` por una razón concreta
 * del sitio donde esto corre: la API criptográfica del navegador solo
 * existe en *contextos seguros* —HTTPS o localhost— y el relevo del
 * gimnasio sirve por HTTP en una dirección de red local. En la tablet de
 * un árbitro, `crypto.subtle` sencillamente no está. Montar HTTPS con
 * certificado propio obligaría a cada árbitro a saltarse una advertencia
 * del navegador antes de cada torneo, que es peor.
 *
 * SHA-256 (FIPS 180-4) y HMAC (RFC 2104) están fijados por norma y se
 * comprueban contra los vectores oficiales en las pruebas. No hay nada
 * inventado aquí: eso es justo lo que no se debe hacer en criptografía.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const gira = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** SHA-256 sobre bytes. Devuelve los 32 bytes del resumen. */
export function sha256(datos: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  /*
   * Relleno: un bit a uno, ceros, y la longitud en bits al final.
   *
   * El total es el menor múltiplo de 64 que deja sitio al byte 0x80 y a
   * los ocho de la longitud. La norma pide el *menor*: reservar un bloque
   * de más da un resumen distinto y perfectamente verosímil, que es lo
   * peor que puede pasar aquí. Ocurre justo cuando la longitud del mensaje
   * es 55 módulo 64, un caso que ninguno de los vectores publicados toca.
   */
  const bits = datos.length * 8;
  const conRelleno = new Uint8Array(((datos.length + 72) >> 6) << 6);
  conRelleno.set(datos);
  conRelleno[datos.length] = 0x80;
  const vista = new DataView(conRelleno.buffer);
  vista.setUint32(conRelleno.length - 8, Math.floor(bits / 0x100000000));
  vista.setUint32(conRelleno.length - 4, bits >>> 0);

  const w = new Uint32Array(64);
  for (let bloque = 0; bloque < conRelleno.length; bloque += 64) {
    for (let i = 0; i < 16; i++) w[i] = vista.getUint32(bloque + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = gira(w[i - 15], 7) ^ gira(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = gira(w[i - 2], 17) ^ gira(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = gira(e, 6) ^ gira(e, 11) ^ gira(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = gira(a, 2) ^ gira(a, 13) ^ gira(a, 22);
      const may = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + may) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const salida = new Uint8Array(32);
  const sv = new DataView(salida.buffer);
  for (let i = 0; i < 8; i++) sv.setUint32(i * 4, h[i]);
  return salida;
}

/** HMAC-SHA-256 (RFC 2104). */
export function hmac(clave: Uint8Array, mensaje: Uint8Array): Uint8Array {
  const BLOQUE = 64;
  let k = clave;
  if (k.length > BLOQUE) k = sha256(k);

  const relleno = new Uint8Array(BLOQUE);
  relleno.set(k);

  const dentro = new Uint8Array(BLOQUE + mensaje.length);
  const fuera = new Uint8Array(BLOQUE + 32);
  for (let i = 0; i < BLOQUE; i++) {
    dentro[i] = relleno[i] ^ 0x36;
    fuera[i] = relleno[i] ^ 0x5c;
  }
  dentro.set(mensaje, BLOQUE);
  fuera.set(sha256(dentro), BLOQUE);
  return sha256(fuera);
}

/* ---------- envoltorios cómodos ---------- */

const codificador = new TextEncoder();
export const bytes = (s: string): Uint8Array => codificador.encode(s);
export const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export const sha256Hex = (s: string): string => hex(sha256(bytes(s)));
export const hmacHex = (clave: string, mensaje: string): string => hex(hmac(bytes(clave), bytes(mensaje)));

/**
 * Comparación en tiempo constante.
 *
 * Comparar dos cadenas con `===` tarda más cuanto más coinciden, y de esa
 * diferencia se puede deducir el secreto carácter a carácter. En una red
 * de gimnasio el ataque es poco realista, pero escribirlo bien no cuesta
 * nada y escribirlo mal enseña la lección equivocada.
 */
export function igualSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ---------- azar ---------- */

/**
 * Bytes impredecibles.
 *
 * `getRandomValues` sí está disponible sin contexto seguro, al contrario
 * que `crypto.subtle`. Si faltara, es mejor fallar que seguir con
 * `Math.random`: un token adivinable no es un token.
 */
export function azarBytes(n: number): Uint8Array {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) throw new Error("este entorno no ofrece azar criptográfico");
  return c.getRandomValues(new Uint8Array(n));
}

/** Alfabeto sin caracteres que se confundan al dictarlos en voz alta. */
const ALFABETO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * Código corto para decir en voz alta o escribir en una tablet.
 *
 * Sin ceros ni oes, sin unos ni eles: el juez tiene que poder cantar el
 * código desde la mesa de control y que el árbitro lo teclee bien a la
 * primera, con ruido de gimnasio de fondo.
 */
export function codigoLegible(largo = 6): string {
  const b = azarBytes(largo);
  let s = "";
  for (let i = 0; i < largo; i++) s += ALFABETO[b[i] % ALFABETO.length];
  return s;
}

/** Secreto largo. Este no lo teclea nadie: viaja en el código de alta. */
export const tokenNuevo = (): string => hex(azarBytes(24));

/* ---------- prueba de identidad en cada petición ---------- */

export type Papel = "juez" | "arbitro" | "pantalla";

export interface Credencial {
  /** A quién identifica: el id del árbitro, o «juez». */
  quien: string;
  papel: Papel;
  nombre: string;
  /** Secreto compartido con el relevo. Nunca viaja por la red. */
  token: string;
  /** Contador de peticiones, siempre creciente. */
  n: number;
}

/**
 * Prueba de que quien manda esto conoce el token, sin mandar el token.
 *
 * Es lo que sustituye a HTTPS aquí. Mandar el token en una cabecera por
 * una red abierta lo regalaría a cualquiera con un capturador de
 * paquetes; mandar un HMAC del que no se puede sacar el token, no.
 *
 * El contador `n` va dentro de la firma y el relevo exige que crezca, así
 * que una petición capturada tampoco se puede repetir para colar el mismo
 * punto dos veces o revivir una validación ya anulada.
 *
 * Lo que esto **no** hace: cifrar. El contenido viaja en claro y quien
 * escuche la red puede leer los marcadores. Es información que además está
 * proyectada en la pared, así que el reparto es el correcto: se protege
 * quién puede escribir, no quién puede mirar.
 */
export function pruebaPeticion(
  token: string,
  metodo: string,
  ruta: string,
  n: number,
  cuerpo: string,
): string {
  return hmacHex(token, `${metodo}\n${ruta}\n${n}\n${sha256Hex(cuerpo)}`);
}

/** Huella corta de un token, para enseñarla sin enseñar el token. */
export const huella = (token: string): string => hmacHex(token, "huella").slice(0, 8).toUpperCase();
