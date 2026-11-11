/**
 * Códigos QR, lo justo para repartir una dirección y un código de alta.
 *
 * Sin esto la puesta en marcha del torneo es teclear `http://192.168.1.108:8099`
 * en seis tablets con teclado en pantalla, y cada dígito mal escrito es un
 * árbitro llamando al juez. Con esto, se apunta la cámara.
 *
 * Está acotado a lo que hace falta y no un byte más: **modo byte, nivel de
 * corrección L, versiones 1 a 6**. Eso da hasta 136 bytes, y la dirección
 * más larga que puede salir de aquí ronda los cuarenta. Quedarse en la
 * versión 6 tiene además una ventaja concreta: los bloques de información
 * de versión solo aparecen a partir de la 7, así que no hay que
 * construirlos.
 *
 * La codificación de Reed–Solomon sobre GF(256) es la parte con contenido:
 * los bytes de corrección son el resto de dividir el mensaje por el
 * polinomio generador, y las pruebas lo comprueban por su definición
 * —la palabra completa tiene que ser divisible por el generador— en vez de
 * con números copiados de una tabla.
 */

/* ---------- aritmética en GF(256) ---------- */

/*
 * El cuerpo se genera con el polinomio 0x11D, que es el que fija la norma.
 * Con las tablas de logaritmo y antilogaritmo, multiplicar es sumar
 * exponentes, que es lo que hace que todo lo demás sea barato.
 */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Polinomio generador de grado `grado`: (x−α⁰)(x−α¹)…(x−α^(grado−1)). */
export function generador(grado: number): Uint8Array {
  let g = Uint8Array.from([1]);
  for (let i = 0; i < grado; i++) {
    const siguiente = new Uint8Array(g.length + 1);
    for (let k = 0; k < g.length; k++) {
      siguiente[k] ^= g[k];
      siguiente[k + 1] ^= mul(g[k], EXP[i]);
    }
    g = siguiente;
  }
  return g;
}

/** Bytes de corrección: el resto de dividir el mensaje por el generador. */
export function correccion(datos: Uint8Array, cuantos: number): Uint8Array {
  const g = generador(cuantos);
  const resto = new Uint8Array(datos.length + cuantos);
  resto.set(datos);
  for (let i = 0; i < datos.length; i++) {
    const guia = resto[i];
    if (!guia) continue;
    for (let k = 0; k < g.length; k++) resto[i + k] ^= mul(g[k], guia);
  }
  return resto.slice(datos.length);
}

/* ---------- tablas de las versiones que se usan ---------- */

interface Version {
  /** Bytes de datos en total. */
  datos: number;
  /** Bytes de corrección por bloque. */
  ec: number;
  bloques: number;
  /** Centros de los patrones de alineación. */
  alineacion: number[];
}

const VERSIONES: Record<number, Version> = {
  1: { datos: 19, ec: 7, bloques: 1, alineacion: [] },
  2: { datos: 34, ec: 10, bloques: 1, alineacion: [6, 18] },
  3: { datos: 55, ec: 15, bloques: 1, alineacion: [6, 22] },
  4: { datos: 80, ec: 20, bloques: 1, alineacion: [6, 26] },
  5: { datos: 108, ec: 26, bloques: 1, alineacion: [6, 30] },
  6: { datos: 136, ec: 18, bloques: 2, alineacion: [6, 34] },
};

export const CAPACIDAD_MAXIMA = VERSIONES[6].datos - 3;

/* ---------- información de formato ---------- */

/**
 * Los quince bits que dicen el nivel de corrección y la máscara.
 *
 * Llevan un código BCH encima y se enmascaran con 0x5412 para que no
 * puedan salir todo ceros, que se confundiría con un patrón del propio
 * código. Van repetidos en dos sitios del símbolo porque son lo único que
 * un lector no puede deducir por su cuenta: si se pierden, no hay forma de
 * empezar a leer.
 */
export function bitsDeFormato(mascara: number): number {
  // 01 es el nivel L.
  let v = ((0b01 << 3) | mascara) << 10;
  const base = (0b01 << 3) | mascara;
  for (let i = 4; i >= 0; i--) {
    if (v & (1 << (i + 10))) v ^= 0x537 << i;
  }
  return ((base << 10) | v) ^ 0x5412;
}

/* ---------- construcción del símbolo ---------- */

type Rejilla = Array<Array<boolean | null>>;

function conPatrones(version: number): { m: Rejilla; reservado: boolean[][] } {
  const tam = 17 + version * 4;
  const m: Rejilla = Array.from({ length: tam }, () => new Array<boolean | null>(tam).fill(null));
  const reservado = Array.from({ length: tam }, () => new Array<boolean>(tam).fill(false));

  const poner = (f: number, c: number, v: boolean) => {
    if (f < 0 || c < 0 || f >= tam || c >= tam) return;
    m[f][c] = v;
    reservado[f][c] = true;
  };

  /* Los tres cuadrados de las esquinas, con su separador blanco. */
  const buscador = (f0: number, c0: number) => {
    for (let f = -1; f <= 7; f++) {
      for (let c = -1; c <= 7; c++) {
        const dentro = f >= 0 && f <= 6 && c >= 0 && c <= 6;
        const anillo = f === 0 || f === 6 || c === 0 || c === 6;
        const centro = f >= 2 && f <= 4 && c >= 2 && c <= 4;
        poner(f0 + f, c0 + c, dentro && (anillo || centro));
      }
    }
  };
  buscador(0, 0);
  buscador(0, tam - 7);
  buscador(tam - 7, 0);

  /* Las líneas de puntos que dan la referencia de tamaño. */
  for (let i = 8; i < tam - 8; i++) {
    poner(6, i, i % 2 === 0);
    poner(i, 6, i % 2 === 0);
  }

  /* Los cuadraditos de alineación, salvo donde chocan con los buscadores. */
  const ejes = VERSIONES[version].alineacion;
  for (const f0 of ejes) {
    for (const c0 of ejes) {
      const enBuscador =
        (f0 <= 8 && c0 <= 8) || (f0 <= 8 && c0 >= tam - 9) || (f0 >= tam - 9 && c0 <= 8);
      if (enBuscador) continue;
      for (let f = -2; f <= 2; f++) {
        for (let c = -2; c <= 2; c++) {
          poner(f0 + f, c0 + c, Math.max(Math.abs(f), Math.abs(c)) !== 1);
        }
      }
    }
  }

  /* Un módulo siempre oscuro, por norma. */
  poner(tam - 8, 8, true);

  /* Y se aparta el sitio del formato, que se rellena al final. */
  for (let i = 0; i < 9; i++) {
    if (!reservado[8][i]) reservado[8][i] = true;
    if (!reservado[i][8]) reservado[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reservado[8][tam - 1 - i] = true;
    reservado[tam - 1 - i][8] = true;
  }

  return { m, reservado };
}

/** Modo byte, longitud, datos, terminador y relleno alterno. */
function aBytes(texto: string, version: number): Uint8Array {
  const datos = new TextEncoder().encode(texto);
  const capacidad = VERSIONES[version].datos;
  const bits: number[] = [];
  const meter = (valor: number, cuantos: number) => {
    for (let i = cuantos - 1; i >= 0; i--) bits.push((valor >> i) & 1);
  };

  meter(0b0100, 4); // modo byte
  meter(datos.length, 8); // en las versiones 1-9 la longitud son 8 bits
  for (const b of datos) meter(b, 8);
  meter(0, Math.min(4, capacidad * 8 - bits.length)); // terminador

  while (bits.length % 8) bits.push(0);
  const salida = new Uint8Array(capacidad);
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
    salida[i / 8] = b;
  }
  // Relleno de norma: 11101100 00010001 alternados hasta llenar.
  for (let i = Math.ceil(bits.length / 8); i < capacidad; i++) {
    salida[i] = i % 2 === Math.ceil(bits.length / 8) % 2 ? 0xec : 0x11;
  }
  return salida;
}

/** Reparte en bloques, calcula su corrección y los entrelaza. */
function conCorreccion(datos: Uint8Array, version: number): Uint8Array {
  const { ec, bloques } = VERSIONES[version];
  const porBloque = datos.length / bloques;
  const trozos: Uint8Array[] = [];
  const eces: Uint8Array[] = [];
  for (let i = 0; i < bloques; i++) {
    const t = datos.slice(i * porBloque, (i + 1) * porBloque);
    trozos.push(t);
    eces.push(correccion(t, ec));
  }

  // Entrelazado: primero el byte 0 de cada bloque, luego el 1… Así una
  // raya o un dedo sobre el código estropea unos pocos bytes de cada
  // bloque en vez de destruir uno entero.
  const salida: number[] = [];
  for (let i = 0; i < porBloque; i++) for (const t of trozos) salida.push(t[i]);
  for (let i = 0; i < ec; i++) for (const e of eces) salida.push(e[i]);
  return Uint8Array.from(salida);
}

/** La máscara que se aplica a los módulos de datos, según su posición. */
const MASCARAS: Array<(f: number, c: number) => boolean> = [
  (f, c) => (f + c) % 2 === 0,
  (f) => f % 2 === 0,
  (_f, c) => c % 3 === 0,
  (f, c) => (f + c) % 3 === 0,
  (f, c) => (Math.floor(f / 2) + Math.floor(c / 3)) % 2 === 0,
  (f, c) => ((f * c) % 2) + ((f * c) % 3) === 0,
  (f, c) => (((f * c) % 2) + ((f * c) % 3)) % 2 === 0,
  (f, c) => (((f + c) % 2) + ((f * c) % 3)) % 2 === 0,
];

/**
 * Cuánto molesta una máscara.
 *
 * Un símbolo con manchas grandes de un color, o con tramas que se parecen
 * a los cuadrados de las esquinas, se lee peor. Se prueban las ocho y se
 * queda la de menor penalización; es una búsqueda exhaustiva sobre ocho
 * candidatas, que a este tamaño no cuesta nada.
 */
function penalizacion(m: boolean[][]): number {
  const n = m.length;
  let total = 0;

  const racha = (leer: (i: number, k: number) => boolean) => {
    for (let i = 0; i < n; i++) {
      let cuenta = 1;
      for (let k = 1; k < n; k++) {
        if (leer(i, k) === leer(i, k - 1)) cuenta++;
        else {
          if (cuenta >= 5) total += 3 + (cuenta - 5);
          cuenta = 1;
        }
      }
      if (cuenta >= 5) total += 3 + (cuenta - 5);
    }
  };
  racha((i, k) => m[i][k]);
  racha((i, k) => m[k][i]);

  for (let f = 0; f < n - 1; f++) {
    for (let c = 0; c < n - 1; c++) {
      const v = m[f][c];
      if (v === m[f][c + 1] && v === m[f + 1][c] && v === m[f + 1][c + 1]) total += 3;
    }
  }

  const patron = [true, false, true, true, true, false, true, false, false, false, false];
  const buscar = (leer: (i: number) => boolean, largo: number) => {
    for (let i = 0; i + patron.length <= largo; i++) {
      let igual = true;
      for (let k = 0; k < patron.length && igual; k++) if (leer(i + k) !== patron[k]) igual = false;
      if (igual) total += 40;
    }
  };
  for (let i = 0; i < n; i++) {
    buscar((k) => m[i][k], n);
    buscar((k) => m[k][i], n);
  }

  let oscuros = 0;
  for (const fila of m) for (const v of fila) if (v) oscuros++;
  total += Math.floor(Math.abs((oscuros * 100) / (n * n) - 50) / 5) * 10;
  return total;
}

export interface Qr {
  tam: number;
  modulos: boolean[][];
}

/**
 * Construye el código.
 *
 * Elige la versión más pequeña donde quepa el texto, coloca los datos en
 * zigzag desde la esquina inferior derecha, prueba las ocho máscaras y se
 * queda con la que menos penaliza.
 */
export function qr(texto: string): Qr {
  const largo = new TextEncoder().encode(texto).length;
  const version = Number(
    Object.keys(VERSIONES).find((v) => VERSIONES[Number(v)].datos - 3 >= largo) ?? 0,
  );
  if (!version) throw new Error(`«${texto}» no cabe: máximo ${CAPACIDAD_MAXIMA} bytes`);

  const palabra = conCorreccion(aBytes(texto, version), version);
  const { m, reservado } = conPatrones(version);
  const tam = m.length;

  let bit = 0;
  recorrerDatos(tam, reservado, (f, c) => {
    const b = bit < palabra.length * 8 ? (palabra[bit >> 3] >> (7 - (bit % 8))) & 1 : 0;
    m[f][c] = b === 1;
    bit++;
  });

  /* Se prueban las ocho máscaras sobre una copia y gana la más limpia. */
  let mejor: boolean[][] | null = null;
  let mejorMascara = 0;
  let mejorNota = Infinity;
  for (let k = 0; k < 8; k++) {
    const copia = m.map((fila, f) =>
      fila.map((v, c) => (reservado[f][c] ? !!v : !!v !== MASCARAS[k](f, c))),
    );
    ponerFormato(copia, reservado, k);
    const nota = penalizacion(copia);
    if (nota < mejorNota) {
      mejorNota = nota;
      mejor = copia;
      mejorMascara = k;
    }
  }
  void mejorMascara;
  return { tam, modulos: mejor! };
}

/**
 * Recorre las casillas de datos en el orden que fija la norma.
 *
 * Columnas de dos en dos de derecha a izquierda, subiendo y bajando en
 * zigzag, saltándose la columna 6 que es la de temporización. Va aparte
 * porque escribir y volver a leer tienen que seguir exactamente el mismo
 * camino: si se escribieran dos veces, cualquier diferencia entre las dos
 * copias sería un fallo imposible de encontrar.
 */
function recorrerDatos(tam: number, reservado: boolean[][], visitar: (f: number, c: number) => void): void {
  let subiendo = true;
  for (let cd = tam - 1; cd > 0; cd -= 2) {
    if (cd === 6) cd--;
    for (let paso = 0; paso < tam; paso++) {
      const f = subiendo ? tam - 1 - paso : paso;
      for (const c of [cd, cd - 1]) {
        if (!reservado[f][c]) visitar(f, c);
      }
    }
    subiendo = !subiendo;
  }
}

function ponerFormato(m: boolean[][], _reservado: boolean[][], mascara: number): void {
  const tam = m.length;
  const bits = bitsDeFormato(mascara);
  const b = (i: number) => ((bits >> i) & 1) === 1;

  // m[fila][columna]. La norma cuenta el bit 0 bajando por la columna 8
  // junto al localizador de arriba a la izquierda; escribirlo por la fila 8
  // deja el formato transpuesto y ningún lector de verdad lo reconoce.
  for (let i = 0; i <= 5; i++) m[i][8] = b(i);
  m[7][8] = b(6);
  m[8][8] = b(7);
  m[8][7] = b(8);
  for (let i = 9; i <= 14; i++) m[8][14 - i] = b(i);

  for (let i = 0; i <= 7; i++) m[8][tam - 1 - i] = b(i);
  for (let i = 8; i <= 14; i++) m[tam - 15 + i][8] = b(i);
  m[tam - 8][8] = true;
}

/**
 * El código como una ruta SVG.
 *
 * Un solo `<path>` con un rectángulo por módulo oscuro: pesa poco, escala
 * sin perder filo y se imprime bien, que es lo que hace falta cuando el
 * QR acaba pegado con cinta en la pared del gimnasio.
 */
export function qrRuta(texto: string): { d: string; tam: number } {
  const { tam, modulos } = qr(texto);
  let d = "";
  for (let f = 0; f < tam; f++) {
    for (let c = 0; c < tam; c++) {
      if (modulos[f][c]) d += `M${c} ${f}h1v1h-1z`;
    }
  }
  return { d, tam };
}

/**
 * Lee de vuelta un código construido aquí.
 *
 * No es un lector de QR de verdad —no busca el símbolo en una foto ni
 * corrige errores con los bytes de Reed–Solomon— y no está para eso. Está
 * para poder comprobar el codificador contra sí mismo: si lo que se
 * escribió en la rejilla se puede volver a sacar, entonces el recorrido,
 * la máscara y el entrelazado son inversos correctos. Un QR mal construido
 * sigue pareciendo un QR, así que sin esto no habría forma de saberlo sin
 * apuntar un teléfono a la pantalla.
 */
export function decodificar({ tam, modulos }: Qr): string {
  const version = (tam - 17) / 4;
  if (!VERSIONES[version]) throw new Error(`versión ${version} fuera de lo soportado`);

  /* La máscara se lee del propio símbolo, como haría un lector. */
  let formato = 0;
  for (let i = 0; i <= 5; i++) formato |= (modulos[i][8] ? 1 : 0) << i;
  formato |= (modulos[7][8] ? 1 : 0) << 6;
  formato |= (modulos[8][8] ? 1 : 0) << 7;
  formato |= (modulos[8][7] ? 1 : 0) << 8;
  for (let i = 9; i <= 14; i++) formato |= (modulos[8][14 - i] ? 1 : 0) << i;
  const mascara = ((formato ^ 0x5412) >> 10) & 0b111;

  const { reservado } = conPatrones(version);
  const bits: number[] = [];
  recorrerDatos(tam, reservado, (f, c) => {
    bits.push(modulos[f][c] !== MASCARAS[mascara](f, c) ? 1 : 0);
  });

  const crudo: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
    crudo.push(b);
  }

  /* Deshacer el entrelazado de bloques. */
  const { datos: totalDatos, bloques } = VERSIONES[version];
  const porBloque = totalDatos / bloques;
  const ordenados = new Uint8Array(totalDatos);
  for (let i = 0; i < porBloque; i++) {
    for (let b = 0; b < bloques; b++) ordenados[b * porBloque + i] = crudo[i * bloques + b];
  }

  const modo = ordenados[0] >> 4;
  if (modo !== 0b0100) throw new Error(`modo ${modo}, se esperaba byte`);
  const largo = ((ordenados[0] & 0x0f) << 4) | (ordenados[1] >> 4);
  const salida = new Uint8Array(largo);
  for (let i = 0; i < largo; i++) {
    salida[i] = ((ordenados[1 + i] & 0x0f) << 4) | (ordenados[2 + i] >> 4);
  }
  return new TextDecoder().decode(salida);
}
