import { clasificar, estadisticas, etiquetaEtapa, ganadorDe, nombreDe, nombreRonda, podio, reducir, rondasDeLlave, setsDe } from "../nucleo";
import type { Torneo } from "../nucleo";

interface Props {
  t: Torneo;
  alSalir: () => void;
}

const fecha = (ms: number) =>
  new Date(ms).toLocaleString("es-MX", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

const hora = (ms: number | null) =>
  ms === null ? "—" : new Date(ms).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

/**
 * El acta del torneo, lista para imprimir o guardar como PDF.
 *
 * No se genera con una biblioteca de PDF: es una página con estilos de
 * impresión, y el propio navegador la convierte con «Guardar como PDF».
 * Eso evita añadir una dependencia pesada al proyecto y, sobre todo, evita
 * que el documento dependa de que esa biblioteca siga existiendo dentro de
 * cinco años, cuando alguien quiera reimprimir un acta.
 *
 * Lleva todo lo que hace falta para reconstruir la jornada sin el sistema
 * delante: quién jugó, cómo se sorteó, qué pasó en cada partido, quién
 * corrigió qué y por qué, y cómo se llegó al campeón.
 */
export function Informe({ t, alSalir }: Props) {
  const nom = (id: string | null) => nombreDe(t.jugadores.find((j) => j.id === id));
  /**
   * En qué mesa y con qué árbitro se jugó.
   *
   * `p.mesa` vuelve a cero cuando el juez libera la mesa al terminar el
   * partido, así que a la hora de escribir el acta ya no está. El árbitro
   * sí queda pegado al partido, y su mesa es la que se ocupó.
   */
  const dondeYQuien = (p: { mesa: number; arbitroId?: string }) => {
    const a = t.arbitros.find((x) => x.id === p.arbitroId) ?? null;
    const mesa = p.mesa || a?.mesa || 0;
    if (!mesa && !a) return "—";
    if (!a) return `Mesa ${mesa}`;
    return mesa ? `Mesa ${mesa} · ${a.nombre}` : a.nombre;
  };
  const club = (id: string | null) => t.jugadores.find((j) => j.id === id)?.club ?? "";
  const exigir = t.validacionObligatoria;
  const enParejas = t.modalidad !== "individual";
  const todos = t.sistema === "todos";
  /* Lo anotado en una mesa autogestionada lleva el nombre de quien anotó. */
  const autogestion = (p: { eventos: Array<{ por: string }> }): string | null => {
    const por = p.eventos.find((e) => e.por.startsWith("autogestion:"))?.por;
    if (!por) return null;
    return `Mesa autogestionada · ${por.split(":").slice(2).join(":") || "sin nombre"}`;
  };
  const p3 = podio(t);
  const rondas = rondasDeLlave(t.partidos);
  const finales = t.partidos.filter((x) => x.etapa === "final");

  const conEstado = t.partidos
    .filter((p) => p.aId && p.bId)
    .map((p) => ({ p, st: reducir(p, setsDe(t, p)) }));
  const jugados = conEstado.filter((x) => x.st.terminado).sort((a, b) => (a.st.hasta ?? 0) - (b.st.hasta ?? 0));
  const corregidos = conEstado.filter((x) => x.st.correccion);
  /* Las tarjetas de toda la jornada, en el orden en que se sacaron. */
  const sanciones = conEstado
    .flatMap(({ p, st }) => st.tarjetas.map((x) => ({ p, x })))
    .sort((u, v) => u.x.ts - v.x.ts);
  const tiempos = conEstado.reduce(
    (n, { p }) => n + p.eventos.filter((e) => e.t === "tiempo").length,
    0,
  );

  const primero = jugados[0]?.st.desde ?? null;
  const ultimo = jugados[jugados.length - 1]?.st.hasta ?? null;

  return (
    <div className="informe">
      <div className="inf-barra">
        <button className="btn" onClick={() => window.print()}>
          Guardar como PDF o imprimir
        </button>
        <button className="btn leve" onClick={alSalir}>
          Volver
        </button>
        <span className="sub">
          En el diálogo de impresión, elige «Guardar como PDF» en el destino.
        </span>
      </div>

      <article className="hoja">
        <header className="inf-cab">
          <h1>{t.nombre || "Torneo"}</h1>
          <p>
            {t.sede && `${t.sede} · `}
            {primero ? fecha(primero) : "sin partidos jugados"}
          </p>
          <p className="inf-sub">
            Acta generada el {fecha(Date.now())} · TTorneo v{__VERSION__}
          </p>
        </header>

        {/* ---------- resultado ---------- */}
        {p3 && (
          <section>
            <h2>Resultado final</h2>
            <ol className="inf-podio">
              <li>
                <span className="puesto">1.º</span>
                <b>{nom(p3.campeon)}</b>
                <em>{club(p3.campeon)}</em>
              </li>
              <li>
                <span className="puesto">2.º</span>
                <b>{nom(p3.subcampeon)}</b>
                <em>{club(p3.subcampeon)}</em>
              </li>
              {p3.terceros.map((x) => (
                <li key={x}>
                  <span className="puesto">3.º</span>
                  <b>{nom(x)}</b>
                  <em>{club(x)}</em>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* ---------- formato ---------- */}
        <section>
          <h2>Formato</h2>
          <table className="inf-datos">
            <tbody>
              <tr>
                <th>Categoría</th>
                <td>
                  {t.modalidad === "dobles"
                    ? "Dobles"
                    : t.modalidad === "mixtos"
                      ? "Dobles mixtos"
                      : "Individual"}
                </td>
              </tr>
              <tr>
                <th>Mesas</th>
                <td>{t.mesas}</td>
              </tr>
              {todos ? (
                <tr>
                  <th>Sistema</th>
                  <td>
                    todos contra todos, una vuelta, al mejor de {t.formatoGrupos * 2 - 1}; sin eliminatoria, decide la
                    tabla
                  </td>
                </tr>
              ) : (
                <>
                  <tr>
                    <th>Fase de grupos</th>
                    <td>
                      {t.nGrupos} {t.nGrupos === 1 ? "grupo" : "grupos"}, al mejor de {t.formatoGrupos * 2 - 1}, avanzan{" "}
                      {t.clasifican} de cada uno
                    </td>
                  </tr>
                  <tr>
                    <th>Eliminatoria</th>
                    <td>al mejor de {t.formatoFinales * 2 - 1}</td>
                  </tr>
                </>
              )}
              <tr>
                <th>Reglas</th>
                <td>
                  {t.reglamento === "formal"
                    ? "formal, reglamento ITTF: sets a 11 con dos de diferencia"
                    : `amateur, sets a ${t.puntosSet ?? 11} puntos con dos de diferencia`}
                </td>
              </tr>
              {t.handicap?.activo && t.reglamento !== "formal" && (
                <tr>
                  <th>Hándicap</th>
                  <td>
                    {t.handicap.base === "lugar"
                      ? `${t.handicap.porLugar ?? 1} puntos de ventaja por cada lugar de diferencia en la lista ordenada, hasta ${t.handicap.tope} por set`
                      : `un punto de ventaja por cada ${t.handicap.escalon} de diferencia de ranking, hasta ${t.handicap.tope} por set`}
                  </td>
                </tr>
              )}
              {t.siembraManual && (
                <tr>
                  <th>Siembra</th>
                  <td>por el orden que fijó la mesa de control, no por ranking</td>
                </tr>
              )}
              <tr>
                <th>Descansos</th>
                <td>
                  {t.descansoSet} min entre sets · {t.descansoJugador} min entre partidos
                </td>
              </tr>
              <tr>
                <th>Validación</th>
                <td>{exigir ? "los resultados pasaron por la mesa de control" : "sin validación previa"}</td>
              </tr>
              {primero && ultimo && (
                <tr>
                  <th>Jornada</th>
                  <td>
                    de {hora(primero)} a {hora(ultimo)} · {jugados.length} partidos
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* ---------- inscritos ---------- */}
        <section>
          <h2>{enParejas ? "Parejas inscritas" : "Jugadores inscritos"} ({t.jugadores.length})</h2>
          <table className="inf-tabla">
            <thead>
              <tr>
                <th>#</th>
                <th>{enParejas ? "Pareja" : "Jugador"}</th>
                <th>Club</th>
                <th>Ranking</th>
              </tr>
            </thead>
            <tbody>
              {[...t.jugadores]
                .sort((a, b) => b.rank - a.rank)
                .map((j, i) => (
                  <tr key={j.id}>
                    <td>{i + 1}</td>
                    <td>{nombreDe(j)}</td>
                    <td>{j.club || "—"}</td>
                    <td>{j.rank || "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>

        {/* ---------- sorteo ---------- */}
        {t.actaSorteo.length > 0 && (
          <section>
            <h2>Acta del sorteo</h2>
            {t.semillaSorteo > 0 && (
              <p className="inf-nota">
                Sorteo generado por computadora con la semilla <b>{t.semillaSorteo}</b>. Con ese número el reparto se
                reproduce idéntico.
              </p>
            )}
            <ol className="inf-acta">
              {t.actaSorteo.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ol>
            {t.relajaciones.length > 0 && (
              <>
                <h3>Restricciones que no se pudieron cumplir</h3>
                <ul className="inf-acta">
                  {t.relajaciones.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        {/* ---------- grupos ---------- */}
        {t.grupos.length > 0 && (
          <section>
            <h2>{todos ? "Tabla final" : "Fase de grupos"}</h2>
            {t.grupos.map((g) => {
              const suyos = t.partidos.filter((p) => p.grupoId === g.id);
              const orden = clasificar(g.jugadores, suyos, t.formatoGrupos, exigir);
              const m = estadisticas(g.jugadores, suyos, t.formatoGrupos, exigir);
              return (
                <div key={g.id} className="inf-grupo">
                  <h3>{g.nombre}</h3>
                  <table className="inf-tabla">
                    <thead>
                      <tr>
                        <th />
                        <th>{enParejas ? "Pareja" : "Jugador"}</th>
                        <th>PJ</th>
                        <th>PG</th>
                        <th>PP</th>
                        <th>Sets</th>
                        <th>Puntos</th>
                        <th>Pts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orden.map((id, i) => (
                        <tr key={id} className={!todos && i < t.clasifican ? "clasifica" : undefined}>
                          <td>{i + 1}</td>
                          <td>
                            {nom(id)}
                            {!todos && i < t.clasifican ? " ✓" : ""}
                          </td>
                          <td>{m[id].pj}</td>
                          <td>{m[id].pg}</td>
                          <td>{m[id].pp}</td>
                          <td>
                            {m[id].sg}–{m[id].sp}
                          </td>
                          <td>
                            {m[id].tg}–{m[id].tp}
                          </td>
                          <td>{m[id].pts}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
            <p className="inf-nota">
              {todos
                ? "La tabla decide el resultado final. "
                : `Avanzan los ${t.clasifican} primeros de cada grupo, marcados con ✓. `}
              Desempates por resultado directo entre los empatados, después por cociente de sets y de puntos.
            </p>
          </section>
        )}

        {/* ---------- llave ---------- */}
        {finales.length > 0 && (
          <section>
            <h2>Llave eliminatoria</h2>
            {Array.from({ length: rondas }, (_, r) => (
              <div key={r} className="inf-ronda">
                <h3>{nombreRonda(r, rondas)}</h3>
                <table className="inf-tabla">
                  <tbody>
                    {finales
                      .filter((p) => p.ronda === r)
                      .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
                      .map((p) => {
                        const st = reducir(p, t.formatoFinales);
                        const g = ganadorDe(p, t.formatoFinales, exigir);
                        return (
                          <tr key={p.id}>
                            <td className={g === p.aId ? "gana" : undefined}>{p.aId ? nom(p.aId) : "descansa"}</td>
                            <td className="marcador">
                              {st.sets.a}–{st.sets.b}
                            </td>
                            <td className={g === p.bId ? "gana" : undefined}>{p.bId ? nom(p.bId) : "descansa"}</td>
                            <td className="parciales">
                              {st.historial.map((x) => `${x.a}-${x.b}`).join(", ") || "—"}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            ))}
          </section>
        )}

        {/* ---------- todos los partidos ---------- */}
        <section>
          <h2>Orden de juego y resultados ({jugados.length})</h2>
          <table className="inf-tabla">
            <thead>
              <tr>
                <th>#</th>
                <th>Fase</th>
                <th>Partido</th>
                <th>Sets</th>
                <th>Parciales</th>
                <th>Mesa y árbitro</th>
                <th>Fin</th>
              </tr>
            </thead>
            <tbody>
              {jugados.map(({ p, st }, i) => (
                <tr key={p.id}>
                  <td>{i + 1}</td>
                  <td>{etiquetaEtapa(t, p)}</td>
                  <td>
                    <span className={st.ganador === "a" ? "gana" : undefined}>{nom(p.aId)}</span>
                    {" vs "}
                    <span className={st.ganador === "b" ? "gana" : undefined}>{nom(p.bId)}</span>
                  </td>
                  <td className="marcador">
                    {st.sets.a}–{st.sets.b}
                    {st.descalificado && <em className="marca"> desc.</em>}
                  </td>
                  <td className="parciales">
                    {st.historial.map((x) => `${x.a}-${x.b}`).join(", ")}
                    {(st.ventaja.a > 0 || st.ventaja.b > 0) && (
                      <em className="marca"> hándicap +{st.ventaja.a || st.ventaja.b} a {nom(st.ventaja.a ? p.aId : p.bId)}</em>
                    )}
                  </td>
                  <td>{autogestion(p) ?? dondeYQuien(p)}</td>
                  <td>{hora(st.hasta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!jugados.length && <p className="inf-nota">Todavía no ha terminado ningún partido.</p>}
          {jugados.some(({ st }) => st.descalificado) && (
            <p className="inf-nota">
              «desc.» marca los partidos que acabaron por descalificación: al que la recibió se le dio por perdido y al
              contrario se le completaron los sets que le faltaban. El motivo está en la sección de tarjetas.
            </p>
          )}
        </section>

        {/* ---------- correcciones ---------- */}
        <section>
          <h2>Correcciones de la mesa de control ({corregidos.length})</h2>
          {corregidos.length ? (
            <table className="inf-tabla">
              <thead>
                <tr>
                  <th>Partido</th>
                  <th>Quedó</th>
                  <th>Quién</th>
                  <th>Motivo</th>
                  <th>Cuándo</th>
                </tr>
              </thead>
              <tbody>
                {corregidos.map(({ p, st }) => (
                  <tr key={p.id}>
                    <td>
                      {nom(p.aId)} vs {nom(p.bId)}
                    </td>
                    <td className="marcador">
                      {st.sets.a}–{st.sets.b}
                    </td>
                    <td>{st.correccion?.por}</td>
                    <td>{st.correccion?.nota || "—"}</td>
                    <td>{hora(st.correccion?.ts ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="inf-nota">
              Ningún resultado fue modificado por la mesa de control. Todos los marcadores son los que registraron los
              árbitros en la mesa.
            </p>
          )}
        </section>

        {/* ---------- disciplina ---------- */}
        <section>
          <h2>Tarjetas y tiempos muertos</h2>
          {sanciones.length ? (
            <table className="inf-tabla">
              <thead>
                <tr>
                  <th>Partido</th>
                  <th>Fase</th>
                  <th>A quién</th>
                  <th>Tarjeta</th>
                  <th>Motivo</th>
                  <th>Árbitro</th>
                  <th>Hora</th>
                </tr>
              </thead>
              <tbody>
                {sanciones.map(({ p, x }, i) => (
                  <tr key={i}>
                    <td>
                      {nom(p.aId)} vs {nom(p.bId)}
                    </td>
                    <td>{etiquetaEtapa(t, p)}</td>
                    <td>{nom(x.lado === "a" ? p.aId : p.bId)}</td>
                    <td>
                      {x.color === "roja" ? "Roja · descalifica" : "Amarilla"}
                      {x.puntos ? ` · ${x.puntos} ${x.puntos === 1 ? "punto" : "puntos"} al contrario` : ""}
                    </td>
                    <td>{x.motivo || "—"}</td>
                    <td>{x.por}</td>
                    <td>{hora(x.ts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="inf-nota">No se sacó ninguna tarjeta en toda la jornada.</p>
          )}
          <p className="inf-nota">
            Tiempos muertos pedidos: {tiempos}. El reglamento da uno por lado y por partido, de {t.duracionTiempo || 60}{" "}
            segundos.
          </p>
        </section>

        {/* ---------- árbitros ---------- */}
        <section>
          <h2>Cuerpo arbitral</h2>
          <table className="inf-tabla">
            <thead>
              <tr>
                <th>Mesa</th>
                <th>Árbitro</th>
                <th>Partidos dirigidos</th>
              </tr>
            </thead>
            <tbody>
              {[...t.arbitros]
                .sort((a, b) => a.mesa - b.mesa)
                .map((a) => (
                  <tr key={a.id}>
                    <td>{a.mesa}</td>
                    <td>{a.nombre}</td>
                    <td>{jugados.filter(({ p }) => p.arbitroId === a.id).length}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!t.arbitros.length && <p className="inf-nota">No se registraron árbitros.</p>}
        </section>

        <footer className="inf-pie">
          <p>
            Acta generada por TTorneo. El registro completo del torneo —cada punto, con su hora y su autor— está en el
            archivo descargable, y permite reconstruir cualquier partido de esta acta.
          </p>
        </footer>
      </article>
    </div>
  );
}
