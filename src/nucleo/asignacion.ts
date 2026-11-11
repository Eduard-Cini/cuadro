import { reducir } from "./reglas";
import type { Partido, Torneo } from "./tipos";

export const MINUTO = 60_000;

/** Cuántas opciones se ofrecen además de la propuesta. */
const MAX_ALTERNATIVAS = 5;

/** Sets que hay que ganar en este partido, según su etapa. */
export const setsDe = (t: Torneo, p: Partido): number =>
  p.etapa === "final" ? t.formatoFinales : t.formatoGrupos;

/** ¿El partido está ocupando su mesa ahora mismo? */
export function enCurso(t: Torneo, p: Partido): boolean {
  if (!p.mesa || !p.aId || !p.bId) return false;
  const f = reducir(p, setsDe(t, p)).fase;
  return f === "sin-iniciar" || f === "en-juego" || f === "descanso";
}

export interface EstadoMesa {
  mesa: number;
  /** Lo que se está jugando ahí, si hay algo. */
  partido: Partido | null;
  arbitroId?: string;
  arbitro: string;
  libre: boolean;
}

/** Foto de las mesas: qué hay en cada una y quién la lleva. */
export function estadoMesas(t: Torneo): EstadoMesa[] {
  return Array.from({ length: Math.max(1, t.mesas) }, (_, i) => {
    const mesa = i + 1;
    const partido = t.partidos.find((p) => p.mesa === mesa && enCurso(t, p)) ?? null;
    const arb = t.arbitros.find((x) => x.mesa === mesa);
    return { mesa, partido, arbitroId: arb?.id, arbitro: arb?.nombre ?? "", libre: !partido };
  });
}

export interface Candidato {
  partidoId: string;
  /** Por qué entraría, o qué lo pone por detrás del propuesto. */
  motivo: string;
}

export interface Asignacion {
  partidoId: string;
  mesa: number;
  arbitroId?: string;
  /** Por qué a esta mesa y no a otra. El juez decide viendo esto. */
  motivo: string;
  /**
   * Otros partidos que también podrían entrar en esta mesa ahora.
   *
   * Existen porque el orden del rol no es la única razón para llamar a un
   * partido. El juez sabe cosas que el sistema no puede saber: que un
   * jugador viene con una ampolla y necesita más descanso, que otro juega
   * también en el torneo de al lado y hay que sacarlo pronto, que dos
   * llevan media hora esperando de pie. Proponer sin alternativas obliga a
   * salirse del sistema para hacer lo correcto.
   */
  alternativas: Candidato[];
}

export interface Espera {
  partidoId: string;
  /** Qué impide ponerlo ahora. */
  razon: string;
}

export interface Propuesta {
  asignaciones: Asignacion[];
  espera: Espera[];
  /** Mesas que se quedan vacías porque ya no hay nada que poner. */
  ociosas: number[];
}

/** Momento en que cada jugador terminó de jugar por última vez. */
function ultimaSalida(t: Torneo): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of t.partidos) {
    const st = reducir(p, setsDe(t, p));
    if (!st.terminado || st.hasta === null) continue;
    for (const j of [p.aId, p.bId]) {
      if (!j) continue;
      m.set(j, Math.max(m.get(j) ?? 0, st.hasta));
    }
  }
  return m;
}

/**
 * Propone qué partido va a cada mesa que quedó libre.
 *
 * El juez no teclea el rol: lo revisa. Esta función mira cómo van los
 * resultados que mandaron los árbitros —qué acabó, qué cruces quedaron
 * definidos en el cuadro, quién viene de jugar— y arma una propuesta que
 * el juez acepta con un botón, cambia, o rechaza.
 *
 * Restricciones duras: una mesa a la vez, y nadie en dos mesas. Blandas:
 * un jugador no vuelve a la mesa antes del descanso mínimo, y se atiende
 * primero la eliminatoria, que es la que traba el resto del torneo.
 *
 * Es voraz. Sobre las mesas libres en orden de prioridad, toma el primer
 * partido admisible. No busca el óptimo global —emparejar partidos con
 * mesas respetando descansos es un problema de asignación con ventanas de
 * tiempo— pero cada decisión queda explicada, que es lo que el juez
 * necesita para aceptarla o no.
 */
export function sugerirAsignacion(t: Torneo, ahora = Date.now()): Propuesta {
  const mesas = estadoMesas(t);
  const salida = ultimaSalida(t);
  const descanso = Math.max(0, t.descansoJugador) * MINUTO;

  /* Quién está en una mesa en este momento. */
  const jugando = new Set<string>();
  for (const m of mesas) {
    if (!m.partido) continue;
    if (m.partido.aId) jugando.add(m.partido.aId);
    if (m.partido.bId) jugando.add(m.partido.bId);
  }

  const nom = (id: string | null) => t.jugadores.find((j) => j.id === id)?.nombre ?? "?";

  const candidatos = t.partidos
    .filter((p) => p.aId && p.bId && !p.mesa && !reducir(p, setsDe(t, p)).terminado)
    .sort((x, y) => {
      // La eliminatoria primero: sus rondas dependen unas de otras y son
      // las que dejan a todo el mundo esperando.
      if (x.etapa !== y.etapa) return x.etapa === "final" ? -1 : 1;
      if (x.etapa === "final") return (x.ronda ?? 0) - (y.ronda ?? 0) || (x.slot ?? 0) - (y.slot ?? 0);
      return x.orden - y.orden;
    });

  // Mesa con árbitro antes que mesa sin árbitro: un partido sin quien lo
  // dirija no puede empezar.
  const libres = mesas.filter((m) => m.libre).sort((a, b) => Number(!!b.arbitroId) - Number(!!a.arbitroId) || a.mesa - b.mesa);

  const asignaciones: Asignacion[] = [];
  const tomados = new Set<string>();
  const usados = new Set<string>();

  /**
   * Lo único imposible: un jugador no puede estar en dos mesas a la vez.
   *
   * El descanso **no** entra aquí. Antes sí, y el resultado era que con
   * todas las mesas libres no se podía mandar nada: recién terminada una
   * ronda, todo el mundo acaba de jugar y a todo el mundo le faltan los
   * diez minutos. Un descanso es una recomendación de reglamento, no una
   * ley física, y quien decide saltárselo —porque el torneo va tarde, o
   * porque ese jugador quiere seguir— es el juez.
   */
  const admisible = (p: Partido, mirarTomados: boolean) => {
    const a = p.aId!;
    const b = p.bId!;
    if (jugando.has(a) || jugando.has(b)) return false;
    if (mirarTomados && (tomados.has(a) || tomados.has(b))) return false;
    return true;
  };

  /**
   * Cuándo acabó de jugar el último de los dos, o null si ninguno ha jugado.
   *
   * El null importa: usar cero como «nunca jugó» lo confunde con «jugó en
   * el instante cero», y entonces a un jugador que no ha pisado la mesa se
   * le calcula un descanso pendiente.
   */
  const finDe = (p: Partido): number | null => {
    const fa = salida.get(p.aId!);
    const fb = salida.get(p.bId!);
    if (fa === undefined && fb === undefined) return null;
    return Math.max(fa ?? 0, fb ?? 0);
  };

  /** Minutos de descanso que le faltan al que menos ha descansado. */
  const faltaDescanso = (p: Partido): number => {
    const fin = finDe(p);
    if (fin === null) return 0;
    return Math.max(0, Math.ceil((descanso - (ahora - fin)) / MINUTO));
  };

  /** A quién le falta descanso, para poder decirlo por su nombre. */
  const quienDescansa = (p: Partido): string => {
    const fa = salida.get(p.aId!) ?? -Infinity;
    const fb = salida.get(p.bId!) ?? -Infinity;
    return nom(fa >= fb ? p.aId : p.bId);
  };

  const porQue = (p: Partido, m: EstadoMesa) => {
    const base =
      p.etapa === "final"
        ? `Eliminatoria, ronda ${(p.ronda ?? 0) + 1}`
        : `Turno ${p.orden + 1} del rol`;
    const falta = faltaDescanso(p);
    const aviso = falta > 0 ? `; a ${quienDescansa(p)} le faltan ${falta} min de descanso` : "";
    return `${base}${aviso}${m.arbitro ? `; mesa de ${m.arbitro}` : "; mesa sin árbitro"}`;
  };

  /* Los que ya descansaron van primero; entre iguales, el orden del rol.
     Los que no, detrás, y el que menos le falte por delante. */
  const porPreferencia = (x: Partido, y: Partido) => {
    const fx = faltaDescanso(x);
    const fy = faltaDescanso(y);
    if ((fx === 0) !== (fy === 0)) return fx === 0 ? -1 : 1;
    if (fx !== fy) return fx - fy;
    return 0;
  };

  const ordenados = [...candidatos].sort(porPreferencia);

  for (const m of libres) {
    const elegido = ordenados.find((p) => !usados.has(p.id) && admisible(p, true));
    if (!elegido) continue;

    usados.add(elegido.id);
    tomados.add(elegido.aId!);
    tomados.add(elegido.bId!);

    /* Las alternativas no miran a los ya tomados por esta misma propuesta:
       si el juez cambia una mesa, la siguiente vuelta se recalcula sola. */
    const alternativas = ordenados
      .filter((p) => p.id !== elegido.id && admisible(p, false))
      .slice(0, MAX_ALTERNATIVAS)
      .map((p) => {
        const base =
          p.etapa === "final" ? `Eliminatoria, ronda ${(p.ronda ?? 0) + 1}` : `Turno ${p.orden + 1} del rol`;
        const falta = faltaDescanso(p);
        return {
          partidoId: p.id,
          motivo: falta > 0 ? `${base} · a ${quienDescansa(p)} le faltan ${falta} min` : base,
        };
      });

    asignaciones.push({
      partidoId: elegido.id,
      mesa: m.mesa,
      arbitroId: m.arbitroId,
      motivo: porQue(elegido, m),
      alternativas,
    });
  }

  /* Por qué se quedó fuera cada uno de los que no entraron. */
  const espera: Espera[] = [];
  for (const p of candidatos) {
    if (usados.has(p.id)) continue;
    const a = p.aId!;
    const b = p.bId!;
    let razon: string;
    if (jugando.has(a) || jugando.has(b)) {
      razon = `${nom(jugando.has(a) ? a : b)} está jugando`;
    } else if (tomados.has(a) || tomados.has(b)) {
      razon = `${nom(tomados.has(a) ? a : b)} ya entró en esta misma propuesta`;
    } else {
      const faltan = faltaDescanso(p);
      razon = faltan > 0 ? `no quedan mesas; además le faltan ${faltan} min de descanso` : "no quedan mesas libres";
    }
    espera.push({ partidoId: p.id, razon });
  }

  const ociosas = libres.filter((m) => !asignaciones.some((x) => x.mesa === m.mesa)).map((m) => m.mesa);
  return { asignaciones, espera, ociosas };
}

/** Escribe la propuesta en el torneo. Solo la llama el juez, al aceptar. */
export function aplicarPropuesta(t: Torneo, p: Propuesta): void {
  for (const a of p.asignaciones) colocar(t, a.partidoId, a.mesa);
}

/**
 * Pone un partido en una mesa, saque quien lo saque de donde estuviera.
 *
 * Se usa cuando el juez elige una alternativa en vez de la propuesta: hay
 * que quitar de esa mesa lo que hubiera antes, o acabarían dos partidos
 * asignados al mismo sitio.
 */
export function colocar(t: Torneo, partidoId: string, mesa: number): void {
  const p = t.partidos.find((x) => x.id === partidoId);
  if (!p) return;
  for (const otro of t.partidos) {
    if (otro.mesa === mesa && otro.id !== partidoId && !reducir(otro, setsDe(t, otro)).terminado) {
      otro.mesa = 0;
      otro.arbitroId = undefined;
    }
  }
  p.mesa = mesa;
  p.arbitroId = t.arbitros.find((a) => a.mesa === mesa)?.id;
}

/** Suelta la mesa de los partidos ya cerrados, para que se pueda reasignar. */
/**
 * ¿A qué otras mesas se puede pasar este partido?
 *
 * A una libre, siempre. A una ocupada, solo si ninguno de los dos partidos
 * ha empezado: entonces se intercambian. Un partido en juego no se le
 * quita a su mesa para meter otro.
 */
export function mesasDestino(t: Torneo, partidoId: string): number[] {
  const p = t.partidos.find((x) => x.id === partidoId);
  if (!p || !p.mesa || reducir(p, setsDe(t, p)).terminado) return [];
  const empezado = p.eventos.length > 0;
  const out: number[] = [];
  for (let m = 1; m <= Math.max(1, t.mesas); m++) {
    if (m === p.mesa) continue;
    const ocupante = t.partidos.find((x) => x.mesa === m && !reducir(x, setsDe(t, x)).terminado);
    if (!ocupante || (!empezado && ocupante.eventos.length === 0)) out.push(m);
  }
  return out;
}

/**
 * Pasa un partido a otra mesa. Si allí había uno sin empezar, se cruzan.
 *
 * Hace falta porque la propuesta reparte por orden de rol, y el juez sabe
 * cosas que ella no: que la mesa 2 se quedó sin árbitro, o que esos dos
 * prefieren la del fondo. El árbitro del partido pasa a ser el de la mesa
 * nueva, que es quien lo va a ver en su tablet.
 */
export function moverDeMesa(t: Torneo, partidoId: string, mesa: number): boolean {
  const p = t.partidos.find((x) => x.id === partidoId);
  if (!p || !mesasDestino(t, partidoId).includes(mesa)) return false;
  const arbitroDe = (m: number) => t.arbitros.find((a) => a.mesa === m)?.id;
  const origen = p.mesa;
  const ocupante = t.partidos.find((x) => x.mesa === mesa && x.id !== p.id && !reducir(x, setsDe(t, x)).terminado);
  if (ocupante) {
    ocupante.mesa = origen;
    ocupante.arbitroId = arbitroDe(origen);
  }
  p.mesa = mesa;
  p.arbitroId = arbitroDe(mesa);
  return true;
}

/** Devuelve a la cola un partido que todavía no empieza. */
export function quitarDeMesa(t: Torneo, partidoId: string): boolean {
  const p = t.partidos.find((x) => x.id === partidoId);
  if (!p || !p.mesa || p.eventos.length > 0) return false;
  p.mesa = 0;
  p.arbitroId = undefined;
  return true;
}

export function liberarMesas(t: Torneo): number {
  let n = 0;
  for (const p of t.partidos) {
    if (!p.mesa) continue;
    const st = reducir(p, setsDe(t, p));
    if (st.fase === "validado" || (st.terminado && !t.validacionObligatoria)) {
      p.jugadaEn = p.mesa;
      p.mesa = 0;
      n++;
    }
  }
  return n;
}
