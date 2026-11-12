import { DE_JUEGO, ordenar, reducir } from "./reglas";
import { setsDe } from "./asignacion";
import type { Lado, Partido, Torneo } from "./tipos";

/*
 * Qué hizo cada quien, leído del registro de eventos.
 *
 * El acta no puede fiarse de la mesa ni del árbitro que tenía asignado el
 * partido: al validarlo, el juez libera la mesa y ese dato se borra. Lo que
 * no se borra nunca es el registro, y cada evento lleva quién lo anotó. De
 * ahí salen quién dirigió cada partido, cuántos puntos anotó cada árbitro y
 * qué se deshizo, con su hora.
 */


export interface Autor {
  /** Lo que va en `por` de cada evento. */
  por: string;
  tipo: "arbitro" | "juez" | "autogestion" | "aparato";
  nombre: string;
  /** Mesa del árbitro, si es uno de la lista. */
  mesa?: number;
}

/** Quién es el autor de un evento, dicho como lo diría el acta. */
export function autorDe(t: Pick<Torneo, "arbitros">, por: string): Autor {
  if (por === "juez") return { por, tipo: "juez", nombre: "Mesa de control" };
  const a = t.arbitros.find((x) => x.id === por);
  if (a) return { por, tipo: "arbitro", nombre: a.nombre, mesa: a.mesa };
  if (por.startsWith("autogestion:")) {
    const nombre = por.split(":").slice(2).join(":");
    return { por, tipo: "autogestion", nombre: `Mesa autogestionada · ${nombre || "sin nombre"}` };
  }
  return { por, tipo: "aparato", nombre: `Tablet sin alta (${por.slice(0, 10)})` };
}

/**
 * Quién llevó el marcador de un partido.
 *
 * El que más eventos de juego anotó en él. Si nadie anotó nada de juego
 * —un resultado que solo escribió la mesa de control—, es la mesa de
 * control. Null si el partido no tiene nada.
 */
export function quienDirigio(t: Pick<Torneo, "arbitros">, p: Partido): Autor | null {
  const cuenta = new Map<string, number>();
  for (const ev of p.eventos) if (DE_JUEGO.has(ev.t)) cuenta.set(ev.por, (cuenta.get(ev.por) ?? 0) + 1);
  if (!cuenta.size) return p.eventos.some((e) => e.por === "juez") ? autorDe(t, "juez") : null;
  const [por] = [...cuenta.entries()].sort((x, y) => y[1] - x[1])[0];
  return autorDe(t, por);
}

/** En qué mesa se jugó: la de ahora, la que quedó anotada al validar, o la de su árbitro. */
export function mesaDondeSeJugo(t: Pick<Torneo, "arbitros">, p: Partido): number {
  return p.mesa || p.jugadaEn || quienDirigio(t, p)?.mesa || 0;
}

export interface Deshecho {
  partidoId: string;
  /** Qué se deshizo. */
  que: "punto" | "tarjeta" | "tiempo" | "reanuda" | "otro";
  /** A favor de quién era el punto, o a quién iba la tarjeta o el tiempo. */
  lado: Lado | null;
  /** Cuándo se había anotado y cuándo se deshizo. */
  anotado: number;
  deshecho: number;
  /** Quién lo deshizo. */
  por: string;
  /** Set y marcador justo después de aquello que se deshizo. */
  set: number;
  marcador: { a: number; b: number };
}

/**
 * Todo lo que se deshizo en un partido, en orden.
 *
 * Para cada deshacer se busca el evento que anuló y se calcula cómo iba el
 * partido justo después de él: «punto para Ana con 7–5 en el set 2,
 * deshecho 20 segundos después». Es lo que permite revisar un reclamo
 * sin tener el registro crudo delante.
 */
export function deshechosDe(t: Torneo, p: Partido): Deshecho[] {
  const eventos = ordenar(p.eventos);
  const porId = new Map(eventos.map((e) => [e.id, e] as const));
  const out: Deshecho[] = [];
  for (const ev of eventos) {
    if (ev.t !== "anula") continue;
    const objetivo = porId.get(ev.ref);
    if (!objetivo) continue;
    // Cómo iba el partido justo después del evento que se deshizo: todos
    // los anteriores a él, él incluido, sin este deshacer ni los que vengan.
    const hasta = eventos.slice(0, eventos.indexOf(objetivo) + 1);
    const st = reducir({ ...p, eventos: hasta }, setsDe(t, p));
    const ultimo = st.historial[st.historial.length - 1];
    // Si ese punto cerró un set, el marcador que importa es el del set cerrado.
    const cerroSet = objetivo.t === "punto" && st.pa === st.ventaja.a && st.pb === st.ventaja.b && !!ultimo;
    const que =
      objetivo.t === "punto" || objetivo.t === "tarjeta" || objetivo.t === "tiempo" || objetivo.t === "reanuda"
        ? objetivo.t
        : "otro";
    out.push({
      partidoId: p.id,
      que,
      lado: "j" in objetivo ? objetivo.j : "lado" in objetivo ? objetivo.lado : null,
      anotado: objetivo.ts,
      deshecho: ev.ts,
      por: ev.por,
      set: cerroSet ? st.historial.length : st.historial.length + 1,
      marcador: cerroSet ? { a: ultimo.a, b: ultimo.b } : { a: st.pa, b: st.pb },
    });
  }
  return out;
}

export interface Actividad {
  autor: Autor;
  partidos: number;
  puntos: number;
  deshechos: number;
  tarjetas: number;
  tiempos: number;
}

/**
 * Lo que hizo cada quien en toda la jornada.
 *
 * Primero los árbitros de la lista, por mesa, aunque no hayan anotado nada:
 * el acta tiene que decir también quién estuvo y no dirigió. Después,
 * cualquier otro que haya llevado algún marcador: la mesa de control, una
 * mesa autogestionada o una tablet sin alta.
 */
export function actividadPorAutor(t: Torneo): Actividad[] {
  const filas = new Map<string, Actividad>();
  const fila = (por: string) => {
    let f = filas.get(por);
    if (!f) filas.set(por, (f = { autor: autorDe(t, por), partidos: 0, puntos: 0, deshechos: 0, tarjetas: 0, tiempos: 0 }));
    return f;
  };
  for (const a of [...t.arbitros].sort((x, y) => x.mesa - y.mesa)) fila(a.id);

  for (const p of t.partidos) {
    for (const ev of p.eventos) {
      if (!DE_JUEGO.has(ev.t)) continue;
      const f = fila(ev.por);
      if (ev.t === "punto") f.puntos++;
      else if (ev.t === "anula") f.deshechos++;
      else if (ev.t === "tarjeta") f.tarjetas++;
      else if (ev.t === "tiempo") f.tiempos++;
    }
    const quien = quienDirigio(t, p);
    if (quien && reducir(p, setsDe(t, p)).terminado) fila(quien.por).partidos++;
  }
  return [...filas.values()].filter((f) => f.autor.tipo === "arbitro" || f.partidos || f.puntos || f.deshechos);
}
