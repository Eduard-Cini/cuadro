import { clasificar, estadisticas } from "./clasificacion";
import { setsDe } from "./asignacion";
import { ganadorDe, partidoListo } from "./reglas";
import type { Grupo, Partido, Sistema } from "./tipos";

const id = () => Math.random().toString(36).slice(2, 9);

/**
 * Qué sembrado va en cada lugar de un cuadro de `n` (potencia de dos).
 *
 * Es el orden de siempre: el 1 arriba y el 2 abajo, para que solo puedan
 * verse en la final; el 3 y el 4 uno en cada mitad, y así. Para 8 queda
 * 1-8, 4-5, 2-7, 3-6. Cada mitad se arma igual que el cuadro entero, y por
 * eso el partido `i` de una ronda alimenta al `i/2` de la siguiente.
 */
export function ordenDeSiembra(n: number): number[] {
  let orden = [1];
  while (orden.length < n) {
    const m = orden.length * 2;
    orden = orden.flatMap((s) => [s, m + 1 - s]);
  }
  return orden;
}

/** Ronda en que se cruzarían dos lugares del cuadro (0 es la primera). */
const rondaDeCruce = (x: number, y: number): number => {
  let r = 0;
  while (x >> (r + 1) !== y >> (r + 1)) r++;
  return r;
};

/** Todas las permutaciones de `xs`, empezando por el orden original. */
function permutaciones<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutaciones([...xs.slice(0, i), ...xs.slice(i + 1)]).map((resto) => [x, ...resto]));
}

/**
 * Arma la eliminatoria con los que avanzan de cada grupo.
 *
 * Los primeros de grupo toman los primeros lugares de la siembra, en el
 * orden de los grupos (el grupo A es el del sembrado 1), y los mejores
 * descansan la primera ronda si los clasificados no son potencia de dos.
 *
 * Los segundos (y terceros, si avanzan tres) se acomodan entre los lugares
 * que les tocan de modo que dos del mismo grupo se crucen lo más tarde
 * posible: nunca en la primera ronda si se puede evitar, y el segundo de
 * un grupo en la mitad contraria a la de su primero. Así lo hacen la ITTF
 * y cualquier torneo bien sorteado: volver a jugar el mismo partido de
 * grupo en cuartos no le dice nada nuevo a nadie.
 */
export function armarCuadro(
  grupos: Grupo[],
  partidos: Partido[],
  clasifican: number,
  setsParaGrupos: number,
  exigirValidacion = false,
): Partido[] {
  const clasificados: Array<{ id: string; pos: number; grupo: number; cmp: number[] }> = [];
  //Proporcion segura: 0 si no hay datos
  const razon = (a: number, b: number) => (a + b ? a / (a + b) : 0);
  grupos.forEach((gr, g) => {
    const suyos = partidos.filter((p) => p.grupoId === gr.id);
    const ord = clasificar(gr.jugadores, suyos, setsParaGrupos, exigirValidacion);
    const est = estadisticas(gr.jugadores, suyos, setsParaGrupos, exigirValidacion);
    for (let i = 0; i < clasifican && i < ord.length; i++) {
      const e = est[ord[i]];
      //Para comparar entre grupos: partidos, sets y puntos ganados, en proporcion
      const cmp = [razon(e.pg, e.pp), razon(e.sg, e.sp), razon(e.tg, e.tp)];
      clasificados.push({ id: ord[i], pos: i, grupo: g, cmp });
    }
  });
  if (clasificados.length < 2) return [];

  // Por lugar en el grupo y, dentro de cada lugar, por cómo le fue a cada
  // quien (partidos, sets y puntos ganados, en proporción). Así los mejores
  // primeros lugares se quedan con los descansos. El orden de los grupos
  // solo desempata.
  const porRegistro = (a: (typeof clasificados)[number], b: (typeof clasificados)[number]) => {
    for (let k = 0; k < a.cmp.length; k++) if (a.cmp[k] !== b.cmp[k]) return b.cmp[k] - a.cmp[k];
    return a.grupo - b.grupo;
  };
  clasificados.sort((a, b) => a.pos - b.pos || porRegistro(a, b));
  let n = 1;
  while (n < clasificados.length) n *= 2;

  // Lugar del cuadro que ocupa cada sembrado (1 es el primero).
  const siembra = ordenDeSiembra(n);
  const lugarDe = new Map(siembra.map((s, lugar) => [s, lugar] as const));
  const rondas = Math.log2(n);

  /** Cuánto estorba un acomodo: cruces del mismo grupo, peor si son pronto. */
  const costo = (sembrados: typeof clasificados) => {
    let c = 0;
    for (let i = 0; i < sembrados.length; i++)
      for (let j = i + 1; j < sembrados.length; j++)
        if (sembrados[i].grupo === sembrados[j].grupo)
          c += 2 ** (rondas - 1 - rondaDeCruce(lugarDe.get(i + 1)!, lugarDe.get(j + 1)!));
    return c;
  };

  // Cada nivel (segundos, terceros…) se reacomoda sin tocar a los demás.
  // Con hasta ocho grupos se prueban todos los acomodos; con más se deja
  // el orden de los grupos, que es como funcionaba antes.
  let sembrados = clasificados;
  const niveles = [...new Set(clasificados.map((c) => c.pos))].filter((p) => p > 0);
  for (const nivel of niveles) {
    const desde = sembrados.findIndex((c) => c.pos === nivel);
    const delNivel = sembrados.filter((c) => c.pos === nivel);
    if (delNivel.length > 8) continue;
    let mejor = sembrados;
    let mejorCosto = costo(sembrados);
    for (const perm of permutaciones(delNivel)) {
      const prueba = [...sembrados.slice(0, desde), ...perm, ...sembrados.slice(desde + perm.length)];
      const c = costo(prueba);
      if (c < mejorCosto) {
        mejor = prueba;
        mejorCosto = c;
      }
    }
    sembrados = mejor;
  }

  const slots: Array<string | null> = siembra.map((s) => sembrados[s - 1]?.id ?? null);

  const finales: Partido[] = [];
  for (let i = 0; i < n / 2; i++) {
    finales.push({
      id: id(),
      etapa: "final",
      ronda: 0,
      slot: i,
      aId: slots[2 * i],
      bId: slots[2 * i + 1],
      mesa: 0,
      orden: i,
      eventos: [],
    });
  }
  let cuantos = n / 2;
  let r = 1;
  let orden = n / 2;
  while (cuantos > 1) {
    cuantos /= 2;
    for (let i = 0; i < cuantos; i++) {
      finales.push({
        id: id(),
        etapa: "final",
        ronda: r,
        slot: i,
        aId: null,
        bId: null,
        mesa: 0,
        orden: orden++,
        eventos: [],
      });
    }
    r++;
  }

  propagar(finales, setsParaGrupos, exigirValidacion);
  return finales;
}

/**
 * Sube los ganadores a la ronda siguiente. En la primera ronda, quien no
 * tiene rival pasa directo; en las demás, un lugar vacío es un ganador que
 * todavía no se conoce.
 *
 * Se llama cada vez que entra un resultado de un árbitro: es lo que hace
 * que un cruce de la ronda siguiente quede definido —y con eso, listo para
 * que la asignación de mesas lo proponga— en cuanto se cierra el anterior.
 */
export function propagar(
  finales: Partido[],
  setsPara: number | ((p: Partido) => number),
  exigirValidacion = false,
): void {
  if (!finales.length) return;
  //Cada partido puede ir a distintos sets (semis y final a mas)
  const sets = typeof setsPara === "function" ? setsPara : () => setsPara;
  const rondas = Math.max(...finales.map((p) => p.ronda ?? 0)) + 1;

  for (let r = 0; r < rondas - 1; r++) {
    for (const p of finales.filter((x) => x.ronda === r)) {
      let g: string | null;
      //Solo en la primera ronda un lugar vacio es descanso; despues es un ganador que falta
      if (r === 0 && p.aId && !p.bId) g = p.aId;
      else if (r === 0 && !p.aId && p.bId) g = p.bId;
      else g = ganadorDe(p, sets(p), exigirValidacion);

      const sig = finales.find((x) => x.ronda === r + 1 && x.slot === Math.floor((p.slot ?? 0) / 2));
      if (!sig) continue;
      if ((p.slot ?? 0) % 2 === 0) sig.aId = g;
      else sig.bId = g;
    }
  }
}

/** Nombre de la ronda contando hacia atrás desde la final. */
export function nombreRonda(ronda: number, totalRondas: number): string {
  const faltan = totalRondas - 1 - ronda;
  if (faltan === 0) return "Final";
  if (faltan === 1) return "Semifinal";
  if (faltan === 2) return "Cuartos de final";
  if (faltan === 3) return "Octavos de final";
  if (faltan === 4) return "Dieciseisavos";
  return `Ronda ${ronda + 1}`;
}

/** Cuántas rondas tiene la llave. */
export const rondasDeLlave = (partidos: Partido[]): number => {
  const finales = partidos.filter((p) => p.etapa === "final");
  return finales.length ? Math.max(...finales.map((p) => p.ronda ?? 0)) + 1 : 0;
};

/**
 * Cómo se llama la fase de este partido.
 *
 * «Grupo B» o «Cuartos de final», no «grupo» o «eliminatoria». Es lo que
 * dice la gente en el gimnasio, y lo que un jugador necesita leer en la
 * pantalla para saber de qué le están hablando.
 */
export function etiquetaEtapa(t: { grupos: Grupo[]; partidos: Partido[] }, p: Partido): string {
  if (p.etapa === "grupo" && p.jornada) return `Jornada ${p.jornada}`;
  if (p.etapa === "grupo") {
    return t.grupos.find((g) => g.id === p.grupoId)?.nombre ?? "Fase de grupos";
  }
  return nombreRonda(p.ronda ?? 0, rondasDeLlave(t.partidos));
}

export interface Podio {
  campeon: string | null;
  subcampeon: string | null;
  /** Los dos que perdieron en semifinales. El reglamento no los separa. */
  terceros: string[];
}

/**
 * Quién ganó, cuando ya se puede decir.
 *
 * Devuelve null mientras la final no esté resuelta: un podio a medias en
 * la pantalla del gimnasio se lee como resultado, y no lo es.
 */
export function podio(
  t: {
    grupos: Grupo[];
    partidos: Partido[];
    formatoFinales: number;
    formatoSemis?: number;
    validacionObligatoria: boolean;
    sistema?: Sistema;
    formatoGrupos?: number;
  },
): Podio | null {
  /*
   * En todos contra todos no hay final: decide la tabla, y solo cuando
   * todos los partidos cuentan. Aquí sí hay un tercer lugar único, porque
   * la tabla separa a todos.
   */
  if (t.sistema === "todos") {
    const gr = t.grupos[0];
    const setsG = t.formatoGrupos ?? 2;
    if (!gr || pendientesDeGrupo(t.partidos, setsG, t.validacionObligatoria) > 0) return null;
    if (!t.partidos.some((p) => p.etapa === "grupo")) return null;
    const ord = clasificar(gr.jugadores, t.partidos.filter((p) => p.grupoId === gr.id), setsG, t.validacionObligatoria);
    if (ord.length < 2) return null;
    return { campeon: ord[0], subcampeon: ord[1], terceros: ord[2] ? [ord[2]] : [] };
  }

  const finales = t.partidos.filter((p) => p.etapa === "final");
  if (!finales.length) return null;
  const ultima = rondasDeLlave(t.partidos) - 1;
  const final = finales.find((p) => p.ronda === ultima);
  if (!final) return null;

  const campeon = ganadorDe(final, setsDe(t, final), t.validacionObligatoria);
  if (!campeon) return null;
  const subcampeon = final.aId === campeon ? final.bId : final.aId;

  const terceros = finales
    .filter((p) => p.ronda === ultima - 1 && p.aId && p.bId)
    .map((p) => {
      const g = ganadorDe(p, setsDe(t, p), t.validacionObligatoria);
      return g ? (p.aId === g ? p.bId : p.aId) : null;
    })
    .filter((x): x is string => !!x);

  return { campeon, subcampeon, terceros };
}

export const pendientesDeGrupo = (partidos: Partido[], setsPara: number, exigirValidacion = false): number =>
  partidos.filter((p) => p.etapa === "grupo" && !partidoListo(p, setsPara, exigirValidacion)).length;
