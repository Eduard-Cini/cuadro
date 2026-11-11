import { MINUTO, setsDe } from "./asignacion";
import { reducir, setsRestantes } from "./reglas";
import type { Partido, Torneo } from "./tipos";

/** Sets que se espera que dure un partido al mejor de `2·setsPara−1`. */
const setsEsperados = (setsPara: number): number => setsPara + (setsPara - 1) * 0.7;

export interface Ritmo {
  /** Minutos que tarda un set, en este torneo y con esta gente. */
  porSet: number;
  /**
   * Sets que dura un partido de verdad, medido.
   *
   * Se mide en vez de suponerse porque la diferencia se nota: al mejor de
   * tres, suponer 2.7 sets cuando en la mesa todos se están resolviendo en
   * dos infla cada estimación un treinta por ciento, y el jugador que mira
   * la pantalla llega tarde o espera de más.
   */
  setsPorPartido: number;
  /** De cuántos partidos terminados salió el dato. */
  medidos: number;
  /** Si es falso, viene del supuesto y no de la mesa. */
  medido: boolean;
  /** Cuántos se descartaron por tener tiempos que no son de juego. */
  descartados: number;
}

/**
 * Lo que puede durar un set de verdad, en minutos.
 *
 * Fuera de esta horquilla no se está midiendo un set: se está midiendo un
 * partido que quedó abierto mientras el árbitro se iba a comer, o uno que
 * alguien capturó de golpe al final desde el papel. Meter esos tiempos en
 * la cuenta desplaza la estimación de toda la tarde, y el jugador que mira
 * la pantalla se fía de un número inventado.
 */
const SET_MINIMO = 1.5;
const SET_MAXIMO = 20;

/**
 * Cuánto tarda un set aquí.
 *
 * Al principio no hay nada medido y se usa el supuesto del torneo. En
 * cuanto empiezan a cerrar partidos, el sistema mide y se corrige solo:
 * un torneo infantil y uno de primera fuerza no tienen el mismo ritmo, y
 * la estimación que ve el jugador solo sirve si sigue al torneo real.
 *
 * Se toma la mediana y no el promedio a propósito: un partido que el
 * árbitro dejó abierto durante la comida arrastraría el promedio hasta
 * volver inservible el resto de la tabla.
 */
/** La mediana de una lista, que aguanta mejor un valor disparatado. */
function mediana(xs: number[]): number {
  const v = [...xs].sort((a, b) => a - b);
  const n = v.length;
  return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
}

export function ritmo(t: Torneo): Ritmo {
  const porSets: number[] = [];
  const sets: number[] = [];
  let descartados = 0;

  for (const p of t.partidos) {
    const st = reducir(p, setsDe(t, p));
    if (!st.terminado || st.desde === null || st.hasta === null) continue;
    const cuantos = st.historial.length;
    if (cuantos < 1) continue;
    const porSet = (st.hasta - st.desde) / cuantos / MINUTO;
    if (porSet >= SET_MINIMO && porSet <= SET_MAXIMO) {
      porSets.push(porSet);
      sets.push(cuantos);
    } else descartados++;
  }

  const supuesto = Math.max(1, t.duracionSupuesta) / setsEsperados(t.formatoGrupos);
  if (porSets.length < 3) {
    return {
      porSet: supuesto,
      setsPorPartido: setsEsperados(t.formatoGrupos),
      medidos: porSets.length,
      medido: false,
      descartados,
    };
  }

  return {
    porSet: mediana(porSets),
    setsPorPartido: sets.reduce((a, b) => a + b, 0) / sets.length,
    medidos: porSets.length,
    medido: true,
    descartados,
  };
}

/**
 * Sets que se espera que dure un partido de esta etapa.
 *
 * Con partidos medidos se usa lo observado, pero solo para la etapa que se
 * midió: casi todo lo que hay al empezar es fase de grupos, y trasladar su
 * número de sets a una eliminatoria al mejor de cinco la dejaría corta.
 */
function setsDeEtapa(t: Torneo, setsPara: number): number {
  const r = ritmo(t);
  if (r.medido && setsPara === t.formatoGrupos) return r.setsPorPartido;
  return setsEsperados(setsPara);
}

/** Lo que se espera que dure un partido de esta etapa, en minutos. */
export const duracionEstimada = (t: Torneo, setsPara: number): number =>
  Math.round(setsDeEtapa(t, setsPara) * ritmo(t).porSet);

/** Milisegundos que le faltan a un partido que ya está en la mesa. */
function restanteDe(t: Torneo, p: Partido, porSet: number, ahora: number): number {
  const setsPara = setsDe(t, p);
  const st = reducir(p, setsPara);
  const faltan = setsRestantes(p, setsPara);
  let ms = faltan * porSet * MINUTO;

  // Un set a medias ya lleva camino andado: se descuenta a ojo por los
  // puntos anotados sobre los once que hacen falta.
  if (st.fase === "en-juego") {
    const avance = Math.min(1, Math.max(st.pa, st.pb) / 11);
    ms -= avance * porSet * MINUTO;
  }
  if (st.fase === "descanso" && st.descansoDesde !== null) {
    const queda = t.descansoSet * MINUTO - (ahora - st.descansoDesde);
    ms += Math.max(0, queda);
  }
  return Math.max(0, ms);
}

export interface Turno {
  partidoId: string;
  aId: string | null;
  bId: string | null;
  mesa: number;
  /** Verdadero si la mesa es la que asignó el juez y no una estimada. */
  mesaFirme: boolean;
  jugando: boolean;
  /** Momento estimado de inicio. */
  inicio: number;
  /** Minutos desde ahora. 0 si ya está en la mesa. */
  espera: number;
  etapa: Partido["etapa"];
}

/**
 * Proyecta a qué hora empieza cada partido que falta.
 *
 * Cada mesa es un servidor que se desocupa cuando acaba lo que tiene
 * encima; los partidos se van encolando en la mesa que se libere antes,
 * sin que nadie juegue en dos mesas a la vez ni antes de su descanso. Es
 * planificación por lista: no da el calendario óptimo, da el que va a
 * ocurrir si el torneo sigue como viene.
 *
 * Es una estimación y hay que presentarla como tal —«en unos 25 min», no
 * «a las 13:42»—, pero es lo que permite que un jugador se vaya a comer
 * sin perder su partido, que es todo el punto de la pantalla en la pared.
 */
export function proyectar(t: Torneo, ahora = Date.now()): Turno[] {
  const { porSet } = ritmo(t);
  const nMesas = Math.max(1, t.mesas);
  const salidaJugador = new Map<string, number>();
  const turnos: Turno[] = [];

  /* Lo que ya está en las mesas fija cuándo se libera cada una. */
  const libreEn = Array.from({ length: nMesas }, () => ahora);
  for (let i = 0; i < nMesas; i++) {
    const mesa = i + 1;
    const p = t.partidos.find((x) => {
      if (x.mesa !== mesa || !x.aId || !x.bId) return false;
      const f = reducir(x, setsDe(t, x)).fase;
      return f === "sin-iniciar" || f === "en-juego" || f === "descanso";
    });
    if (!p) continue;
    const fin = ahora + restanteDe(t, p, porSet, ahora);
    libreEn[i] = fin;
    if (p.aId) salidaJugador.set(p.aId, fin);
    if (p.bId) salidaJugador.set(p.bId, fin);
    turnos.push({
      partidoId: p.id,
      aId: p.aId,
      bId: p.bId,
      mesa,
      mesaFirme: true,
      jugando: true,
      inicio: ahora,
      espera: 0,
      etapa: p.etapa,
    });
  }

  /* Y lo que falta se va colgando de la mesa que se desocupe primero. */
  const cola = t.partidos
    .filter((p) => p.aId && p.bId && !turnos.some((x) => x.partidoId === p.id) && !reducir(p, setsDe(t, p)).terminado)
    .sort((x, y) => {
      if (x.mesa && y.mesa && x.mesa !== y.mesa) return x.mesa - y.mesa;
      if (x.etapa !== y.etapa) return x.etapa === "final" ? -1 : 1;
      if (x.etapa === "final") return (x.ronda ?? 0) - (y.ronda ?? 0) || (x.slot ?? 0) - (y.slot ?? 0);
      return x.orden - y.orden;
    });

  const descanso = Math.max(0, t.descansoJugador) * MINUTO;

  for (const p of cola) {
    // Quien no ha jugado está libre desde ya; sumarle el descanso a un
    // cero lo dejaría esperando un rato que nunca le tocó descansar.
    const fa = salidaJugador.get(p.aId!);
    const fb = salidaJugador.get(p.bId!);
    const listoA = fa === undefined ? ahora : fa + descanso;
    const listoB = fb === undefined ? ahora : fb + descanso;
    const listoJugadores = Math.max(ahora, listoA, listoB);

    // Si el juez ya le puso mesa, respetamos esa; si no, la que antes
    // quede libre y pueda con el descanso de los dos jugadores.
    let idx: number;
    if (p.mesa >= 1 && p.mesa <= nMesas) {
      idx = p.mesa - 1;
    } else {
      idx = 0;
      for (let i = 1; i < nMesas; i++) {
        if (Math.max(libreEn[i], listoJugadores) < Math.max(libreEn[idx], listoJugadores)) idx = i;
      }
    }

    const inicio = Math.max(libreEn[idx], listoJugadores);
    const dur = setsDeEtapa(t, setsDe(t, p)) * porSet * MINUTO;
    libreEn[idx] = inicio + dur;
    salidaJugador.set(p.aId!, inicio + dur);
    salidaJugador.set(p.bId!, inicio + dur);

    turnos.push({
      partidoId: p.id,
      aId: p.aId,
      bId: p.bId,
      mesa: idx + 1,
      mesaFirme: p.mesa >= 1,
      jugando: false,
      inicio,
      espera: Math.max(0, Math.round((inicio - ahora) / MINUTO)),
      etapa: p.etapa,
    });
  }

  return turnos.sort((a, b) => Number(b.jugando) - Number(a.jugando) || a.inicio - b.inicio || a.mesa - b.mesa);
}

/** Los turnos en que aparece un jugador, del más próximo al más lejano. */
export const turnosDe = (turnos: Turno[], jugadorId: string): Turno[] =>
  turnos.filter((x) => x.aId === jugadorId || x.bId === jugadorId);

/** «ya», «en 5 min», «en 1 h 10 min». */
export function comoTexto(min: number): string {
  if (min <= 0) return "ya";
  if (min < 60) return `en ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `en ${h} h ${m} min` : `en ${h} h`;
}
