import { clasificar } from "./clasificacion";
import { ganadorDe, partidoListo } from "./reglas";
import type { Grupo, Partido } from "./tipos";

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
): Partido[] {
  const clasificados: Array<{ id: string; pos: number }> = [];
  for (const gr of grupos) {
    const suyos = partidos.filter((p) => p.grupoId === gr.id);
    const ord = clasificar(gr.jugadores, suyos, setsParaGrupos);
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
      eventos: [],
    });
  }
  let cuantos = n / 2;
  let r = 1;
  while (cuantos > 1) {
    cuantos /= 2;
    for (let i = 0; i < cuantos; i++) {
      finales.push({ id: id(), etapa: "final", ronda: r, slot: i, aId: null, bId: null, mesa: 0, eventos: [] });
    }
    r++;
  }

  propagar(finales, setsParaGrupos);
  return finales;
}

/** Sube los ganadores a la ronda siguiente. Un hueco pasa directo. */
export function propagar(finales: Partido[], setsPara: number): void {
  if (!finales.length) return;
  const rondas = Math.max(...finales.map((p) => p.ronda ?? 0)) + 1;

  for (let r = 0; r < rondas - 1; r++) {
    for (const p of finales.filter((x) => x.ronda === r)) {
      let g: string | null;
      if (p.aId && !p.bId) g = p.aId;
      else if (!p.aId && p.bId) g = p.bId;
      else g = ganadorDe(p, setsPara);

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
  if (faltan === 2) return "Cuartos";
  if (faltan === 3) return "Octavos";
  return `Ronda ${ronda + 1}`;
}

export const pendientesDeGrupo = (partidos: Partido[], setsPara: number): number =>
  partidos.filter((p) => p.etapa === "grupo" && !partidoListo(p, setsPara)).length;
