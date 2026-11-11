import { clasificar } from "./clasificacion";
import { ganadorDe, partidoListo } from "./reglas";
import type { Grupo, Partido, Sistema } from "./tipos";

const id = () => Math.random().toString(36).slice(2, 9);

/**
 * Arma la eliminatoria con los que avanzan de cada grupo.
 *
 * Los primeros de grupo se colocan en un extremo del cuadro y los segundos
 * en el otro, de modo que un primero y un segundo del mismo grupo solo
 * pueden volver a verse en la final. Si el número de clasificados no es
 * potencia de dos, los mejores sembrados descansan la primera ronda.
 */
export function armarCuadro(
  grupos: Grupo[],
  partidos: Partido[],
  clasifican: number,
  setsParaGrupos: number,
  exigirValidacion = false,
): Partido[] {
  const clasificados: Array<{ id: string; pos: number }> = [];
  for (const gr of grupos) {
    const suyos = partidos.filter((p) => p.grupoId === gr.id);
    const ord = clasificar(gr.jugadores, suyos, setsParaGrupos, exigirValidacion);
    for (let i = 0; i < clasifican && i < ord.length; i++) {
      clasificados.push({ id: ord[i], pos: i });
    }
  }
  if (clasificados.length < 2) return [];

  clasificados.sort((a, b) => a.pos - b.pos);
  let n = 1;
  while (n < clasificados.length) n *= 2;

  const slots: Array<string | null> = new Array(n).fill(null);
  clasificados.forEach((c, i) => (slots[i] = c.id));

  const finales: Partido[] = [];
  for (let i = 0; i < n / 2; i++) {
    finales.push({
      id: id(),
      etapa: "final",
      ronda: 0,
      slot: i,
      aId: slots[i],
      bId: slots[n - 1 - i],
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
 * Sube los ganadores a la ronda siguiente. Un hueco pasa directo.
 *
 * Se llama cada vez que entra un resultado de un árbitro: es lo que hace
 * que un cruce de la ronda siguiente quede definido —y con eso, listo para
 * que la asignación de mesas lo proponga— en cuanto se cierra el anterior.
 */
export function propagar(finales: Partido[], setsPara: number, exigirValidacion = false): void {
  if (!finales.length) return;
  const rondas = Math.max(...finales.map((p) => p.ronda ?? 0)) + 1;

  for (let r = 0; r < rondas - 1; r++) {
    for (const p of finales.filter((x) => x.ronda === r)) {
      let g: string | null;
      if (p.aId && !p.bId) g = p.aId;
      else if (!p.aId && p.bId) g = p.bId;
      else g = ganadorDe(p, setsPara, exigirValidacion);

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

  const campeon = ganadorDe(final, t.formatoFinales, t.validacionObligatoria);
  if (!campeon) return null;
  const subcampeon = final.aId === campeon ? final.bId : final.aId;

  const terceros = finales
    .filter((p) => p.ronda === ultima - 1 && p.aId && p.bId)
    .map((p) => {
      const g = ganadorDe(p, t.formatoFinales, t.validacionObligatoria);
      return g ? (p.aId === g ? p.bId : p.aId) : null;
    })
    .filter((x): x is string => !!x);

  return { campeon, subcampeon, terceros };
}

export const pendientesDeGrupo = (partidos: Partido[], setsPara: number, exigirValidacion = false): number =>
  partidos.filter((p) => p.etapa === "grupo" && !partidoListo(p, setsPara, exigirValidacion)).length;
