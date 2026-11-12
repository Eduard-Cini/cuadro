import type { Credencial, Evento, Lado, Modalidad, Tarjeta, Torneo } from "./nucleo";

export const LLAVE = "cuadro.v04";
export const LLAVE_VIEJA = "cuadro.v03";
export const LLAVE_ROL = "cuadro.rol";
export const LLAVE_MESA = "cuadro.mesa";
export const LLAVE_ARBITRO = "cuadro.arbitro";
export const LLAVE_DISPOSITIVO = "cuadro.dispositivo";
export const LLAVE_RELEVO = "cuadro.relevo";
export const LLAVE_CREDENCIAL = "cuadro.credencial";

export const LLAVE_ANOTADOR = "cuadro.anotador";

export type Rol = "juez" | "arbitro" | "pantalla" | "autogestion";

export const nuevoId = (): string =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

/**
 * Nombre de este dispositivo, estable entre recargas.
 *
 * Va en cada evento («quién lo anotó») y en cada paquete que sale a la
 * red. Cuando dos tablets discuten un marcador, esto es lo que permite
 * decir de cuál salió cada punto.
 */
export function idDispositivo(): string {
  const guardado = leer(LLAVE_DISPOSITIVO);
  if (guardado) return guardado;
  const id = `d-${nuevoId()}`;
  escribir(LLAVE_DISPOSITIVO, id);
  return id;
}

/**
 * Credencial de este dispositivo ante el relevo.
 *
 * Vive aquí y no en el torneo a propósito: el torneo se sincroniza con
 * todos, y un secreto que se reparte deja de serlo. Lo que sí conviene
 * tener claro es que esto se guarda sin cifrar, así que protege el canal,
 * no la tablet: quien tenga el aparato desbloqueado en la mano puede
 * anotar como su dueño. Contra eso vale el bloqueo de pantalla, no la
 * criptografía.
 */
export function leerCredencial(): Credencial | null {
  try {
    const crudo = leer(LLAVE_CREDENCIAL);
    if (!crudo) return null;
    const c = JSON.parse(crudo) as Credencial;
    return c?.token && c?.quien ? c : null;
  } catch {
    return null;
  }
}

export function guardarCredencial(c: Credencial | null): void {
  if (c) escribir(LLAVE_CREDENCIAL, JSON.stringify(c));
  else borrar(LLAVE_CREDENCIAL);
}

export const torneoVacio = (): Torneo => ({
  id: `t-${nuevoId()}`,
  revision: 1,
  nombre: "",
  sede: "",
  modalidad: "individual",
  reglamento: "personalizado",
  puntosSet: 11,
  sistema: "grupos",
  handicap: { activo: false, base: "ranking", escalon: 100, porLugar: 1, tope: 7 },
  siembraManual: false,
  mesas: 4,
  formatoGrupos: 2,
  formatoFinales: 3,
  nGrupos: 2,
  clasifican: 2,
  // Sin descanso entre sets de entrada: es lo habitual en un torneo
  // amateur. Al elegir «formal» pasa a ser el minuto del reglamento.
  descansoSet: 0,
  descansoJugador: 10,
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
});

/* ---------- eventos ---------- */

/**
 * Sello de cada evento: quién y cuándo.
 *
 * El identificador tiene que ser único entre dispositivos que no se
 * hablan. Si dos tablets generaran la misma llave para dos puntos
 * distintos, al sincronizar uno de los dos desaparecería sin que nadie se
 * enterara. Por eso lleva el dispositivo dentro, además del azar y del
 * reloj.
 */
const firma = (por: string) => ({ id: `${por}-${nuevoId()}`, ts: Date.now(), por });

export const punto = (j: Lado, por: string): Evento => ({ ...firma(por), t: "punto", j });
export const anula = (ref: string, por: string): Evento => ({ ...firma(por), t: "anula", ref });
export const reanuda = (por: string): Evento => ({ ...firma(por), t: "reanuda" });
export const cierra = (por: string): Evento => ({ ...firma(por), t: "cierra" });
export const valida = (por: string): Evento => ({ ...firma(por), t: "valida" });
export const inicia = (saque: Lado, invertido: boolean, por: string): Evento => ({
  ...firma(por),
  t: "inicia",
  saque,
  invertido,
});
export const corrige = (sets: Array<{ a: number; b: number }>, nota: string, por: string): Evento => ({
  ...firma(por),
  t: "corrige",
  sets,
  nota,
});
export const tiempo = (lado: Lado, por: string): Evento => ({ ...firma(por), t: "tiempo", lado });
export const elige = (fuente: string | null, nota: string, por: string): Evento => ({
  ...firma(por),
  t: "elige",
  fuente,
  nota,
});
export const resultado = (sets: Array<{ a: number; b: number }>, nota: string, por: string): Evento => ({
  ...firma(por),
  t: "resultado",
  sets,
  nota,
});
export const tarjeta = (
  lado: Lado,
  color: Tarjeta,
  puntos: 0 | 1 | 2,
  motivo: string,
  por: string,
): Evento => ({ ...firma(por), t: "tarjeta", lado, color, puntos, motivo });

/* ---------- persistencia ---------- */

/** El almacenamiento puede estar bloqueado; la app sigue en memoria. */
export function guardar(t: Torneo): void {
  try {
    localStorage.setItem(LLAVE, JSON.stringify(t));
  } catch {
    /* sin persistencia: el torneo vive mientras la pestaña esté abierta */
  }
}

export function cargar(): Torneo | null {
  try {
    const crudo = localStorage.getItem(LLAVE);
    if (crudo) return sanear(JSON.parse(crudo) as Torneo);
    const viejo = localStorage.getItem(LLAVE_VIEJA);
    return viejo ? migrar(JSON.parse(viejo)) : null;
  } catch {
    return null;
  }
}

/** Rellena lo que falte: una copia guardada puede ser de una versión previa. */
function sanear(t: Partial<Torneo>): Torneo {
  const base = torneoVacio();
  const out: Torneo = { ...base, ...t, id: t.id ?? base.id };
  out.handicap = { ...base.handicap!, ...(t.handicap ?? {}) };
  out.partidos = (out.partidos ?? []).map((p, i) => ({ ...p, orden: p.orden ?? i, eventos: p.eventos ?? [] }));
  return out;
}

/**
 * Convierte un torneo de la versión anterior.
 *
 * Antes el marcador era una lista de puntos sin identificador, y deshacer
 * era quitar el último. Cada punto recibe aquí una llave para poder
 * entrar en el registro nuevo sin perder ningún partido ya jugado.
 */
function migrar(viejo: Record<string, unknown>): Torneo {
  const t = sanear(viejo as Partial<Torneo>);
  t.partidos = t.partidos.map((p) => {
    const previo = p as unknown as { primeroSaque?: Lado; invertido?: boolean };
    const eventos: Evento[] = [];
    if (previo.primeroSaque || previo.invertido) {
      eventos.push({
        id: `mig-${p.id}-0`,
        t: "inicia",
        saque: previo.primeroSaque ?? "a",
        invertido: !!previo.invertido,
        ts: 1,
        por: "migración",
      });
    }
    p.eventos.forEach((ev, i) => {
      if (ev.t !== "punto") return;
      eventos.push({ id: `mig-${p.id}-${i + 1}`, t: "punto", j: ev.j, ts: ev.ts || i + 2, por: "migración" });
    });
    return { ...p, eventos };
  });
  return t;
}

export function leer(llave: string): string | null {
  try {
    return localStorage.getItem(llave);
  } catch {
    return null;
  }
}

export function escribir(llave: string, valor: string): void {
  try {
    localStorage.setItem(llave, valor);
  } catch {
    /* ignorado a propósito */
  }
}

export function borrar(llave: string): void {
  try {
    localStorage.removeItem(llave);
  } catch {
    /* ignorado a propósito */
  }
}

/* ---------- entrada y salida de datos ---------- */

/**
 * Convierte texto pegado o un CSV en inscripciones.
 *
 * Acepta coma, punto y coma o tabulador, y se salta el encabezado. Para
 * dobles y mixtos, los dos nombres de la pareja van en la primera columna
 * separados por una barra, un «+» o un «y»: así la misma lista de siempre
 * sirve para las cuatro categorías sin cambiar de formato.
 */
export function leerJugadores(
  texto: string,
): Array<{ nombre: string; nombre2: string; club: string; rank: number }> {
  const filas = texto.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const out: Array<{ nombre: string; nombre2: string; club: string; rank: number }> = [];

  filas.forEach((f, i) => {
    const c = f.split(/[,;\t]/).map((s) => s.trim().replace(/^"|"$/g, ""));
    const esEncabezado = i === 0 && /^(nombre|name|jugador|player|pareja)$/i.test(c[0] ?? "");
    if (esEncabezado) return;
    const crudo = c[0] ?? "";
    if (!crudo) return;
    const partes = crudo.split(/\s*(?:\/|\+|\by\b|&)\s*/i).filter(Boolean);
    out.push({
      nombre: partes[0] ?? crudo,
      nombre2: partes[1] ?? "",
      club: c[1] ?? "",
      rank: Number(c[2]) || 0,
    });
  });
  return out;
}

/** Descarga el torneo entero como archivo. Es el respaldo de la jornada. */
export function exportar(t: Torneo): void {
  const nombre = (t.nombre || "torneo").replace(/[^\w\d-]+/g, "-").toLowerCase();
  const fecha = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(t, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cuadro-${nombre}-${fecha}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Lo que una mesa autogestionada le manda al juez.
 *
 * Solo los partidos que anotó y solo sus eventos, no el torneo entero: el
 * torneo es del juez, y lo que viaja desde la mesa son hechos que se unen
 * a los suyos. Por eso aplicarlo dos veces no duplica nada.
 */
export interface EnvioResultados {
  tipo: "ttorneo-resultados";
  torneoId: string;
  torneoNombre: string;
  desde: string;
  fecha: number;
  partidos: Array<{ id: string; eventos: Evento[] }>;
}

/** `prefijo` identifica al aparato: lo anotado aquí empieza siempre así,
    aunque a media tarde cambie el nombre de quien anota. */
export function envioDe(t: Torneo, prefijo: string, desde: string): EnvioResultados {
  return {
    tipo: "ttorneo-resultados",
    torneoId: t.id,
    torneoNombre: t.nombre,
    desde,
    fecha: Date.now(),
    partidos: t.partidos
      .map((p) => ({ id: p.id, eventos: p.eventos.filter((e) => e.por.startsWith(prefijo)) }))
      .filter((x) => x.eventos.length > 0),
  };
}

/**
 * Entrega el envío: por la hoja de compartir del teléfono si la hay, que
 * es lo que deja mandarlo por WhatsApp o correo, y si no, como descarga.
 */
export async function compartirEnvio(e: EnvioResultados): Promise<"compartido" | "descargado"> {
  // La fecha local, no la UTC: un envío de las once de la noche tiene que
  // decir el día en que se jugó.
  const f = new Date(e.fecha);
  const dia = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
  const nombre = `resultados-${(e.torneoNombre || "torneo").replace(/[^\w\d-]+/g, "-").toLowerCase()}-${dia}.json`;
  const texto = JSON.stringify(e, null, 1);
  try {
    const archivo = new File([texto], nombre, { type: "application/json" });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.share && nav.canShare?.({ files: [archivo] })) {
      await nav.share({ files: [archivo], title: `Resultados de ${e.torneoNombre || "el torneo"}` });
      return "compartido";
    }
  } catch {
    /* sin hoja de compartir, o la cerraron: queda la descarga */
  }
  const url = URL.createObjectURL(new Blob([texto], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "descargado";
}

/** Un archivo que llega: o un torneo entero, o un envío de resultados. */
export function leerEntrante(texto: string): { torneo: Torneo } | { envio: EnvioResultados } {
  const d = JSON.parse(texto) as Record<string, unknown>;
  if (d && d.tipo === "ttorneo-resultados" && Array.isArray(d.partidos)) return { envio: d as unknown as EnvioResultados };
  return { torneo: importar(texto) };
}

/** Lee un archivo exportado. Lanza si no es un torneo. */
export function importar(texto: string): Torneo {
  const t = JSON.parse(texto) as Partial<Torneo>;
  if (!Array.isArray(t.partidos) || !Array.isArray(t.jugadores)) throw new Error("El archivo no es un torneo de TTorneo.");
  return sanear(t);
}

/* ============================================================
   ARCHIVO DE TORNEOS

   Una jornada tiene varias categorías: individual varonil, individual
   femenil, dobles, mixtos. Son torneos distintos —cada uno con su
   sorteo, su cuadro y su campeón— que comparten mesas, árbitros y tarde.

   El archivo guarda todos en el dispositivo de la mesa de control y deja
   uno *activo*: el activo es el que se ve, el que se sincroniza con el
   relevo y el que los árbitros tienen en la tablet. Cambiar de categoría
   es cambiar el activo; el anterior no se pierde, se guarda entero con
   todos sus eventos y vuelve igual cuando se le regresa.

   Que solo haya uno activo no es una limitación del almacenamiento sino
   una decisión: los árbitros tienen una mesa y una pantalla, y hacerles
   elegir entre dos torneos a media tarde es la clase de cosa que acaba
   con puntos anotados en el partido equivocado.
   ============================================================ */

export const LLAVE_ARCHIVO = "cuadro.archivo";

/** Lo que hace falta para pintar la lista sin cargar el torneo entero. */
export interface ResumenTorneo {
  id: string;
  nombre: string;
  sede: string;
  modalidad: Modalidad;
  jugadores: number;
  partidos: number;
  jugados: number;
  activo: boolean;
}

const leerArchivo = (): Record<string, Torneo> => {
  try {
    const crudo = leer(LLAVE_ARCHIVO);
    return crudo ? (JSON.parse(crudo) as Record<string, Torneo>) : {};
  } catch {
    return {};
  }
};

const escribirArchivo = (m: Record<string, Torneo>): void => {
  try {
    escribir(LLAVE_ARCHIVO, JSON.stringify(m));
  } catch {
    /* sin sitio: el archivo se queda como estaba */
  }
};

const resumir = (t: Torneo, activo: boolean): ResumenTorneo => ({
  id: t.id,
  nombre: t.nombre,
  sede: t.sede,
  modalidad: t.modalidad ?? "individual",
  jugadores: t.jugadores.length,
  partidos: t.partidos.filter((p) => p.aId && p.bId).length,
  jugados: t.partidos.filter((p) => p.eventos.some((e) => e.t === "cierra" || e.t === "valida")).length,
  activo,
});

/** Todos los torneos guardados, con el activo primero. */
export function listaTorneos(activo: Torneo): ResumenTorneo[] {
  const guardados = Object.values(leerArchivo()).filter((t) => t.id !== activo.id);
  return [resumir(activo, true), ...guardados.map((t) => resumir(t, false))];
}

/** ¿Vale la pena guardar esto, o es un torneo en blanco? */
export const tieneAlgo = (t: Torneo): boolean =>
  !!t.nombre.trim() || t.jugadores.length > 0 || t.partidos.length > 0;

/**
 * Cambia de categoría.
 *
 * Guarda el activo en el archivo antes de traer el otro, para que no se
 * pierda nada. Devuelve el torneo que pasa a estar activo, con la
 * revisión subida: el relevo se queda con el de número mayor, y sin esto
 * el torneo viejo volvería por la red en cuanto se sincronizara.
 */
export function abrirDelArchivo(activo: Torneo, id: string): Torneo | null {
  const m = leerArchivo();
  const entrante = m[id];
  if (!entrante) return null;
  delete m[id];
  if (tieneAlgo(activo)) m[activo.id] = activo;
  escribirArchivo(m);
  return { ...sanear(entrante), revision: Math.max(entrante.revision, activo.revision) + 1 };
}

/** Guarda el activo en el archivo y devuelve uno nuevo en blanco. */
export function archivarYEmpezar(activo: Torneo): Torneo {
  if (tieneAlgo(activo)) {
    const m = leerArchivo();
    m[activo.id] = activo;
    escribirArchivo(m);
  }
  return { ...torneoVacio(), revision: activo.revision + 1 };
}

/** Saca un torneo del archivo para siempre. Al activo no se le puede. */
export function borrarDelArchivo(id: string): void {
  const m = leerArchivo();
  delete m[id];
  escribirArchivo(m);
}

/** Mete un torneo cargado de un archivo en el estante, sin activarlo. */
export function guardarEnArchivo(t: Torneo): void {
  const m = leerArchivo();
  m[t.id] = sanear(t);
  escribirArchivo(m);
}

/** Uno guardado, entero. Sirve para descargarlo sin tener que activarlo. */
export function delArchivo(id: string): Torneo | null {
  const t = leerArchivo()[id];
  return t ? sanear(t) : null;
}
