import { ordenar } from "./reglas";
import type { Evento, Partido, Torneo } from "./tipos";

/**
 * Unión de dos registros de eventos.
 *
 * Los eventos se identifican con una llave propia, así que juntar dos
 * listas es unir dos conjuntos: da igual el orden en que lleguen y da
 * igual que lleguen repetidos. Esa propiedad —conmutativa, asociativa e
 * idempotente— es la que permite sincronizar sin coordinar: dos tablets
 * que se han visto los mismos eventos, en cualquier orden, muestran el
 * mismo marcador. Sin ella habría que decidir quién manda, y en un
 * gimnasio sin red eso no se puede decidir.
 */
export function unirEventos(a: Evento[], b: Evento[]): Evento[] {
  const m = new Map<string, Evento>();
  for (const ev of a) m.set(ev.id, ev);
  for (const ev of b) if (!m.has(ev.id)) m.set(ev.id, ev);
  return ordenar([...m.values()]);
}

export interface ResumenUnion {
  /** Eventos que no estaban y ahora sí. */
  eventosNuevos: number;
  /** Partidos a los que les entró algo. */
  partidosTocados: number;
  /** De quién se tomó la estructura: configuración, listas, sorteo. */
  estructura: "local" | "remoto";
  /** Falso si son torneos distintos y no hay nada que unir. */
  compatible: boolean;
}

/**
 * Une dos copias del mismo torneo.
 *
 * El reparto de autoridad no es simétrico, porque el torneo tampoco lo es:
 *
 *  - La **estructura** —configuración, jugadores, árbitros, sorteo, cuadro,
 *    qué partido va en qué mesa— la fija el juez, y viaja con un número de
 *    revisión. Gana la revisión más alta. Así el juez puede rehacer el
 *    sorteo sin que la copia vieja de una tablet lo resucite.
 *  - Los **eventos** de cada partido los produce el árbitro de esa mesa y
 *    se unen siempre, sin que nadie gane: son hechos, no opiniones.
 *
 * Los eventos de partidos que la estructura ganadora ya no contempla se
 * quedan fuera a propósito. Si el juez rehízo el sorteo, los partidos del
 * sorteo anterior dejaron de existir y sus puntos no deben reaparecer.
 */
export function unir(local: Torneo, remoto: Torneo): { torneo: Torneo; resumen: ResumenUnion } {
  if (local.id && remoto.id && local.id !== remoto.id) {
    // Una tablet recién instalada trae un torneo vacío con identificador
    // propio. Sin esta salida, la primera vez que un árbitro se conecta
    // el sistema le negaría el torneo del juez por no reconocerlo, que
    // es justo el caso más común y el peor momento para fallar.
    if (estaVacio(local)) {
      return {
        torneo: remoto,
        resumen: { eventosNuevos: totalEventos(remoto), partidosTocados: remoto.partidos.length, estructura: "remoto", compatible: true },
      };
    }
    if (estaVacio(remoto)) {
      return {
        torneo: local,
        resumen: { eventosNuevos: 0, partidosTocados: 0, estructura: "local", compatible: true },
      };
    }
    return {
      torneo: local,
      resumen: { eventosNuevos: 0, partidosTocados: 0, estructura: "local", compatible: false },
    };
  }

  const mandaRemoto = remoto.revision > local.revision;
  const base = mandaRemoto ? remoto : local;
  const otro = mandaRemoto ? local : remoto;

  const eventosDe = new Map<string, Evento[]>();
  for (const p of otro.partidos) eventosDe.set(p.id, p.eventos);

  let eventosNuevos = 0;
  let partidosTocados = 0;

  const partidos: Partido[] = base.partidos.map((p) => {
    const extra = eventosDe.get(p.id);
    if (!extra || !extra.length) return { ...p, eventos: ordenar(p.eventos) };
    const antes = p.eventos.length;
    const eventos = unirEventos(p.eventos, extra);
    const nuevos = eventos.length - antes;
    if (nuevos > 0) {
      eventosNuevos += nuevos;
      partidosTocados++;
    }
    return { ...p, eventos };
  });

  return {
    torneo: { ...base, partidos },
    resumen: {
      eventosNuevos,
      partidosTocados,
      estructura: mandaRemoto ? "remoto" : "local",
      compatible: true,
    },
  };
}

/**
 * Lo que un árbitro le manda a la mesa de control.
 *
 * Solo sus partidos y solo sus eventos: en una red de gimnasio, con seis
 * tablets sobre un punto de acceso doméstico, mandar el torneo entero cada
 * vez que alguien anota un punto es lo que hace que el sistema se caiga
 * justo cuando más se usa.
 */
export interface Paquete {
  torneoId: string;
  /** Revisión de la estructura con la que trabajaba quien lo manda. */
  revision: number;
  /** Quién lo manda: identificador del dispositivo o del árbitro. */
  desde: string;
  partidos: Array<{ id: string; eventos: Evento[] }>;
}

/** Arma el paquete de un árbitro: los partidos de su mesa con actividad. */
export function paqueteDe(t: Torneo, desde: string, ids?: string[]): Paquete {
  const cuales = t.partidos.filter((p) => (ids ? ids.includes(p.id) : p.eventos.length > 0));
  return {
    torneoId: t.id,
    revision: t.revision,
    desde,
    partidos: cuales.map((p) => ({ id: p.id, eventos: p.eventos })),
  };
}

/**
 * Mete un paquete en el torneo. Devuelve cuántos eventos eran nuevos.
 *
 * Aplicar dos veces el mismo paquete no cambia nada, que es justo lo que
 * hace falta cuando la respuesta se pierde y la tablet reintenta.
 */
export function aplicarPaquete(t: Torneo, paq: Paquete): number {
  if (t.id && paq.torneoId && t.id !== paq.torneoId) return 0;
  let nuevos = 0;
  for (const entrada of paq.partidos) {
    const p = t.partidos.find((x) => x.id === entrada.id);
    if (!p) continue;
    const antes = p.eventos.length;
    p.eventos = unirEventos(p.eventos, entrada.eventos);
    nuevos += p.eventos.length - antes;
  }
  return nuevos;
}

/**
 * Un torneo sin jugadores ni partidos no tiene identidad que proteger.
 *
 * Distinguirlo importa para no confundir dos situaciones que se ven
 * iguales: un dispositivo que todavía no tiene nada, y un dispositivo con
 * un torneo distinto del que hay en el relevo. Al primero hay que darle
 * el torneo; al segundo hay que avisarle.
 */
export const estaVacio = (t: Torneo): boolean => !t.jugadores.length && !t.partidos.length;

/** Cuántos eventos hay en total. Sirve para ver de un vistazo si algo entró. */
export const totalEventos = (t: Torneo): number => t.partidos.reduce((n, p) => n + p.eventos.length, 0);
