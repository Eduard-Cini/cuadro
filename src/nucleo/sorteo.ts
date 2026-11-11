import type { Grupo, Jugador, Partido } from "./tipos";

const id = () => Math.random().toString(36).slice(2, 9);

/**
 * Azar reproducible (mulberry32).
 *
 * Un sorteo hecho por computadora tiene que poder repetirse: si alguien
 * reclama, el juez vuelve a correr el sorteo con la misma semilla y sale
 * exactamente el mismo cuadro. `Math.random` no permite eso; un generador
 * con estado sí. La semilla se escribe en el acta antes de sortear.
 */
export function azar(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Baraja de Fisher–Yates con el generador que se le pase. */
export function barajar<T>(lista: T[], rnd: () => number): T[] {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const k = Math.floor(rnd() * (i + 1));
    [a[i], a[k]] = [a[k], a[i]];
  }
  return a;
}

export interface OpcionesSorteo {
  /**
   * Semilla del azar. Sin ella el reparto es puramente por ranking, que
   * es lo que se hace cuando el sorteo ya se hizo con bolitas y aquí solo
   * se captura. Con ella, el sistema sortea y deja constancia.
   */
  semilla?: number;
  /** Cuántos del tope del ranking se reparten uno por grupo. */
  sembrados?: number;
  separarClubes?: boolean;
  /** La siembra sale del orden de la lista, no del ranking. */
  siembraManual?: boolean;
  /**
   * Arma el calendario por jornadas (todos contra todos): en cada jornada
   * cada quien juega una vez, y en n − 1 jornadas todos se enfrentan con
   * todos. Sin esto, los partidos solo se ordenan para que nadie juegue
   * dos seguidos.
   */
  jornadas?: boolean;
}

interface Puesto {
  id: string;
  /** Nivel de siembra: 0 son los cabezas de grupo. */
  fila: number;
}

export interface ResultadoSorteo {
  grupos: Grupo[];
  partidos: Partido[];
  /** Choques de club que no se pudieron evitar. */
  relajaciones: string[];
  /** Paso a paso de lo que hizo el sorteo, para el acta. */
  acta: string[];
}

/**
 * Sorteo con restricciones.
 *
 * Es un problema de asignación: repartir jugadores en grupos cumpliendo
 * (1) los sembrados quedan separados, y (2) dos del mismo club no
 * coinciden. Estrategia: reparto en serpiente por nivel de siembra, que
 * garantiza (1) por construcción, y luego intercambios *dentro del mismo
 * nivel* para arreglar (2) sin romper (1).
 *
 * Cuando no hay intercambio posible —cinco del mismo club en cuatro
 * grupos, por ejemplo— la restricción es infactible: no hay nada que
 * arreglar. El sorteo cede y reporta exactamente qué cedió, en vez de
 * fallar en silencio o quedarse dando vueltas.
 */
export function sortear(jugadores: Jugador[], nGrupos: number, op: OpcionesSorteo = {}): ResultadoSorteo {
  const n = Math.max(1, Math.floor(nGrupos));
  const porId = new Map(jugadores.map((j) => [j.id, j] as const));
  const club = (x: string) => (porId.get(x)?.club ?? "").trim().toLowerCase();
  const nom = (x: string) => porId.get(x)?.nombre ?? "?";
  // En todos contra todos hay un solo grupo: no hay a quién separar, y
  // reportar «choques de club» ahí solo confunde.
  const liga = !!op.jornadas && n === 1;
  const separar = op.separarClubes !== false && !liga;
  const acta: string[] = [];

  const conAzar = op.semilla !== undefined;
  const rnd = conAzar ? azar(op.semilla!) : null;

  acta.push(
    conAzar
      ? `Sorteo por computadora, semilla ${op.semilla}. Con esta semilla el sorteo se repite idéntico.`
      : "Reparto por ranking, sin azar. Se usa cuando el sorteo ya se hizo a mano.",
  );
  acta.push(liga ? `${jugadores.length} jugadores, todos contra todos.` : `${jugadores.length} jugadores en ${n} ${n === 1 ? "grupo" : "grupos"}.`);

  // Los sembrados van por ranking, o por el orden de la lista si así lo
  // decidió el juez; el resto, barajado si hay semilla.
  const porRank = op.siembraManual ? [...jugadores] : [...jugadores].sort((a, b) => b.rank - a.rank);
  const cabezas = Math.min(op.sembrados ?? n, porRank.length);
  const arriba = porRank.slice(0, cabezas);
  const abajo = porRank.slice(cabezas);
  const resto = rnd ? barajar(abajo, rnd) : abajo;
  const orden = [...arriba, ...resto];

  if (liga) {
    acta.push(
      rnd
        ? "El azar decide en qué jornada le toca a cada quien enfrentarse con cada otro."
        : `Calendario en el orden de la lista${op.siembraManual ? " que fijó el juez" : ", por ranking"}.`,
    );
  } else {
    if (cabezas > 0)
      acta.push(
        `${cabezas} sembrados ${op.siembraManual ? "por el orden que fijó el juez" : "por ranking"}, uno por grupo: ${arriba.map((j) => j.nombre).join(", ")}.`,
      );
    if (rnd && resto.length) acta.push(`${resto.length} jugadores repartidos al azar en serpiente.`);
  }

  const g: Puesto[][] = Array.from({ length: n }, () => []);
  // El orden en que se recorren los grupos también se sortea, para que la
  // primera bolita no caiga siempre en el grupo A.
  const destino = rnd ? barajar(Array.from({ length: n }, (_, i) => i), rnd) : Array.from({ length: n }, (_, i) => i);

  orden.forEach((j, i) => {
    const fila = Math.floor(i / n);
    const k = i % n;
    g[destino[fila % 2 === 0 ? k : n - 1 - k]].push({ id: j.id, fila });
  });

  const choca = (arr: Puesto[], c: string, salvo: string) =>
    !!c && arr.some((x) => x.id !== salvo && club(x.id) === c);

  if (separar) {
    for (let paso = 0; paso < 200; paso++) {
      let conf: { i: number; x: Puesto } | null = null;
      for (let i = 0; i < n && !conf; i++) {
        for (const x of g[i]) {
          if (choca(g[i], club(x.id), x.id)) {
            conf = { i, x };
            break;
          }
        }
      }
      if (!conf) break;

      let hecho = false;
      for (let h = 0; h < n && !hecho; h++) {
        if (h === conf.i) continue;
        const cand = g[h].find(
          (y) =>
            y.fila === conf!.x.fila &&
            !choca(g[h], club(conf!.x.id), y.id) &&
            !choca(g[conf!.i], club(y.id), conf!.x.id),
        );
        if (cand) {
          g[conf.i][g[conf.i].indexOf(conf.x)] = cand;
          g[h][g[h].indexOf(cand)] = conf.x;
          acta.push(
            `Cambio para separar clubes: ${nom(conf.x.id)} pasa al grupo ${String.fromCharCode(65 + h)} y ${nom(cand.id)} al ${String.fromCharCode(65 + conf.i)}.`,
          );
          hecho = true;
        }
      }
      if (!hecho) break;
    }
  } else if (!liga) {
    acta.push("Separación por club desactivada.");
  }

  const relajaciones: string[] = [];
  const grupos: Grupo[] = g.map((arr, i) => {
    const letra = String.fromCharCode(65 + i);
    if (separar) {
      const vistos = new Map<string, string>();
      for (const x of arr) {
        const c = club(x.id);
        if (!c) continue;
        const antes = vistos.get(c);
        if (antes) relajaciones.push(`Grupo ${letra}: ${nom(antes)} y ${nom(x.id)} son del mismo club`);
        else vistos.set(c, x.id);
      }
    }
    const nombre = liga ? "Todos contra todos" : `Grupo ${letra}`;
    if (!liga) acta.push(`${nombre}: ${arr.map((x) => nom(x.id)).join(", ") || "vacío"}.`);
    return { id: id(), nombre, jugadores: arr.map((x) => x.id) };
  });

  if (relajaciones.length) acta.push(`Restricciones que no se pudieron cumplir: ${relajaciones.length}.`);

  if (op.jornadas) {
    const partidos: Partido[] = [];
    for (const gr of grupos) {
      const rondas = calendarioCircular(gr.jugadores);
      rondas.forEach((ronda, r) => {
        for (const [a, b] of ronda) {
          partidos.push({ id: id(), etapa: "grupo", grupoId: gr.id, aId: a, bId: b, mesa: 0, orden: 0, jornada: r + 1, eventos: [] });
        }
      });
      acta.push(`${gr.nombre}: ${rondas.length} jornadas, ${rondas.reduce((s, x) => s + x.length, 0)} partidos.`);
    }
    partidos.sort((x, y) => (x.jornada ?? 0) - (y.jornada ?? 0));
    partidos.forEach((p, i) => (p.orden = i));
    return { grupos, partidos, relajaciones, acta };
  }

  const pares: Partido[] = [];
  for (const gr of grupos) {
    for (let i = 0; i < gr.jugadores.length; i++) {
      for (let k = i + 1; k < gr.jugadores.length; k++) {
        pares.push({
          id: id(),
          etapa: "grupo",
          grupoId: gr.id,
          aId: gr.jugadores[i],
          bId: gr.jugadores[k],
          mesa: 0,
          orden: 0,
          eventos: [],
        });
      }
    }
  }

  return { grupos, partidos: repartir(pares), relajaciones, acta };
}

/**
 * Calendario de todos contra todos por el método del círculo.
 *
 * Se fija al primero y los demás giran una posición por jornada; en cada
 * jornada se enfrentan los que quedan uno frente al otro. Con n jugadores
 * salen n − 1 jornadas (n si es impar: en cada una descansa uno) y cada
 * pareja aparece exactamente una vez. Es lo que permite repartir un torneo
 * largo en días: cada jornada es un día, y en cada una juegan todos.
 */
export function calendarioCircular(ids: string[]): Array<Array<[string, string]>> {
  const lista: Array<string | null> = [...ids];
  if (lista.length % 2) lista.push(null);
  const n = lista.length;
  const rondas: Array<Array<[string, string]>> = [];
  for (let r = 0; r < n - 1; r++) {
    const ronda: Array<[string, string]> = [];
    for (let i = 0; i < n / 2; i++) {
      const x = lista[i];
      const y = lista[n - 1 - i];
      // El fijo alterna de lado para no quedar siempre a la izquierda.
      if (x && y) ronda.push(i === 0 && r % 2 === 1 ? [y, x] : [x, y]);
    }
    rondas.push(ronda);
    lista.splice(1, 0, lista.pop()!);
  }
  return rondas;
}

/**
 * Ordena los partidos para que nadie juegue dos seguidos.
 *
 * Versión mínima del problema de calendarización con descanso: voraz, toma
 * el primero que no comparte jugador con el anterior. No busca el óptimo
 * —el problema general es NP-difícil— y cuando no queda opción, cede y
 * sigue, porque un rol imperfecto es mejor que ningún rol.
 */
export function repartir(lista: Partido[]): Partido[] {
  const orden: Partido[] = [];
  const resto = [...lista];
  let ult: Partido | null = null;

  while (resto.length) {
    let i = resto.findIndex(
      (m) =>
        !ult ||
        (m.aId !== ult.aId && m.aId !== ult.bId && m.bId !== ult.aId && m.bId !== ult.bId),
    );
    if (i < 0) i = 0;
    const [m] = resto.splice(i, 1);
    orden.push(m);
    ult = m;
  }
  orden.forEach((m, i) => (m.orden = i));
  return orden;
}
