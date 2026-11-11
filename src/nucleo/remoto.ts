import { setsDe } from "./asignacion";
import { etiquetaEtapa } from "./cuadro";
import { PUNTOS_SET, reducir, revisarParciales } from "./reglas";
import { nombreDe } from "./tipos";
import type { Evento, Lado, Partido, Torneo } from "./tipos";

/*
 * Torneo a distancia.
 *
 * Cuando el juez no puede estar en cada partido, el partido viaja en un
 * enlace y el resultado vuelve en un mensaje de WhatsApp. No hay servidor:
 * el enlace lleva todo lo que el tablero necesita (quiénes juegan y con qué
 * reglas) y el mensaje lleva un código con el que la mesa de control sabe
 * a qué partido pertenece el resultado.
 *
 * Los dos textos usan solo números y letras minúsculas sin i, l, o ni u
 * (base 32 de Crockford). Así WhatsApp no los convierte en cursivas ni en
 * tachados, y el enlace no se corta en un signo raro. Los cuatro últimos
 * caracteres son una suma de verificación: un código que llegó mocho o
 * con una letra cambiada se rechaza en vez de leerse mal.
 */

const ALFABETO = "0123456789abcdefghjkmnpqrstvwxyz";

/** Prefijo del código de resultado dentro del mensaje. */
export const PREFIJO_RESULTADO = "TT1-";

export function aBase32(bytes: Uint8Array): string {
  let out = "";
  let acum = 0;
  let bits = 0;
  for (const b of bytes) {
    acum = (acum << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALFABETO[(acum >>> (bits - 5)) & 31];
      bits -= 5;
    }
    acum &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALFABETO[(acum << (5 - bits)) & 31];
  return out;
}

/** Devuelve null si aparece un carácter que no es del alfabeto. */
export function deBase32(s: string): Uint8Array | null {
  const out: number[] = [];
  let acum = 0;
  let bits = 0;
  for (const c of s.toLowerCase()) {
    const v = ALFABETO.indexOf(c);
    if (v < 0) return null;
    acum = (acum << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((acum >>> (bits - 8)) & 255);
      bits -= 8;
    }
    acum &= (1 << bits) - 1;
  }
  return new Uint8Array(out);
}

/** FNV-1a de 32 bits, recortado a cuatro caracteres (20 bits). */
function suma(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += ALFABETO[h & 31];
    h >>>= 5;
  }
  return out;
}

/*
 * Los nombres llevan acentos y eñes. `btoa` truena con ellos, así que el
 * texto pasa primero a bytes UTF-8 y de ahí a base 32.
 */
function empacar(datos: unknown[]): string {
  const cuerpo = aBase32(new TextEncoder().encode(JSON.stringify(datos)));
  return cuerpo + suma(cuerpo);
}

function desempacar(codigo: string): unknown[] | null {
  const s = codigo.trim().toLowerCase();
  if (s.length < 6) return null;
  const cuerpo = s.slice(0, -4);
  if (suma(cuerpo) !== s.slice(-4)) return null;
  const bytes = deBase32(cuerpo);
  if (!bytes) return null;
  try {
    const d: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return Array.isArray(d) ? d : null;
  } catch {
    return null;
  }
}

const esTexto = (x: unknown): x is string => typeof x === "string";
const esEntero = (x: unknown, min: number, max: number): x is number =>
  typeof x === "number" && Number.isInteger(x) && x >= min && x <= max;

/* ============================================================
   EL ENLACE DEL PARTIDO
   ============================================================ */

/** Lo que el tablero de los jugadores necesita saber del partido. */
export interface PartidoRemoto {
  torneoId: string;
  torneo: string;
  partidoId: string;
  /** «Grupo A», «Jornada 2», «Cuartos de final»… */
  etapa: string;
  a: { id: string; nombre: string };
  b: { id: string; nombre: string };
  setsPara: number;
  /** Puntos por set. */
  meta: number;
  ventaja?: { lado: Lado; puntos: number };
  /** Minutos de descanso entre sets. */
  descanso: number;
}

/** Null si al partido todavía le falta un jugador. */
export function partidoRemoto(t: Torneo, p: Partido): PartidoRemoto | null {
  if (!p.aId || !p.bId) return null;
  return {
    torneoId: t.id,
    torneo: t.nombre,
    partidoId: p.id,
    etapa: etiquetaEtapa(t, p),
    a: { id: p.aId, nombre: nombreDe(t.jugadores.find((j) => j.id === p.aId)) },
    b: { id: p.bId, nombre: nombreDe(t.jugadores.find((j) => j.id === p.bId)) },
    setsPara: setsDe(t, p),
    meta: p.meta ?? PUNTOS_SET,
    ventaja: p.ventaja && p.ventaja.puntos > 0 ? { lado: p.ventaja.lado, puntos: p.ventaja.puntos } : undefined,
    descanso: t.descansoSet,
  };
}

export function codificarPartido(pr: PartidoRemoto): string {
  return empacar([
    1,
    pr.torneoId,
    pr.torneo,
    pr.partidoId,
    pr.etapa,
    pr.a.id,
    pr.a.nombre,
    pr.b.id,
    pr.b.nombre,
    pr.setsPara,
    pr.meta,
    pr.ventaja?.lado ?? "",
    pr.ventaja?.puntos ?? 0,
    pr.descanso,
  ]);
}

/** Lee el código del enlace. Null si llegó incompleto o alterado. */
export function leerPartido(codigo: string): PartidoRemoto | null {
  const d = desempacar(codigo);
  if (!d || d[0] !== 1 || d.length < 14) return null;
  const [, torneoId, torneo, partidoId, etapa, aId, aNom, bId, bNom, setsPara, meta, vl, vp, descanso] = d;
  if (!esTexto(torneoId) || !torneoId || !esTexto(partidoId) || !partidoId) return null;
  if (!esTexto(aId) || !aId || !esTexto(bId) || !bId) return null;
  if (!esTexto(torneo) || !esTexto(etapa) || !esTexto(aNom) || !esTexto(bNom)) return null;
  if (!esEntero(setsPara, 1, 4) || !esEntero(meta, 3, 99)) return null;
  if (vl !== "" && vl !== "a" && vl !== "b") return null;
  if (!esEntero(vp, 0, meta - 2)) return null;
  if (typeof descanso !== "number" || !(descanso >= 0 && descanso <= 15)) return null;
  return {
    torneoId,
    torneo,
    partidoId,
    etapa,
    a: { id: aId, nombre: aNom },
    b: { id: bId, nombre: bNom },
    setsPara,
    meta,
    ventaja: vl && vp > 0 ? { lado: vl, puntos: vp } : undefined,
    descanso,
  };
}

/** `origen` es la dirección de la aplicación, terminada en «/». */
export const enlaceDe = (origen: string, pr: PartidoRemoto): string => `${origen}#jugar=${codificarPartido(pr)}`;

/** Texto para el grupo de WhatsApp con el enlace de cada partido. */
export function textoDeEnlaces(t: Torneo, partidos: Partido[], origen: string): string {
  const lineas = [`${t.nombre || "Torneo"}: enlaces para anotar`, "Busca tu partido, lleven el marcador y al terminar mándenme el resultado con el botón de WhatsApp."];
  let etapa = "";
  for (const p of partidos) {
    const pr = partidoRemoto(t, p);
    if (!pr) continue;
    if (pr.etapa !== etapa) {
      etapa = pr.etapa;
      lineas.push("", etapa);
    }
    lineas.push(`${pr.a.nombre} vs ${pr.b.nombre}`, enlaceDe(origen, pr));
  }
  return lineas.join("\n");
}

/* ============================================================
   EL RESULTADO DE VUELTA
   ============================================================ */

export type Sets = Array<{ a: number; b: number }>;

export interface ResultadoRemoto {
  torneoId: string;
  partidoId: string;
  aId: string;
  bId: string;
  aNombre: string;
  bNombre: string;
  sets: Sets;
  /** Cuándo terminó el partido, en milisegundos. */
  ts: number;
  /** El código tal como llegó, en minúsculas y sin el prefijo. */
  codigo: string;
}

export function codificarResultado(pr: PartidoRemoto, sets: Sets, ts: number): string {
  return (
    PREFIJO_RESULTADO +
    empacar([
      1,
      pr.torneoId,
      pr.partidoId,
      pr.a.id,
      pr.b.id,
      sets.map((s) => `${s.a}-${s.b}`).join(","),
      Math.round(ts / 1000),
      pr.a.nombre,
      pr.b.nombre,
    ])
  );
}

const setsComoTexto = (sets: Sets): string => sets.map((s) => `${s.a}-${s.b}`).join(", ");

const ganados = (sets: Sets) => ({
  a: sets.filter((s) => s.a > s.b).length,
  b: sets.filter((s) => s.b > s.a).length,
});

/** El mensaje que los jugadores mandan por WhatsApp. */
export function mensajeResultado(pr: PartidoRemoto, sets: Sets, ts: number): string {
  const g = ganados(sets);
  return [
    `Resultado de ${pr.torneo || "el torneo"}`,
    `${pr.etapa}: ${pr.a.nombre} ${g.a}-${g.b} ${pr.b.nombre}`,
    `Sets: ${setsComoTexto(sets)}`,
    codificarResultado(pr, sets, ts),
  ].join("\n");
}

function leerResultado(codigo: string): ResultadoRemoto | null {
  const d = desempacar(codigo);
  if (!d || d[0] !== 1 || d.length < 9) return null;
  const [, torneoId, partidoId, aId, bId, crudo, seg, aNombre, bNombre] = d;
  if (!esTexto(torneoId) || !esTexto(partidoId) || !esTexto(aId) || !esTexto(bId) || !esTexto(crudo)) return null;
  if (!esTexto(aNombre) || !esTexto(bNombre) || typeof seg !== "number") return null;
  const sets: Sets = [];
  for (const parte of crudo.split(",")) {
    const m = /^(\d{1,3})-(\d{1,3})$/.exec(parte);
    if (!m) return null;
    sets.push({ a: Number(m[1]), b: Number(m[2]) });
  }
  return { torneoId, partidoId, aId, bId, aNombre, bNombre, sets, ts: seg * 1000, codigo: codigo.toLowerCase() };
}

/**
 * Busca todos los códigos de resultado en un texto pegado.
 *
 * Acepta uno o varios mensajes juntos, con lo que WhatsApp les pone
 * delante al copiarlos (hora, nombre). El mismo código dos veces cuenta
 * una sola. `dañados` son los que se ven como código pero no pasan la
 * suma de verificación.
 */
export function buscarResultados(texto: string): { resultados: ResultadoRemoto[]; dañados: number } {
  const resultados: ResultadoRemoto[] = [];
  const vistos = new Set<string>();
  let dañados = 0;
  for (const m of texto.matchAll(/TT1-([0-9a-z]+)/gi)) {
    const codigo = m[1].toLowerCase();
    if (vistos.has(codigo)) continue;
    vistos.add(codigo);
    const r = leerResultado(codigo);
    if (r) resultados.push(r);
    else dañados++;
  }
  return { resultados, dañados };
}

/* ============================================================
   LO QUE HACE LA MESA DE CONTROL CON CADA RESULTADO
   ============================================================ */

export type Revision =
  | { tipo: "nuevo"; partidoId: string; eventos: Evento[]; lectura: string }
  | { tipo: "repetido"; lectura: string; motivo: string }
  | { tipo: "error"; lectura: string; motivo: string };

const mismosSets = (x: Sets, y: Sets) => x.length === y.length && x.every((s, i) => s.a === y[i].a && s.b === y[i].b);

/**
 * Decide qué hacer con un resultado que llegó por mensaje.
 *
 * Solo entra si es de este torneo, el partido sigue existiendo con los
 * mismos jugadores y los parciales son posibles. Si el partido ya tenía
 * resultado no se pisa: si es el mismo, se avisa que ya estaba; si es
 * otro, se avisa para que el juez decida, porque lo más probable es que
 * los dos jugadores hayan mandado cosas distintas.
 *
 * Lo que entra lleva un identificador sacado del código, así que pegar
 * dos veces el mismo mensaje no duplica nada. El juez lo registra y lo
 * acepta en el mismo gesto: pegarlo ya es haberlo revisado.
 */
export function revisarResultado(t: Torneo, r: ResultadoRemoto, quien: string): Revision {
  const g = ganados(r.sets);
  const lectura = `${r.aNombre} ${g.a}-${g.b} ${r.bNombre} (${setsComoTexto(r.sets)})`;
  const error = (motivo: string): Revision => ({ tipo: "error", lectura, motivo });

  if (r.torneoId !== t.id) return error("Es de otro torneo. Abre ese torneo y vuelve a pegarlo.");
  const p = t.partidos.find((x) => x.id === r.partidoId);
  if (!p) return error("Ese partido ya no está en el torneo; quizá se rehízo el sorteo o el cuadro.");
  if (p.aId !== r.aId || p.bId !== r.bId)
    return error("Ese partido ahora lo juegan otras personas; quizá se rehízo el sorteo o el cuadro.");

  const setsPara = setsDe(t, p);
  const mal = revisarParciales(r.sets, setsPara, p.meta ?? PUNTOS_SET);
  if (mal) return error(mal);

  const st = reducir(p, setsPara);
  if (st.terminado) {
    return mismosSets(st.historial, r.sets)
      ? { tipo: "repetido", lectura, motivo: "Ya estaba registrado." }
      : error(
          `Ese partido ya tiene otro resultado (${setsComoTexto(st.historial)}). Si el bueno es este, corrígelo en Resultados.`,
        );
  }

  const id = `remoto-${p.id}-${suma(r.codigo)}`;
  return {
    tipo: "nuevo",
    partidoId: p.id,
    lectura,
    eventos: [
      { id, t: "resultado", sets: r.sets.map((s) => ({ ...s })), nota: "Lo mandaron los jugadores por mensaje", ts: r.ts, por: quien },
      { id: `${id}-v`, t: "valida", ts: r.ts, por: quien },
    ],
  };
}

/**
 * Revisa varios resultados como si se aplicaran en orden.
 *
 * Si en lo pegado vienen dos resultados del mismo partido, el segundo se
 * revisa contra el primero ya puesto: así se ve si los dos jugadores
 * mandaron lo mismo o no.
 */
export function revisarResultados(t: Torneo, rs: ResultadoRemoto[], quien: string): Revision[] {
  const copia = structuredClone(t) as Torneo;
  return rs.map((r) => {
    const rev = revisarResultado(copia, r, quien);
    if (rev.tipo === "nuevo") copia.partidos.find((p) => p.id === rev.partidoId)!.eventos.push(...rev.eventos);
    return rev;
  });
}

/**
 * El juez escribe el resultado que vio en una captura.
 *
 * Es el camino de respaldo, para cuando los jugadores usaron otro
 * marcador o no pudieron mandar el mensaje. Se registra y se acepta de
 * una vez, con una nota que dice de dónde salió.
 */
export function registroDesdeCaptura(
  t: Torneo,
  p: Partido,
  sets: Sets,
  quien: string,
  ts = Date.now(),
): { error: string } | { eventos: Evento[] } {
  const mal = revisarParciales(sets, setsDe(t, p), p.meta ?? PUNTOS_SET);
  if (mal) return { error: mal };
  const id = `captura-${p.id}-${ts}`;
  return {
    eventos: [
      { id, t: "resultado", sets: sets.map((s) => ({ ...s })), nota: "Registrado desde una captura", ts, por: quien },
      { id: `${id}-v`, t: "valida", ts, por: quien },
    ],
  };
}
