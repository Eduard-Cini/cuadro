import type { Grupo, Jugador, Partido } from "./tipos";

const id = () => Math.random().toString(36).slice(2, 9);

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
}

/**
 * Sorteo con restricciones.
 *
 * Es un problema de asignación: repartir jugadores en grupos cumpliendo
 * (1) los sembrados quedan separados, y (2) dos del mismo club no coinciden.
 *
 * Estrategia: reparto en serpiente por ranking, que garantiza (1) por
 * construcción, y luego intercambios dentro del mismo nivel de siembra para
 * arreglar (2) sin romper (1). Cuando no hay intercambio posible —cinco del
 * mismo club en cuatro grupos, por ejemplo— la restricción es infactible:
 * el sorteo cede y reporta exactamente qué cedió, en vez de fallar en
 * silencio o quedarse dando vueltas.
 */
export function sortear(jugadores: Jugador[], nGrupos: number): ResultadoSorteo {
  const n = Math.max(1, Math.floor(nGrupos));
  const porId = new Map(jugadores.map((j) => [j.id, j] as const));
  const club = (x: string) => (porId.get(x)?.club ?? "").trim().toLowerCase();

  const orden = [...jugadores].sort((a, b) => b.rank - a.rank);
  const g: Puesto[][] = Array.from({ length: n }, () => []);
  orden.forEach((j, i) => {
    const fila = Math.floor(i / n);
    const k = i % n;
    g[fila % 2 === 0 ? k : n - 1 - k].push({ id: j.id, fila });
  });

  const choca = (arr: Puesto[], c: string, salvo: string) =>
    !!c && arr.some((x) => x.id !== salvo && club(x.id) === c);

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
        hecho = true;
      }
    }
    if (!hecho) break;
  }

  const relajaciones: string[] = [];
  const nom = (x: string) => porId.get(x)?.nombre ?? "?";
  const grupos: Grupo[] = g.map((arr, i) => {
    const letra = String.fromCharCode(65 + i);
    const vistos = new Map<string, string>();
    for (const x of arr) {
      const c = club(x.id);
      if (!c) continue;
      const antes = vistos.get(c);
      if (antes) relajaciones.push(`Grupo ${letra}: ${nom(antes)} y ${nom(x.id)} son del mismo club`);
      else vistos.set(c, x.id);
    }
    return { id: id(), nombre: `Grupo ${letra}`, jugadores: arr.map((x) => x.id) };
  });

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
          eventos: [],
        });
      }
    }
  }

  return { grupos, partidos: repartir(pares), relajaciones };
}

/**
 * Ordena los partidos para que nadie juegue dos seguidos.
 *
 * Versión mínima del problema de calendarización con descanso: voraz, toma
 * el primero que no comparte jugador con el anterior. No busca el óptimo
 * —el problema general es NP-difícil— y cuando no queda opción, cede.
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
  return orden;
}

/** Reparte los partidos entre las mesas disponibles. */
export function asignarMesas(partidos: Partido[], mesas: number): void {
  const n = Math.max(1, mesas);
  partidos.forEach((m, i) => {
    m.mesa = (i % n) + 1;
  });
}
