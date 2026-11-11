import { useState } from "react";
import { nombreDe, reducir, setsDe } from "../nucleo";
import type { Evento, Partido, Torneo } from "../nucleo";
import { corrige, valida } from "../almacen";
import { TarjetaPartido } from "./TarjetaPartido";

interface Props {
  t: Torneo;
  anotarEn: (partidoId: string, ...evs: Evento[]) => void;
  cambiarEstructura: (fn: (d: Torneo) => void) => void;
  alAbrir: (id: string) => void;
  quien: string;
}

type Parcial = { a: string; b: string };

/**
 * Los resultados que mandan los árbitros.
 *
 * El árbitro cierra el partido; el juez lo hace oficial. Esa separación
 * es la que pidió el reglamento de la casa y la que hace que un error de
 * captura no mueva la tabla antes de que alguien lo mire.
 *
 * Corregir no borra: el marcador que escribe el juez se guarda como un
 * evento más, encima del registro del árbitro, con su nombre y su razón.
 * Se puede reconstruir qué se anotó en la mesa y qué decidió la mesa de
 * control, que es justo lo que hace falta cuando alguien reclama.
 */
export function Resultados({ t, anotarEn, cambiarEstructura, alAbrir, quien }: Props) {
  /**
   * Aceptar un resultado y soltar su mesa son el mismo gesto.
   *
   * Separarlos obligaba al juez a acordarse de un segundo botón, y hasta
   * que lo pulsaba la mesa seguía contando como ocupada: la propuesta no
   * ofrecía nada para ella y la proyección daba esperas de más.
   */
  const aceptar = (partidoId: string) => {
    anotarEn(partidoId, valida(quien));
    cambiarEstructura((d) => {
      const p = d.partidos.find((x) => x.id === partidoId);
      // La mesa queda libre, pero el partido conserva dónde se jugó y con
      // qué árbitro: el acta los necesita después.
      if (p) {
        if (p.mesa) p.jugadaEn = p.mesa;
        p.mesa = 0;
      }
    });
  };

  const [corrigiendo, setCorrigiendo] = useState<string | null>(null);
  const [sets, setSets] = useState<Parcial[]>([]);
  const [nota, setNota] = useState("");

  const conEstado = t.partidos
    .filter((p) => p.aId && p.bId)
    .map((p) => ({ p, st: reducir(p, setsDe(t, p)) }));

  const porValidar = conEstado.filter((x) => x.st.fase === "por-validar");
  const listos = conEstado
    .filter((x) => x.st.fase === "validado" || (x.st.terminado && !t.validacionObligatoria))
    .sort((x, y) => (y.st.hasta ?? 0) - (x.st.hasta ?? 0));

  function abrirCorreccion(p: Partido) {
    const st = reducir(p, setsDe(t, p));
    setCorrigiendo(p.id);
    setNota("");
    setSets(
      st.historial.length
        ? st.historial.map((s) => ({ a: String(s.a), b: String(s.b) }))
        : [{ a: "", b: "" }],
    );
  }

  function guardarCorreccion(p: Partido) {
    const limpios = sets
      .map((s) => ({ a: Number(s.a), b: Number(s.b) }))
      .filter((s) => Number.isFinite(s.a) && Number.isFinite(s.b) && (s.a > 0 || s.b > 0));
    if (!limpios.length) return;
    anotarEn(p.id, corrige(limpios, nota.trim(), quien));
    setCorrigiendo(null);
  }

  const editor = (p: Partido) => {
    const maxSets = setsDe(t, p) * 2 - 1;
    const nomA = nombreDe(t.jugadores.find((j) => j.id === p.aId), "A");
    const nomB = nombreDe(t.jugadores.find((j) => j.id === p.bId), "B");
    return (
      <div className="corrector">
        <p className="sub">
          Escribe los parciales tal como quedaron en la hoja. Manda esto sobre lo que anotó el árbitro; el registro
          original se conserva debajo.
        </p>
        <div className="parciales-edit">
          <div className="cabecera">
            <span />
            <span>{nomA}</span>
            <span>{nomB}</span>
          </div>
          {sets.map((s, i) => (
            <div className="renglon" key={i}>
              <span>Set {i + 1}</span>
              <input
                type="number"
                min={0}
                value={s.a}
                onChange={(e) => setSets(sets.map((x, k) => (k === i ? { ...x, a: e.target.value } : x)))}
              />
              <input
                type="number"
                min={0}
                value={s.b}
                onChange={(e) => setSets(sets.map((x, k) => (k === i ? { ...x, b: e.target.value } : x)))}
              />
            </div>
          ))}
        </div>
        <div className="fila">
          {sets.length < maxSets && (
            <button className="btn leve" onClick={() => setSets([...sets, { a: "", b: "" }])}>
              Añadir set
            </button>
          )}
          {sets.length > 1 && (
            <button className="btn leve" onClick={() => setSets(sets.slice(0, -1))}>
              Quitar el último
            </button>
          )}
        </div>
        <label className="f">
          <span>Por qué se corrige</span>
          <input
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="El árbitro anotó al revés el segundo set"
          />
        </label>
        <div className="fila">
          <button className="btn" onClick={() => guardarCorreccion(p)}>
            Guardar la corrección
          </button>
          <button className="btn leve" onClick={() => setCorrigiendo(null)}>
            Cancelar
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="sec">
        <h2>Resultados</h2>
        <p className="sub">
          {t.validacionObligatoria
            ? "Los partidos que cierran los árbitros esperan aquí. Hasta que los aceptes no mueven la tabla ni el cuadro."
            : "La validación está apagada: los resultados cuentan en cuanto el árbitro cierra el partido. Puedes corregirlos igualmente."}
        </p>
      </div>

      <div className="sec compacta">
        <h3 className="sub-titulo">
          Esperando tu visto bueno {porValidar.length > 0 && <b className="cuenta">{porValidar.length}</b>}
        </h3>
      </div>

      {porValidar.map(({ p, st }) => (
        <div key={p.id}>
          <TarjetaPartido
            t={t}
            p={p}
            alAbrir={alAbrir}
            extra={
              corrigiendo === p.id ? null : (
                <>
                  <button className="btn chico" onClick={() => aceptar(p.id)}>
                    Aceptar y liberar la mesa
                  </button>
                  <button className="btn chico leve" onClick={() => abrirCorreccion(p)}>
                    Corregir
                  </button>
                </>
              )
            }
          />
          {corrigiendo === p.id && editor(p)}
          {st.historial.length > 0 && corrigiendo !== p.id && (
            <p className="detalle-sets">
              Parciales: {st.historial.map((s) => `${s.a}-${s.b}`).join(", ")}
              {st.desde && st.hasta ? ` · ${Math.round((st.hasta - st.desde) / 60000)} min` : ""}
            </p>
          )}
        </div>
      ))}
      {!porValidar.length && <p className="vacio">No hay nada esperando.</p>}

      <div className="sec compacta">
        <h3 className="sub-titulo">Ya registrados</h3>
        <p className="sub">Puedes rehacer cualquiera de estos: quedará marcado como corregido y con tu razón.</p>
      </div>

      {listos.map(({ p, st }) => (
        <div key={p.id}>
          <TarjetaPartido
            t={t}
            p={p}
            alAbrir={alAbrir}
            extra={
              corrigiendo === p.id ? null : (
                <button className="btn chico leve" onClick={() => abrirCorreccion(p)}>
                  Modificar
                </button>
              )
            }
          />
          {corrigiendo === p.id && editor(p)}
          {st.correccion && corrigiendo !== p.id && (
            <p className="detalle-sets aviso-corr">
              Corregido por {st.correccion.por}
              {st.correccion.nota ? `: ${st.correccion.nota}` : "."}
            </p>
          )}
        </div>
      ))}
      {!listos.length && <p className="vacio">Todavía no hay resultados registrados.</p>}
    </>
  );
}
