import { etiquetaEtapa, nombreDe, reducir, setsDe } from "../nucleo";
import type { Fase, Partido, Torneo } from "../nucleo";

interface Props {
  t: Torneo;
  p: Partido;
  alAbrir?: (id: string) => void;
  /** Qué va en la columna izquierda. El juez ve la mesa; el árbitro,
      que ya está en su mesa, ve el turno dentro de su cola. */
  numero?: number;
  /** Contenido extra a la derecha: los botones del juez, por ejemplo. */
  extra?: React.ReactNode;
}

export const ETIQUETA: Record<Fase, string> = {
  "sin-iniciar": "por empezar",
  "en-juego": "en juego",
  descanso: "en descanso",
  "por-validar": "por validar",
  validado: "validado",
};

/** «+3»: los puntos con que empieza cada set por hándicap. */
export function Ventaja({ puntos }: { puntos: number }) {
  return (
    <b className="hc" title={`Hándicap: empieza cada set con ${puntos} ${puntos === 1 ? "punto" : "puntos"}`}>
      +{puntos}
    </b>
  );
}

export function TarjetaPartido({ t, p, alAbrir, numero, extra }: Props) {
  const setsPara = setsDe(t, p);
  const st = reducir(p, setsPara);
  const nom = (id: string | null) => nombreDe(t.jugadores.find((j) => j.id === id), "por definir");
  const arbitro = t.arbitros.find((x) => x.id === p.arbitroId) ?? t.arbitros.find((x) => x.mesa === p.mesa);
  const jugable = !!(p.aId && p.bId) && !!alAbrir;

  const abrir = () => jugable && alAbrir!(p.id);

  return (
    <div
      className={`pj f-${st.fase}${extra ? " con-acciones" : ""}`}
      style={jugable ? undefined : { cursor: "default" }}
      onClick={abrir}
      role={jugable ? "button" : undefined}
      tabIndex={jugable ? 0 : undefined}
      onKeyDown={(e) => {
        if (jugable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          abrir();
        }
      }}
    >
      <div className="mesa">{numero ?? (p.mesa || "–")}</div>
      <div className="quien">
        {/* El hándicap va pegado al nombre de quien lo recibe: es lo que
            se pregunta al ver el calendario, «¿con cuántos empieza?». */}
        <div className="vs">
          <span className={st.ganador === "a" ? "a gana" : "a"}>
            {nom(p.aId)}
            {st.ventaja.a > 0 && <Ventaja puntos={st.ventaja.a} />}
          </span>
          <span className="sep">VS</span>
          <span className={st.ganador === "b" ? "b gana" : "b"}>
            {nom(p.bId)}
            {st.ventaja.b > 0 && <Ventaja puntos={st.ventaja.b} />}
          </span>
        </div>
        <div className="arb">
          <b className="etapa">{etiquetaEtapa(t, p)}</b>
          {arbitro ? ` · ${arbitro.nombre}` : " · sin árbitro"}
          {p.mesa ? ` · mesa ${p.mesa}` : ""}
          {/* Con dos versiones no hay un estado ni un marcador que mostrar: los dos juntos no significan nada. */}
          {!st.conflicto && <span className={`sello ${st.fase}`}>{ETIQUETA[st.fase]}</span>}
          {st.corregido && <span className="sello corregido">corregido</span>}
          {st.porSets && <span className="sello corregido">anotado por sets</span>}
          {st.conflicto && <span className="sello conflicto">dos versiones</span>}
        </div>
      </div>
      <div className="res">
        {st.conflicto ? "¿?" : `${st.sets.a}–${st.sets.b}`}
      </div>
      {extra && <div className="acciones" onClick={(e) => e.stopPropagation()}>{extra}</div>}
    </div>
  );
}
