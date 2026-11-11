import { useEffect, useMemo, useState } from "react";
import {
  aplicarPropuesta,
  colocar,
  comoTexto,
  duracionEstimada,
  estadoMesas,
  etiquetaEtapa,
  liberarMesas,
  mesasDestino,
  moverDeMesa,
  nombreDe,
  proyectar,
  quitarDeMesa,
  reducir,
  ritmo,
  setsDe,
  sugerirAsignacion,
} from "../nucleo";
import type { Torneo } from "../nucleo";

interface Props {
  t: Torneo;
  cambiarEstructura: (fn: (d: Torneo) => void) => void;
  alAbrir: (id: string) => void;
}

/**
 * Asignación de mesas.
 *
 * El sistema propone y el juez dispone. La propuesta se calcula con lo que
 * han mandado los árbitros —qué acabó, qué cruces quedaron definidos, quién
 * viene de jugar— y se muestra con el motivo de cada decisión al lado.
 *
 * Cada mesa trae además una lista de alternativas, porque el orden del rol
 * no es la única razón para llamar a un partido. El juez sabe cosas que el
 * sistema no puede saber: que un jugador viene con una ampolla, que otro
 * juega también en el torneo de al lado y hay que sacarlo pronto, que dos
 * llevan media hora esperando. Sin alternativas, hacer lo correcto obliga a
 * salirse del sistema.
 */
export function Mesas({ t, cambiarEstructura, alAbrir }: Props) {
  const [ahora, setAhora] = useState(() => Date.now());
  const nom = (id: string | null) => nombreDe(t.jugadores.find((j) => j.id === id), "por definir");

  /*
   * El reloj corre solo.
   *
   * Antes solo se movía al pulsar «Recalcular», así que los minutos que
   * enseñaba esta pantalla eran los de la última vez que alguien la tocó:
   * validabas un partido que había acabado antes de tiempo y la espera
   * seguía diciendo lo mismo.
   */
  useEffect(() => {
    const reloj = setInterval(() => setAhora(Date.now()), 10_000);
    return () => clearInterval(reloj);
  }, []);

  const mesas = useMemo(() => estadoMesas(t), [t]);
  const propuesta = useMemo(() => sugerirAsignacion(t, ahora), [t, ahora]);
  const turnos = useMemo(() => proyectar(t, ahora), [t, ahora]);
  const marcha = useMemo(() => ritmo(t), [t]);
  const partido = (id: string) => t.partidos.find((p) => p.id === id);

  const durGrupos = duracionEstimada(t, t.formatoGrupos);
  const durFinales = duracionEstimada(t, t.formatoFinales);

  const terminadosConMesa = t.partidos.filter((p) => {
    if (!p.mesa) return false;
    const st = reducir(p, setsDe(t, p));
    return st.fase === "validado" || (st.terminado && !t.validacionObligatoria);
  }).length;

  return (
    <>
      <div className="sec">
        <h2>Mesas</h2>
        <p className="sub">Qué se juega ahora y qué propone el sistema para las que se van quedando libres.</p>

        {/* De dónde salen los minutos que se ven abajo. Sin esto, el juez
            no tiene forma de saber si la estimación es de fiar. */}
        <div className="ritmo">
          <b>
            {marcha.medido
              ? `Ritmo medido: ${durGrupos} min por partido de grupo`
              : `Ritmo supuesto: ${durGrupos} min por partido de grupo`}
          </b>
          <span>
            {marcha.medido
              ? `de ${marcha.medidos} partidos ya jugados hoy`
              : `todavía sin partidos medidos; se usa el supuesto del torneo`}
            {t.formatoFinales !== t.formatoGrupos ? ` · eliminatoria ${durFinales} min` : ""}
            {marcha.descartados > 0
              ? ` · ${marcha.descartados} descartados por tiempos que no son de juego`
              : ""}
          </span>
        </div>

        <div className="fila">
          <button className="btn leve" onClick={() => setAhora(Date.now())}>
            Recalcular ahora
          </button>
          {terminadosConMesa > 0 && (
            <button
              className="btn leve"
              title="Marca como libres las mesas de los partidos que ya validaste"
              onClick={() => cambiarEstructura((d) => void liberarMesas(d))}
            >
              Dejar libres {terminadosConMesa} {terminadosConMesa === 1 ? "mesa" : "mesas"}
            </button>
          )}
        </div>
        {terminadosConMesa > 0 && (
          <p className="sub" style={{ marginTop: ".6rem" }}>
            Hay {terminadosConMesa} {terminadosConMesa === 1 ? "partido validado que sigue ocupando su mesa" : "partidos validados que siguen ocupando su mesa"}.
            Normalmente se liberan solas al validar; este botón es para cuando quieres soltarlas a mano.
          </p>
        )}
      </div>

      {/* ---------- foto de las mesas ---------- */}
      <div className="mesas-foto">
        {mesas.map((m) => {
          const p = m.partido;
          const st = p ? reducir(p, setsDe(t, p)) : null;
          return (
            <div
              key={m.mesa}
              className={p ? `mcard ocupada ${st?.fase}` : "mcard"}
              onClick={() => p && alAbrir(p.id)}
              role={p ? "button" : undefined}
              tabIndex={p ? 0 : undefined}
              onKeyDown={(e) => {
                if (p && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  alAbrir(p.id);
                }
              }}
            >
              <div className="mnum">{m.mesa}</div>
              <div className="mcuerpo">
                {p && st ? (
                  <>
                    <b>
                      {nom(p.aId)} vs {nom(p.bId)}
                    </b>
                    <span className="mfase">{etiquetaEtapa(t, p)}</span>
                    <span>
                      {st.sets.a}–{st.sets.b}
                      {st.fase === "descanso"
                        ? " · descanso"
                        : st.fase === "en-juego"
                          ? ` · ${st.pa}-${st.pb}`
                          : " · por empezar"}
                    </span>
                  </>
                ) : (
                  <b className="libre">libre</b>
                )}
                <span className="marb">{m.arbitro || "sin árbitro"}</span>
                {/* Mover el partido: la propuesta reparte por orden de rol,
                    pero el juez sabe cosas que ella no, como qué mesa se
                    quedó sin árbitro. */}
                {p && st && !st.terminado && (
                  <span className="macciones" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    {mesasDestino(t, p.id).map((dest) => (
                      <button
                        key={dest}
                        className="btn chico leve"
                        title={`Pasar este partido a la mesa ${dest}`}
                        onClick={() => cambiarEstructura((d) => void moverDeMesa(d, p.id, dest))}
                      >
                        A la mesa {dest}
                      </button>
                    ))}
                    {p.eventos.length === 0 && (
                      <button
                        className="btn chico leve"
                        title="Quitarlo de esta mesa; vuelve a la cola"
                        onClick={() => cambiarEstructura((d) => void quitarDeMesa(d, p.id))}
                      >
                        Devolver a la cola
                      </button>
                    )}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="sub" style={{ margin: ".4rem 0 0" }}>
        Para pasar un partido a otra mesa, usa los botones de su tarjeta. Si la otra mesa tiene uno sin empezar, se
        intercambian. Un partido ya empezado solo puede ir a una mesa libre.
      </p>

      {/* ---------- la propuesta, con alternativas ---------- */}
      <div className="sec">
        <h3 className="sub-titulo">
          Qué mandar ahora{" "}
          {propuesta.asignaciones.length > 0 && <b className="cuenta">{propuesta.asignaciones.length}</b>}
        </h3>
        {propuesta.asignaciones.length ? (
          <>
            <p className="sub">
              Lo de arriba de cada lista es lo que propone el sistema. Si sabes algo que él no —quién viene tocado,
              quién juega también en otro torneo, quién lleva media hora esperando— elige otro.
            </p>
            <div className="propuestas">
              {propuesta.asignaciones.map((a) => {
                const p = partido(a.partidoId);
                if (!p) return null;
                return (
                  <div key={a.partidoId} className="ppuesta">
                    <div className="pp-cab">
                      <span className="pmesa">{a.mesa}</span>
                      <span className="pp-arb">{a.arbitroId ? a.motivo.split(";").pop()?.trim() : "sin árbitro"}</span>
                    </div>

                    <button
                      className="pp-opcion elegida"
                      onClick={() => cambiarEstructura((d) => colocar(d, a.partidoId, a.mesa))}
                    >
                      <b>
                        {nom(p.aId)} vs {nom(p.bId)}
                      </b>
                      <em>
                        {etiquetaEtapa(t, p)} · {a.motivo.split(";")[0]}
                      </em>
                      <span className="pp-marca">propuesto</span>
                    </button>

                    {a.alternativas.map((alt) => {
                      const q = partido(alt.partidoId);
                      if (!q) return null;
                      return (
                        <button
                          key={alt.partidoId}
                          className="pp-opcion"
                          onClick={() => cambiarEstructura((d) => colocar(d, alt.partidoId, a.mesa))}
                        >
                          <b>
                            {nom(q.aId)} vs {nom(q.bId)}
                          </b>
                          <em>{alt.motivo}</em>
                        </button>
                      );
                    })}
                    {!a.alternativas.length && (
                      <p className="pp-vacio">No hay más partidos que puedan entrar en esta mesa ahora.</p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="fila">
              <button className="btn" onClick={() => cambiarEstructura((d) => aplicarPropuesta(d, propuesta))}>
                Aceptar todo lo propuesto
              </button>
            </div>
          </>
        ) : (
          <p className="vacio">
            {propuesta.ociosas.length
              ? `Hay ${propuesta.ociosas.length} mesa(s) libre(s), pero ningún partido puede entrar todavía.`
              : "Todas las mesas están ocupadas."}
          </p>
        )}

        {propuesta.espera.length > 0 && (
          <details className="ayuda">
            <summary>Por qué esperan los otros {propuesta.espera.length}</summary>
            <ul className="espera">
              {propuesta.espera.slice(0, 20).map((e) => {
                const p = partido(e.partidoId);
                return (
                  <li key={e.partidoId}>
                    <b>
                      {nom(p?.aId ?? null)} vs {nom(p?.bId ?? null)}
                    </b>
                    <em>{e.razon}</em>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </div>

      {/* ---------- cómo va a caer la tarde ---------- */}
      <div className="sec">
        <h3 className="sub-titulo">Proyección</h3>
        <p className="sub">
          Cuándo empieza cada partido si el torneo sigue a este ritmo. Es lo mismo que ve el jugador en la pantalla, y
          se recalcula solo conforme entran los resultados.
        </p>
        <table className="tab-agenda">
          <thead>
            <tr>
              <th>Mesa</th>
              <th>Partido</th>
              <th className="der">Empieza</th>
            </tr>
          </thead>
          <tbody>
            {turnos.slice(0, 14).map((x) => (
              <tr key={x.partidoId} className={x.jugando ? "jugando" : undefined}>
                <td>
                  {x.mesa}
                  {!x.mesaFirme && <i title="Mesa estimada, todavía sin asignar">~</i>}
                </td>
                <td onClick={() => alAbrir(x.partidoId)} className="pulsa">
                  {nom(x.aId)} vs {nom(x.bId)}
                </td>
                <td className="der">{x.jugando ? "en juego" : comoTexto(x.espera)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!turnos.length && <p className="vacio">No hay partidos que proyectar.</p>}
      </div>
    </>
  );
}
