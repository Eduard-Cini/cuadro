import { useEffect, useMemo, useState } from "react";
import {
  clasificar,
  comoTexto,
  estadisticas,
  estadoMesas,
  etiquetaEtapa,
  nombreDe,
  podio,
  proyectar,
  reducir,
  ritmo,
  setsDe,
} from "../nucleo";
import type { EstadoPartido, Partido, Torneo } from "../nucleo";
import type { Conexion } from "../red";
import { Ventaja } from "./TarjetaPartido";

interface Props {
  t: Torneo;
  conexion: Conexion;
  alSalir: () => void;
}

/** Cuántos entran en una pantalla sin que haya que entrecerrar los ojos. */
const SIGUIENTES = 8;
const RESULTADOS = 7;
/** Acabado el torneo ya no compite con nada: cabe la jornada entera. */
const RESULTADOS_FIN = 24;
/** Por debajo de esto, al jugador se le pide que se acerque a la mesa. */
const INMINENTE = 6;

const hora = (ms: number) =>
  new Date(ms).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

interface TablaProps {
  filas: Array<{ p: Partido; st: EstadoPartido }>;
  t: Torneo;
  nom: (id: string | null) => string;
  etapaCorta: (p: Partido) => string;
}

/** Los partidos que ya se jugaron, con su marcador y sus parciales. */
function Tabla({ filas, t, nom, etapaCorta }: TablaProps) {
  if (!filas.length) return <p className="pt-vacio">Todavía no ha terminado ningún partido.</p>;
  return (
    <table className="pt-tabla resultados">
      <tbody>
        {filas.map(({ p, st }) => (
          <tr key={p.id}>
            <td className="mesa" title={etiquetaEtapa(t, p)}>
              {etapaCorta(p)}
            </td>
            <td>
              <b className={st.ganador === "a" ? "gana" : undefined}>
                {nom(p.aId)}
                {st.ventaja.a > 0 && <Ventaja puntos={st.ventaja.a} />}
              </b>
              <span className="vs">vs</span>
              <b className={st.ganador === "b" ? "gana" : undefined}>
                {nom(p.bId)}
                {st.ventaja.b > 0 && <Ventaja puntos={st.ventaja.b} />}
              </b>
              <span className="parciales">
                {st.historial.map((s, i) => (
                  <span key={i}>
                    {s.a}-{s.b}
                  </span>
                ))}
              </span>
            </td>
            <td className="der marcador">
              {st.sets.a}–{st.sets.b}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * La pantalla del gimnasio.
 *
 * Contesta las tres preguntas por las que un jugador se acerca a la mesa
 * de control a preguntar, que son las que interrumpen al juez toda la
 * tarde: qué se está jugando, cuándo me toca y contra quién, y cómo quedó
 * el partido anterior. No tiene controles: se abre y se deja puesta.
 */
export function Pantalla({ t, conexion, alSalir }: Props) {
  const [ahora, setAhora] = useState(() => Date.now());

  // Las esperas se recalculan solas: la pantalla se queda encendida horas
  // y nadie va a estar refrescándola.
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  const nom = (id: string | null) => nombreDe(t.jugadores.find((j) => j.id === id), "por definir");
  const todos = t.sistema === "todos";
  /** Dónde se jugó: la jornada en todos contra todos, la letra del grupo o
      «EL» en la eliminatoria. La mesa ya se liberó y no diría nada. */
  const etapaCorta = (p: Partido) =>
    p.jornada
      ? `J${p.jornada}`
      : p.etapa === "final"
        ? "EL"
        : (t.grupos.find((g) => g.id === p.grupoId)?.nombre.split(" ").pop() ?? "–");
  /** Hándicap de un partido por jugar, para la fila de siguientes. */
  const ventajaDe = (id: string) => t.partidos.find((p) => p.id === id)?.ventaja;
  const club = (id: string | null) => t.jugadores.find((j) => j.id === id)?.club ?? "";

  const turnos = useMemo(() => proyectar(t, ahora), [t, ahora]);
  const mesas = useMemo(() => estadoMesas(t), [t]);
  const marcha = useMemo(() => ritmo(t), [t]);

  const siguientes = turnos.filter((x) => !x.jugando).slice(0, SIGUIENTES);

  /* Lo que ya se jugó, de lo más reciente a lo más viejo. */
  const jugados = useMemo(() => {
    const listos = t.partidos
      .filter((p) => p.aId && p.bId)
      .map((p) => ({ p, st: reducir(p, setsDe(t, p)) }))
      .filter((x) => x.st.terminado);
    listos.sort((x, y) => (y.st.hasta ?? 0) - (x.st.hasta ?? 0));
    return listos;
  }, [t]);

  const faltan = t.partidos.filter((p) => p.aId && p.bId && !reducir(p, setsDe(t, p)).terminado).length;

  /* Con la final resuelta y nada por jugar, la pantalla deja de ser un
     panel de avisos y pasa a ser la premiación: es lo único que la gente
     va a estar mirando, y las mesas vacías no dicen nada. */
  const p3 = useMemo(() => podio(t), [t]);
  const terminado = p3 !== null && faltan === 0;
  const terminados = jugados.slice(0, RESULTADOS);
  /* Al terminar, los dos lados dejan de competir por el mismo hueco: la
     eliminatoria a la izquierda y los grupos a la derecha. */
  const deLlave = jugados.filter((x) => x.p.etapa === "final");
  const deGrupos = jugados.filter((x) => x.p.etapa === "grupo").slice(0, RESULTADOS_FIN);

  /* En todos contra todos lo que decide es la tabla, así que va en
     pantalla toda la tarde, no solo al final. */
  const tabla = useMemo(() => {
    const gr = t.grupos[0];
    if (!todos || !gr) return null;
    const suyos = t.partidos.filter((p) => p.grupoId === gr.id);
    return {
      orden: clasificar(gr.jugadores, suyos, t.formatoGrupos, t.validacionObligatoria),
      filas: estadisticas(gr.jugadores, suyos, t.formatoGrupos, t.validacionObligatoria),
    };
  }, [t, todos]);
  const puntosSet = t.reglamento === "formal" ? 11 : (t.puntosSet ?? 11);

  return (
    <div className="pantalla">
      <header className="pt-top">
        <h1>{t.nombre || "Torneo"}</h1>
        <div className="pt-meta">
          {t.sede && <span>{t.sede}</span>}
          <span>{hora(ahora)}</span>
          <span>{faltan} partidos por jugar</span>
          {puntosSet !== 11 && <span>sets a {puntosSet}</span>}
          <span className={`enlace ${conexion.estado}`}>
            <i />
            {conexion.estado === "conectado" ? "en vivo" : conexion.estado === "apagado" ? "sin red" : "reconectando"}
          </span>
          <button className="pt-salir" onClick={alSalir} title="Cambiar de modo">
            ✕
          </button>
        </div>
      </header>

      {/* ---------- campeones ---------- */}
      {terminado && p3 && (
        <section className="pt-podio">
          <h2>Torneo terminado</h2>
          <div className="pt-tres">
            <article className="lugar dos">
              <span className="med">2.º</span>
              <b>{nom(p3.subcampeon)}</b>
              <em>{club(p3.subcampeon)}</em>
            </article>
            <article className="lugar uno">
              <span className="med">Campeón</span>
              <b>{nom(p3.campeon)}</b>
              <em>{club(p3.campeon)}</em>
            </article>
            <article className="lugar tres">
              <span className="med">3.º</span>
              {p3.terceros.length ? (
                p3.terceros.map((x) => (
                  <b key={x}>
                    {nom(x)}
                    <em>{club(x)}</em>
                  </b>
                ))
              ) : (
                <b>—</b>
              )}
            </article>
          </div>
        </section>
      )}

      {/* ---------- lo que se juega ahora ---------- */}
      {!terminado && (
      <section className="pt-ahora">
        {mesas.map((m) => {
          const p = m.partido;
          const st = p ? reducir(p, setsDe(t, p)) : null;
          return (
            <article key={m.mesa} className={p ? `pt-mesa viva ${st?.fase}` : "pt-mesa"}>
              <div className="pt-num">Mesa {m.mesa}</div>
              {p && st ? (
                <>
                  <div className="pt-vs">
                    <div className={st.ganador === "a" ? "j gana" : "j"}>
                      <b>
                        {nom(p.aId)}
                        {st.ventaja.a > 0 && <Ventaja puntos={st.ventaja.a} />}
                      </b>
                      <span>{club(p.aId)}</span>
                    </div>
                    <div className="pt-marca">
                      <span className="sets">
                        {st.sets.a}–{st.sets.b}
                      </span>
                      <span className="pts">
                        {st.fase === "descanso" ? "descanso" : `${st.pa} – ${st.pb}`}
                      </span>
                    </div>
                    <div className={st.ganador === "b" ? "j gana" : "j"}>
                      <b>
                        {nom(p.bId)}
                        {st.ventaja.b > 0 && <Ventaja puntos={st.ventaja.b} />}
                      </b>
                      <span>{club(p.bId)}</span>
                    </div>
                  </div>
                  <div className="pt-arb">
                    {etiquetaEtapa(t, p)}
                    {m.arbitro ? ` · Árbitro: ${m.arbitro}` : ""}
                  </div>
                </>
              ) : (
                <div className="pt-libre">libre</div>
              )}
            </article>
          );
        })}
      </section>
      )}

      <div className="pt-cols">
        {/* ---------- la tabla, en todos contra todos ---------- */}
        {tabla && (
          <section className="pt-lista">
            <h2>{terminado ? "Tabla final" : "Tabla"}</h2>
            <div className="pt-caja">
              <table className="pt-tabla">
                <thead>
                  <tr>
                    <th className="mesa">#</th>
                    <th>Jugador</th>
                    <th className="der" title="Partidos jugados">Jugados</th>
                    <th className="der" title="Sets ganados y perdidos">Sets</th>
                    <th className="der" title="2 por partido ganado y 1 por perdido">Puntos</th>
                  </tr>
                </thead>
                <tbody>
                  {tabla.orden.map((id, i) => (
                    <tr key={id}>
                      <td className="mesa">{i + 1}</td>
                      <td>
                        <b>{nom(id)}</b>
                      </td>
                      <td className="der">{tabla.filas[id].pj}</td>
                      <td className="der">
                        {tabla.filas[id].sg}–{tabla.filas[id].sp}
                      </td>
                      <td className="der marcador">{tabla.filas[id].pts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ---------- la eliminatoria, ya terminado ---------- */}
        {terminado && !todos && (
          <section className="pt-lista">
            <h2>Eliminatoria</h2>
            <div className="pt-caja desliza">
              <Tabla filas={deLlave} nom={nom} t={t} etapaCorta={etapaCorta} />
            </div>
          </section>
        )}

        {/* ---------- la fila ---------- */}
        {!terminado && (
        <section className="pt-lista">
          <h2>Siguientes partidos</h2>
          <div className="pt-caja">
          {siguientes.length ? (
            <table className="pt-tabla">
              <thead>
                <tr>
                  <th>Mesa</th>
                  <th>Partido</th>
                  <th className="der">Aprox.</th>
                </tr>
              </thead>
              <tbody>
                {siguientes.map((x) => (
                  <tr key={x.partidoId} className={x.espera <= INMINENTE ? "pronto" : undefined}>
                    <td className="mesa">
                      {x.mesa}
                      {!x.mesaFirme && <i title="Mesa estimada">~</i>}
                    </td>
                    <td>
                      <b>
                        {nom(x.aId)}
                        {ventajaDe(x.partidoId)?.lado === "a" && <Ventaja puntos={ventajaDe(x.partidoId)!.puntos} />}
                      </b>{" "}
                      <span className="vs">vs</span>{" "}
                      <b>
                        {nom(x.bId)}
                        {ventajaDe(x.partidoId)?.lado === "b" && <Ventaja puntos={ventajaDe(x.partidoId)!.puntos} />}
                      </b>
                      <span className="pt-etapa">
                        {etiquetaEtapa(t, t.partidos.find((p) => p.id === x.partidoId)!)}
                      </span>
                    </td>
                    <td className="der tiempo">{comoTexto(x.espera)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="pt-vacio">No hay más partidos en la fila.</p>
          )}
          </div>
          <p className="pt-pie">
            Los tiempos son aproximados
            {marcha.medido
              ? `, calculados sobre ${marcha.medidos} partidos ya jugados hoy`
              : ", todavía sin partidos medidos"}
            . Preséntate en tu mesa antes de que te toque.
          </p>
        </section>
        )}

        {/* ---------- lo que ya pasó ---------- */}
        <section className="pt-lista">
          <h2>{terminado ? (todos ? "Todos los partidos" : "Fase de grupos") : "Resultados"}</h2>
          <div className={terminado ? "pt-caja desliza" : "pt-caja"}>
            <Tabla filas={terminado ? deGrupos : terminados} nom={nom} t={t} etapaCorta={etapaCorta} />
          </div>
          {t.validacionObligatoria && (
            <p className="pt-pie">Los resultados aparecen aquí en cuanto la mesa de control los valida.</p>
          )}
        </section>
      </div>

      {/* Un jugador que pasa de largo tiene que poder leer esto de lejos. */}
      {siguientes.some((x) => x.espera <= INMINENTE) && (
        <footer className="pt-llamado">
          <span>A la mesa:</span>
          {siguientes
            .filter((x) => x.espera <= INMINENTE)
            .map((x) => (
              <b key={x.partidoId}>
                {nom(x.aId)} y {nom(x.bId)} · mesa {x.mesa}
              </b>
            ))}
        </footer>
      )}
    </div>
  );
}
