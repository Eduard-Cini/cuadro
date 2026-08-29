import { reducir } from "../nucleo";
import type { Partido, Torneo } from "../nucleo";

interface Props {
  t: Torneo;
  p: Partido;
  alAbrir: (id: string) => void;
  /** Qué va en la columna izquierda. El juez ve la mesa; el árbitro,
      que ya está en su mesa, ve el turno dentro de su cola. */
  numero?: number;
}

export function TarjetaPartido({ t, p, alAbrir, numero }: Props) {
  const setsPara = p.etapa === "final" ? t.formatoFinales : t.formatoGrupos;
  const st = reducir(p, setsPara);
  const nom = (id: string | null) => t.jugadores.find((j) => j.id === id)?.nombre ?? "por definir";
  const arbitro = t.arbitros.find((x) => x.mesa === p.mesa);
  const jugable = !!(p.aId && p.bId);

  const estado = st.terminado ? " · terminado" : p.eventos.length ? " · en juego" : "";

  return (
    <div
      className={st.terminado ? "pj fin" : "pj"}
      style={jugable ? undefined : { cursor: "default" }}
      onClick={() => jugable && alAbrir(p.id)}
      role={jugable ? "button" : undefined}
      tabIndex={jugable ? 0 : undefined}
      onKeyDown={(e) => {
        if (jugable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          alAbrir(p.id);
        }
      }}
    >
      <div className="mesa">{numero ?? p.mesa ?? "–"}</div>
      <div className="quien">
        <div className="vs">
          <span className="a">{nom(p.aId)}</span>
          <span className="sep">VS</span>
          <span className="b">{nom(p.bId)}</span>
        </div>
        <div className="arb">
          Árbitro: {arbitro ? arbitro.nombre : "sin asignar"}
          {estado}
        </div>
      </div>
      <div className="res">
        {st.sets.a}–{st.sets.b}
      </div>
    </div>
  );
}
