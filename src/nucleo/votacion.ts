import { nombreDe } from "./tipos";
import type { Jugador, Voto } from "./tipos";

/**
 * Ranking por votación.
 *
 * Cada votante da su orden de las inscripciones, del mejor al peor, y de
 * todos esos órdenes sale uno solo. Sirve para sembrar cuando nadie tiene
 * ranking: en lugar de que quien organiza acomode la lista a su criterio,
 * la acomoda lo que opinan los jugadores.
 *
 * El conteo es el de Borda. Con n inscritos, el primer lugar de un voto da
 * n puntos, el segundo n − 1 y así hasta el último, que da 1; quien no
 * aparece en un voto no recibe nada de él. Va arriba quien más suma. Se
 * eligió Borda porque siempre da un orden completo, toma en cuenta el voto
 * entero y no solo el primer lugar, y sus puntos se pueden explicar en voz
 * alta.
 *
 * Los empates se rompen como en la tabla de un grupo. Primero, el duelo
 * entre los empatados: a uno le gana a otro si más votantes lo pusieron
 * arriba. Si siguen igual, cuenta quién tiene más primeros lugares, luego
 * más segundos, y así. Si nada los separa, se queda el orden que ya tenía
 * la lista.
 */

/** Un voto ya contado, con lo que hace falta para la tabla de resultados. */
export interface FilaVotacion {
  id: string;
  /** Lugar final, contando desde 1. */
  lugar: number;
  puntos: number;
  /** veces[k]: cuántos votos lo pusieron en el lugar k + 1. */
  veces: number[];
  /** Lugar promedio entre los votos que lo incluyen. Nulo si nadie lo puso. */
  promedio: number | null;
  /** Cómo se decidió su lugar frente a otros con los mismos puntos. */
  desempate: string;
  /** Nada lo separó de otro y lo dejó donde estaba el orden de la lista. */
  empate: boolean;
}

export interface ConteoVotacion {
  /** En el orden final: la primera fila es el primer lugar. */
  filas: FilaVotacion[];
  /** Votos que contaron: los que tienen al menos un nombre de la lista. */
  validos: number;
  /** duelos[x][y]: cuántos votos ponen a x arriba de y. */
  duelos: Record<string, Record<string, number>>;
}

export interface LecturaVotos {
  votos: Voto[];
  /** Lo que no se pudo leer o se leyó con dudas, para decírselo al juez. */
  avisos: string[];
  /** Nombres que aparecen en los votos y no son de nadie en la lista. */
  desconocidos: string[];
}

/** Sin acentos, sin mayúsculas y con un solo espacio entre palabras. */
const normal = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Lo que WhatsApp antepone a cada mensaje al copiarlo: «[11/11/26, 3:20 p. m.] »
 * en iPhone, «11/11/26, 15:20 - » en Android. Se quita antes de leer el voto.
 */
const PREFIJO_CHAT =
  /^\s*\[?\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s*m\.?)?\]?\s*(?:-\s*)?/i;

/** Un «1.», «2)» o «3.º» al principio es la numeración del voto, no parte del nombre. */
const MARCA = /^\s*(\d+)\s*[.)º°ª-]+\s*(?=\S)/;

/** Quita los huecos, los ids que ya no están y las repeticiones. */
function limpiar(orden: string[], validos: Set<string>): string[] {
  const out: string[] = [];
  for (const id of orden) if (id && validos.has(id) && !out.includes(id)) out.push(id);
  return out;
}

/**
 * Encuentra a quién se refiere un nombre escrito en un voto.
 *
 * Primero el nombre completo, sin importar acentos ni mayúsculas; luego el
 * número que tiene en la lista; luego una palabra suelta del nombre, como
 * «Ana» por «Ortega Ana», si solo hay una persona con ella.
 */
function reconocer(pieza: string, lista: Jugador[]): { id: string } | { error: string; nuevo?: boolean } {
  const p = normal(pieza.replace(MARCA, ""));
  if (!p) return { error: `«${pieza}» está vacío` };

  const exactos = lista.filter((j) =>
    [nombreDe(j), j.nombre, j.nombre2 ?? ""].some((s) => s.trim() && normal(s) === p),
  );
  if (exactos.length === 1) return { id: exactos[0].id };
  if (exactos.length > 1) return { error: `hay ${exactos.length} inscripciones que se llaman «${pieza}»` };

  const num = /^#?(\d+)$/.exec(p);
  if (num) {
    const k = Number(num[1]);
    return k >= 1 && k <= lista.length ? { id: lista[k - 1].id } : { error: `no hay número ${k} en la lista` };
  }

  const conPalabra = lista.filter((j) => ` ${normal(nombreDe(j))} `.includes(` ${p} `));
  if (conPalabra.length === 1) return { id: conPalabra[0].id };
  if (conPalabra.length > 1)
    return { error: `«${pieza}» puede ser ${conPalabra.map((j) => nombreDe(j)).join(" o ")}` };

  // Un principio de palabra, como «Fer» por «Fernanda», si no hay otro igual
  if (p.length >= 3) {
    const conInicio = lista.filter((j) => normal(nombreDe(j)).split(/[\s/]+/).some((w) => w.startsWith(p)));
    if (conInicio.length === 1) return { id: conInicio[0].id };
  }
  return { error: `«${pieza}» no está en la lista`, nuevo: true };
}

/**
 * Lee votos pegados como texto.
 *
 * La forma básica es un renglón por voto: «quien vota: primero, segundo,
 * tercero». Los nombres se pueden separar con coma, punto y coma, «>» o
 * tabulador, de modo que también entra lo copiado de una hoja de cálculo.
 * Sin dos puntos, la primera celda es quien vota si no es nadie de la
 * lista.
 *
 * También entra un voto en varios renglones, como suele llegar por
 * WhatsApp: «Juan:» y debajo «1. Carlo», «2. Juan», «3. David», hasta un
 * renglón en blanco o el siguiente «nombre:». Si todos los nombres de un
 * voto traen número, manda el número y no el orden en que se escribieron.
 * La fecha y la hora que WhatsApp pone al principio se ignoran.
 *
 * Los nombres que no son de nadie en la lista se devuelven aparte, en
 * `desconocidos`, para ofrecer inscribirlos. Si alguien vota dos veces
 * vale el último voto.
 */
export function leerVotos(texto: string, lista: Jugador[]): LecturaVotos {
  const n = lista.length;

  // 1. Juntar los renglones en votos sin interpretar todavía los nombres
  const crudos: Array<{ quien: string; piezas: string[]; renglon: string; abierto: boolean }> = [];
  let abierto: (typeof crudos)[number] | null = null;
  const avisos: string[] = [];

  texto.split(/\r?\n/).forEach((crudo, k) => {
    const linea = crudo.replace(PREFIJO_CHAT, "").trim();
    if (!linea) {
      abierto = null;
      return;
    }
    const renglon = `Renglón ${k + 1}`;
    const partir = (s: string) =>
      s
        .split(/[,;>|\t]+/)
        .map((x) => x.trim())
        .filter(Boolean);

    const dos = linea.indexOf(":");
    if (dos >= 0) {
      const resto = partir(linea.slice(dos + 1));
      abierto = { quien: linea.slice(0, dos).trim(), piezas: resto, renglon, abierto: !resto.length };
      crudos.push(abierto);
      return;
    }
    const piezas = partir(linea);
    // Un nombre suelto debajo de «Juan:» o de «Juan: 1. Carlo» sigue ese
    // voto, mientras le falten nombres
    if (abierto && (abierto.abierto || piezas.length === 1) && (n === 0 || abierto.piezas.length < n)) {
      abierto.piezas.push(...piezas);
      return;
    }
    abierto = null;
    // Sin dos puntos, la primera celda es quien vota si sobra un nombre, o si
    // ella no es de la lista y los demás sí. Con la lista vacía no se sabe, y
    // todos se toman como votados: así nadie se queda sin inscribir.
    const yaInscritos = piezas.slice(1).some((pz) => "id" in reconocer(pz, lista));
    if (n > 0 && piezas.length > 1 && (piezas.length > n || ("error" in reconocer(piezas[0], lista) && yaInscritos))) {
      crudos.push({ quien: piezas[0], piezas: piezas.slice(1), renglon, abierto: false });
    } else crudos.push({ quien: "", piezas, renglon, abierto: false });
  });

  // 2. Reconocer los nombres de cada voto
  const votos: Voto[] = [];
  const desconocidos: string[] = [];
  for (const c of crudos) {
    const { renglon } = c;
    // «p2 p1 p3»: separados solo por espacios, si cada palabra es alguien
    let piezas = c.piezas.flatMap((pz) => {
      if ("id" in reconocer(pz, lista)) return [pz];
      const palabras = pz.split(/\s+/);
      return palabras.length > 1 && palabras.every((w) => "id" in reconocer(w, lista)) ? palabras : [pz];
    });
    // «3. David, 1. Carlo, 2. Juan»: con número en todos, manda el número
    const numeros = piezas.map((pz) => MARCA.exec(pz)?.[1]);
    if (piezas.length > 1 && numeros.every(Boolean))
      piezas = piezas
        .map((pz, i) => ({ pz, k: Number(numeros[i]), i }))
        .sort((a, b) => a.k - b.k || a.i - b.i)
        .map((x) => x.pz);

    const orden: string[] = [];
    const dudas: string[] = [];
    const nuevos: string[] = [];
    for (const pz of piezas) {
      const r = reconocer(pz, lista);
      if ("error" in r) {
        if (r.nuevo) nuevos.push(capital(pz.replace(MARCA, "").trim()));
        else dudas.push(`${renglon}: ${r.error}.`);
        continue;
      }
      if (orden.includes(r.id)) {
        dudas.push(`${renglon}: ${nombreDe(lista.find((j) => j.id === r.id))} aparece dos veces; cuenta el lugar más alto.`);
        continue;
      }
      orden.push(r.id);
    }
    // Un solo nombre que nadie tiene («Juan: hola», un saludo) no es un voto
    if (piezas.length > 1)
      for (const x of nuevos) if (!desconocidos.some((d) => normal(d) === normal(x))) desconocidos.push(x);
    if (!orden.length) {
      if (piezas.length < 2 || !nuevos.length) avisos.push(`${renglon}: no se reconoció a nadie de la lista y se dejó fuera.`);
      continue;
    }
    avisos.push(...dudas);

    // Si quien vota está inscrito, su nombre se escribe como en la lista
    const inscrito = c.quien && lista.find((j) => normal(j.nombre) === normal(c.quien));
    const quien = (inscrito ? inscrito.nombre : c.quien) || `Voto ${votos.length + 1}`;
    const previo = votos.findIndex((v) => normal(v.quien) === normal(quien));
    if (previo >= 0) {
      avisos.push(`${quien} votó dos veces: vale el último.`);
      votos.splice(previo, 1);
    }
    if (orden.length < n && !nuevos.length) {
      const faltan = n - orden.length;
      avisos.push(
        `${renglon}: ${c.quien ? `al voto de ${quien}` : `al ${quien.toLowerCase()}`} le ${faltan === 1 ? "falta 1 nombre" : `faltan ${faltan} nombres`}; esos no reciben puntos de ese voto.`,
      );
    }
    votos.push({ quien, orden });
  }

  return { votos, avisos, desconocidos };
}

/** «juan pérez» → «Juan Pérez». Lo que ya trae mayúsculas se respeta. */
const capital = (s: string): string =>
  s === s.toLowerCase() ? s.replace(/(^|[\s/-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()) : s;

/**
 * Agrega votos a la tabla. Si alguien ya tenía voto, el nuevo lo reemplaza
 * en el mismo renglón.
 */
export function sumarVotos(tabla: Voto[], nuevos: Voto[]): { votos: Voto[]; reemplazados: string[] } {
  const votos = [...tabla];
  const reemplazados: string[] = [];
  for (const v of nuevos) {
    const i = votos.findIndex((x) => x.quien.trim() && normal(x.quien) === normal(v.quien));
    if (i >= 0) {
      votos[i] = v;
      reemplazados.push(v.quien);
    } else votos.push(v);
  }
  return { votos, reemplazados };
}

/**
 * Cuenta los votos y da el orden final.
 *
 * `lista` es la lista en el orden en que se ve: es el último desempate, de
 * modo que volver a contar después de aplicar el resultado da lo mismo.
 */
export function contarVotos(lista: Jugador[], votos: Voto[]): ConteoVotacion {
  const ids = lista.map((j) => j.id);
  const n = ids.length;
  const enLista = new Set(ids);
  const ordenes = votos.map((v) => limpiar(v.orden, enLista)).filter((o) => o.length > 0);
  const nom = (id: string) => nombreDe(lista.find((j) => j.id === id));
  const posLista = new Map(ids.map((id, k) => [id, k]));

  const puntos = new Map(ids.map((id) => [id, 0]));
  const veces = new Map(ids.map((id) => [id, new Array<number>(n).fill(0)]));
  const duelos: Record<string, Record<string, number>> = {};
  for (const x of ids) duelos[x] = Object.fromEntries(ids.map((y) => [y, 0]));

  for (const o of ordenes) {
    const lugar = new Map(o.map((id, k) => [id, k]));
    o.forEach((id, k) => {
      // Borda: el primer lugar vale n, el segundo n − 1, …, el último 1
      puntos.set(id, puntos.get(id)! + n - k);
      veces.get(id)![k]++;
    });
    for (const x of o)
      for (const y of ids) {
        const ly = lugar.get(y);
        // Estar en el voto le gana a no estar en él
        if (x !== y && (ly === undefined || lugar.get(x)! < ly)) duelos[x][y]++;
      }
  }

  /** Parte un grupo por un valor, del mayor al menor; los iguales quedan juntos. */
  const partir = (grupo: string[], valor: (id: string) => number[]): string[][] => {
    const cmp = (a: string, b: string) => {
      const va = valor(a);
      const vb = valor(b);
      for (let k = 0; k < va.length; k++) if (va[k] !== vb[k]) return vb[k] - va[k];
      return 0;
    };
    const ord = [...grupo].sort((a, b) => cmp(a, b) || posLista.get(a)! - posLista.get(b)!);
    const partes: string[][] = [];
    for (const id of ord) {
      const ultima = partes[partes.length - 1];
      if (ultima && cmp(ultima[0], id) === 0) ultima.push(id);
      else partes.push([id]);
    }
    return partes;
  };

  const nota = new Map<string, string>();
  const empatados = new Set<string>();

  /** Ordena a los que tienen los mismos puntos. */
  function desempatar(grupo: string[]): string[] {
    if (grupo.length < 2) return grupo;

    // 1. Duelos entre los empatados: cuántos de ellos le gana cada uno
    const ganados = (x: string) => grupo.filter((y) => y !== x && duelos[x][y] > duelos[y][x]).length;
    let partes = partir(grupo, (x) => [ganados(x)]);
    if (partes.length > 1) {
      for (const x of grupo) {
        if (grupo.length === 2) {
          const y = grupo.find((z) => z !== x)!;
          const marcador = `${duelos[x][y]}–${duelos[y][x]}`;
          nota.set(x, ganados(x) ? `le gana el duelo a ${nom(y)}, ${marcador}` : `pierde el duelo con ${nom(y)}, ${marcador}`);
        } else {
          const g = ganados(x);
          nota.set(x, `gana ${g} de ${grupo.length - 1} duelos entre los empatados`);
        }
      }
      return partes.flatMap(desempatar);
    }

    // 2. Más primeros lugares, luego más segundos, y así
    partes = partir(grupo, (x) => veces.get(x)!);
    if (partes.length > 1) {
      const k = veces.get(grupo[0])!.findIndex((_, i) => grupo.some((x) => veces.get(x)![i] !== veces.get(grupo[0])![i]));
      for (const x of grupo) {
        const c = veces.get(x)![k];
        nota.set(x, `${c} ${c === 1 ? "vez" : "veces"} en ${k + 1}.º lugar`);
      }
      return partes.flatMap(desempatar);
    }

    // 3. Nada los separa: queda el orden de la lista
    for (const x of grupo) {
      empatados.add(x);
      nota.set(x, "empate total: queda el orden de la lista");
    }
    return [...grupo].sort((a, b) => posLista.get(a)! - posLista.get(b)!);
  }

  const orden = partir(ids, (x) => [puntos.get(x)!]).flatMap(desempatar);

  const filas = orden.map((id, k): FilaVotacion => {
    const v = veces.get(id)!;
    const cuantos = v.reduce((s, c) => s + c, 0);
    const suma = v.reduce((s, c, i) => s + c * (i + 1), 0);
    return {
      id,
      lugar: k + 1,
      puntos: puntos.get(id)!,
      veces: v,
      promedio: cuantos ? suma / cuantos : null,
      desempate: nota.get(id) ?? "",
      empate: empatados.has(id),
    };
  });

  return { filas, validos: ordenes.length, duelos };
}

/**
 * Cuántos bloques de nivel se proponen para n inscritos.
 *
 * Que cada bloque tenga unos tres, para que haya partidos parejos sin
 * ventaja, y no más de cuatro: con más, la diferencia entre bloques
 * vecinos es tan chica que la ventaja de un punto ya no la refleja bien.
 */
export const bloquesSugeridos = (n: number): number => (n < 2 ? 1 : Math.max(2, Math.min(4, Math.floor(n / 3))));

/**
 * Parte una clasificación en k bloques de nivel por sus saltos naturales.
 *
 * `valores` va del mejor al peor (no crece): los puntos de la votación,
 * por ejemplo. Se busca, entre todas las formas de cortar la lista en k
 * tramos seguidos, la que hace mínima la suma de los cuadrados de las
 * distancias de cada valor al promedio de su tramo (Fisher, 1958; los
 * «cortes naturales» de Jenks). Así los cortes caen donde hay saltos
 * grandes y no entre dos casi empatados. Se resuelve por programación
 * dinámica en O(k·n²).
 *
 * Nunca se corta entre dos valores iguales: si no alcanza para k bloques,
 * salen menos. Devuelve el bloque de cada posición, contando desde 1.
 */
export function partirEnBloques(valores: number[], k: number): number[] {
  const n = valores.length;
  if (!n) return [];
  const sePuede = (j: number) => j === n || (j > 0 && valores[j - 1] !== valores[j]);
  let cortes = 0;
  for (let j = 1; j < n; j++) if (sePuede(j)) cortes++;
  const b = Math.max(1, Math.min(Math.floor(k) || 1, cortes + 1));

  // Sumas acumuladas: el costo de un tramo sale en tiempo constante
  const s = [0];
  const s2 = [0];
  for (const v of valores) {
    s.push(s[s.length - 1] + v);
    s2.push(s2[s2.length - 1] + v * v);
  }
  const costo = (i: number, j: number) => {
    const suma = s[j] - s[i];
    return s2[j] - s2[i] - (suma * suma) / (j - i);
  };

  // mejor[t][j]: costo mínimo de partir los primeros j en t tramos
  const mejor = Array.from({ length: b + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const desde = Array.from({ length: b + 1 }, () => new Array<number>(n + 1).fill(-1));
  mejor[0][0] = 0;
  for (let t = 1; t <= b; t++)
    for (let j = 1; j <= n; j++) {
      if (!sePuede(j)) continue;
      for (let i = t - 1; i < j; i++) {
        if (mejor[t - 1][i] === Infinity || (i > 0 && !sePuede(i))) continue;
        const c = mejor[t - 1][i] + costo(i, j);
        if (c < mejor[t][j] - 1e-9) {
          mejor[t][j] = c;
          desde[t][j] = i;
        }
      }
    }

  const bloque = new Array<number>(n).fill(1);
  for (let t = b, j = n; t >= 1; t--) {
    const i = desde[t][j];
    for (let x = i; x < j; x++) bloque[x] = t;
    j = i;
  }
  return bloque;
}

/**
 * Reparte la lista en k bloques, en el orden en que se ve.
 *
 * Si hay votación y la lista sigue en su orden, los cortes salen de sus
 * puntos; si no, del lugar en la lista, y entonces los bloques quedan del
 * mismo tamaño, o casi.
 */
export function repartirBloques(lista: Jugador[], votos: Voto[] | undefined, k: number): Map<string, number> {
  let valores = lista.map((_, i) => lista.length - i);
  if (votos?.length) {
    const puntos = new Map(contarVotos(lista, votos).filas.map((f) => [f.id, f.puntos]));
    const deVoto = lista.map((j) => puntos.get(j.id) ?? 0);
    if (deVoto.every((v, i) => i === 0 || v <= deVoto[i - 1])) valores = deVoto;
  }
  const bloques = partirEnBloques(valores, k);
  return new Map(lista.map((j, i) => [j.id, bloques[i]]));
}

/**
 * Silueta media de una partición (Rousseeuw, 1987), entre −1 y 1.
 *
 * Para cada jugador, a es su distancia media a los de su bloque y b la
 * distancia media al bloque vecino más cercano; su silueta es
 * (b − a) / max(a, b). Quien está solo en su bloque vale 0. Cerca de 1:
 * cada quien está mucho más cerca de su bloque que del siguiente.
 */
export function silueta(valores: number[], bloques: number[]): number {
  const n = valores.length;
  if (n < 2) return 0;
  const ks = [...new Set(bloques)];
  if (ks.length < 2) return 0;
  let suma = 0;
  for (let i = 0; i < n; i++) {
    const media = (b: number, sinMi: boolean) => {
      let s = 0;
      let c = 0;
      for (let j = 0; j < n; j++)
        if (bloques[j] === b && !(sinMi && j === i)) {
          s += Math.abs(valores[i] - valores[j]);
          c++;
        }
      return c ? s / c : NaN;
    };
    const a = media(bloques[i], true);
    if (Number.isNaN(a)) continue;
    const b = Math.min(...ks.filter((x) => x !== bloques[i]).map((x) => media(x, false)));
    const m = Math.max(a, b);
    suma += m > 0 ? (b - a) / m : 0;
  }
  return suma / n;
}

/** Una propuesta de número de bloques, con la razón para mostrarla. */
export interface PropuestaBloques {
  k: number;
  silueta: number;
  motivo: "silueta" | "regla" | "segunda";
}

/**
 * Las dos cantidades de bloques que se le proponen al juez.
 *
 * El número de bloques es un hiperparámetro: el costo de Fisher siempre
 * baja al agregar bloques, así que no sirve para elegirlo. La primera
 * propuesta es la k de mayor silueta, entre 2 y la mitad de los inscritos
 * (cada bloque con dos o más, en promedio), sin pasar de 6. La segunda es
 * la regla de unos tres por bloque; si coincide con la primera, la k con
 * la siguiente mejor silueta. El juez puede elegir cualquier otra, por
 * ejemplo 2 en un torneo de intermedios contra principiantes.
 */
export function proponerBloques(valores: number[]): PropuestaBloques[] {
  const n = valores.length;
  if (n < 3) return [{ k: Math.max(1, n === 2 ? 2 : 1), silueta: 0, motivo: "regla" }];
  const max = Math.max(2, Math.min(6, Math.floor(n / 2)));
  const opciones: Array<{ k: number; silueta: number }> = [];
  for (let k = 2; k <= max; k++) {
    const b = partirEnBloques(valores, k);
    const kReal = Math.max(...b);
    if (opciones.some((o) => o.k === kReal)) continue;
    opciones.push({ k: kReal, silueta: silueta(valores, b) });
  }
  const orden = [...opciones].sort((x, y) => y.silueta - x.silueta || x.k - y.k);
  const mejor = orden[0];
  const regla = bloquesSugeridos(n);
  const deRegla = opciones.find((o) => o.k === regla);
  if (deRegla && deRegla.k !== mejor.k) return [{ ...mejor, motivo: "silueta" }, { ...deRegla, motivo: "regla" }];
  const out: PropuestaBloques[] = [{ ...mejor, motivo: "silueta" }];
  if (orden[1]) out.push({ ...orden[1], motivo: "segunda" });
  return out;
}
