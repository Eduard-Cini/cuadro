import { partidoListo } from "../nucleo";
import type { Partido, Torneo } from "../nucleo";
import { TarjetaPartido } from "./TarjetaPartido";

interface Props {
  t: Torneo;
  mesa: number | null;
  alElegirMesa: (m: number) => void;
  alAbrir: (id: string) => void;
}

/**
 * Vista del árbitro de mesa. A propósito no tiene configuración, ni
 * sorteo, ni tablas: solo la cola de su mesa y el marcador.
 */
export function Arbitro({ t, mesa, alElegirMesa, alAbrir }: Props) {
  const setsPara = (p: Partido) => (p.etapa === "final" ? t.formatoFinales : t.formatoGrupos);
  const cola =
    mesa == null
      ? []
      : t.partidos
          .filter((p) => p.mesa === mesa && p.aId && p.bId)
          .sort((a, b) => Number(partidoListo(a, setsPara(a))) - Number(partidoListo(b, setsPara(b))));

  return (
    <div>
      <div className="sec">
        <h2>Tu mesa</h2>
        <p className="sub">Elige el número de mesa que te tocó. Solo verás los partidos de esa mesa.</p>
        <div className="mesabtns">
          {Array.from({ length: Math.max(1, t.mesas) }, (_, i) => i + 1).map((m) => (
            <button
              key={m}
              className={mesa === m ? "mesabtn on" : "mesabtn"}
              onClick={() => alElegirMesa(m)}
              aria-pressed={mesa === m}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {cola.map((p, i) => (
        <TarjetaPartido key={p.id} t={t} p={p} alAbrir={alAbrir} numero={i + 1} />
      ))}

      {!cola.length && (
        <p className="vacio">
          {mesa == null ? "Elige tu mesa arriba." : `No hay partidos en la mesa ${mesa} todavía.`}
        </p>
      )}
    </div>
  );
}
