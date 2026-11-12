import { useEffect, useState } from "react";
import { etiquetaEtapa, nombreDe, reducir } from "../nucleo";
import type { Lado, Partido, Tarjeta, Torneo } from "../nucleo";
import { Ic } from "./Iconos";

/** Onomatopeyas de manga: aparecen al anotar. */
const SFX = ["パン", "スパッ", "カッ", "バシッ", "ズバッ", "ドン"];

interface Props {
  t: Torneo;
  p: Partido;
  quien: string;
  alPunto: (j: Lado) => void;
  alDeshacer: () => void;
  alReanudar: () => void;
  alIniciar: (saque: Lado, invertido: boolean) => void;
  alCerrar: () => void;
  alTiempo: (lado: Lado) => void;
  alTarjeta: (lado: Lado, color: Tarjeta, puntos: 0 | 1 | 2, motivo: string) => void;
  alSalir: () => void;
  /** Partido a distancia: arriba van el torneo y la fase en lugar de mesa y árbitro. */
  encabezado?: { torneo: string; etapa: string };
  /** Lo que dice el botón al terminar, si no es mandarlo a la mesa de control. */
  textoCerrar?: string;
}

/**
 * Las faltas que el árbitro señala con tarjeta, en el orden del
 * reglamento: primero se avisa, después se penaliza, y la roja no la
 * decide el árbitro de mesa por su cuenta.
 */
const FALTAS: Array<{ id: string; color: Tarjeta; puntos: 0 | 1 | 2; rot: string; que: string }> = [
  {
    id: "aviso",
    color: "amarilla",
    puntos: 0,
    rot: "Amarilla",
    que: "Advertencia. Primera falta de conducta: no cambia el marcador.",
  },
  {
    id: "uno",
    color: "amarilla",
    puntos: 1,
    rot: "Amarilla + 1 punto",
    que: "Segunda falta del mismo jugador: un punto para el contrario.",
  },
  {
    id: "dos",
    color: "amarilla",
    puntos: 2,
    rot: "Amarilla + 2 puntos",
    que: "Tercera falta: dos puntos para el contrario.",
  },
  {
    id: "roja",
    color: "roja",
    puntos: 0,
    rot: "Roja · descalifica",
    que: "La decide el juez árbitro, no la mesa. El partido se le da al contrario.",
  },
];

const reloj = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function Tablero({
  t,
  p,
  alPunto,
  alDeshacer,
  alReanudar,
  alIniciar,
  alCerrar,
  alTiempo,
  alTarjeta,
  alSalir,
  encabezado,
  textoCerrar,
}: Props) {
  const setsPara = p.etapa === "final" ? t.formatoFinales : t.formatoGrupos;
  const st = reducir(p, setsPara);

  const jug = (id: string | null) => t.jugadores.find((j) => j.id === id);
  const a = jug(p.aId);
  const b = jug(p.bId);
  const arbitro = t.arbitros.find((x) => x.id === p.arbitroId) ?? t.arbitros.find((x) => x.mesa === p.mesa);

  const [golpe, setGolpe] = useState<{ lado: Lado; n: number; sfx: string } | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  /** Qué está pidiendo el árbitro: tiempo muerto o tarjeta. */
  const [pidiendo, setPidiendo] = useState<"tiempo" | "tarjeta" | null>(null);
  /** A quién se le saca la tarjeta, una vez elegido el lado. */
  const [sancionando, setSancionando] = useState<Lado | null>(null);
  const [motivo, setMotivo] = useState("");
  /**
   * Sorteo de quién elige sacar o recibir (reglamento ITTF 2.13.1).
   *
   * El ganador se decide en cuanto se toca el botón; los nombres que se
   * alternan un segundo son solo para que se vea que se sorteó.
   */
  const [sorteo, setSorteo] = useState<{ gana: Lado; muestra: Lado; girando: boolean; eligeLado: boolean } | null>(null);

  useEffect(() => {
    if (!sorteo?.girando) return;
    const giro = setInterval(
      () => setSorteo((s) => (s && s.girando ? { ...s, muestra: s.muestra === "a" ? "b" : "a" } : s)),
      90,
    );
    const fin = setTimeout(() => setSorteo((s) => (s ? { ...s, girando: false, muestra: s.gana } : s)), 1300);
    return () => {
      clearInterval(giro);
      clearTimeout(fin);
    };
  }, [sorteo?.girando]);

  const sortear = () => {
    let gana: Lado;
    try {
      const x = new Uint8Array(1);
      crypto.getRandomValues(x);
      gana = x[0] & 1 ? "a" : "b";
    } catch {
      gana = Math.random() < 0.5 ? "a" : "b";
    }
    const quieto = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setSorteo({ gana, muestra: quieto ? gana : "a", girando: !quieto, eligeLado: false });
  };

  /** Lo que eligió quien ganó el sorteo: quién saca primero. */
  const decidir = (saque: Lado) => {
    setSorteo(null);
    alIniciar(saque, st.invertido);
  };

  const cerrarPanel = () => {
    setPidiendo(null);
    setSancionando(null);
    setMotivo("");
  };

  const descansando = st.fase === "descanso";
  const preparando = st.fase === "sin-iniciar";
  const terminado = st.terminado;

  const enTiempo = st.tiempoDesde !== null && !terminado;

  /* El cronómetro solo corre mientras hay algo que contar: el descanso
     entre sets o el tiempo muerto que alguien acaba de pedir. */
  useEffect(() => {
    if (!descansando && !enTiempo) return;
    // Al entrar se toma la hora de inmediato: sin esto, el primer cuarto de
    // segundo el reloj contaba desde que se abrió el tablero y enseñaba un
    // descanso que no era.
    setAhora(Date.now());
    const id = setInterval(() => setAhora(Date.now()), 250);
    return () => clearInterval(id);
  }, [descansando, enTiempo]);

  function anotar(j: Lado) {
    if (terminado || descansando) return;
    setGolpe({ lado: j, n: Date.now(), sfx: SFX[Math.floor(Math.random() * SFX.length)] });
    alPunto(j);
  }

  const ultimo = st.historial[st.historial.length - 1];
  const ganador = st.ganador === "a" ? a : b;

  const lado = (cual: Lado) => {
    const j = cual === "a" ? a : b;
    const pts = cual === "a" ? st.pa : st.pb;
    const sets = cual === "a" ? st.sets.a : st.sets.b;
    // El lado que saca ocupa más pantalla: la forma dice quién tiene el
    // servicio antes que cualquier etiqueta.
    const saca = !terminado && !descansando && st.saca === cual;
    return (
      <button
        className={saca ? `lado ${cual} saca` : `lado ${cual}`}
        onClick={() => anotar(cual)}
        disabled={terminado || descansando}
        aria-label={`Punto para ${nombreDe(j, "")}`}
      >
        <i className="capa trama-clara" />
        {golpe?.lado === cual && <i className="lineas" key={`l${golpe.n}`} />}
        <span className="jn">{nombreDe(j)}</span>
        <span className="jc">{j?.club ?? ""}</span>
        {/* Durante el descanso el set siguiente no ha empezado: poner 0
            ahí sería decir que ya se juega. Se muestra una raya. */}
        <span className="pt num" key={`p${golpe?.lado === cual ? golpe.n : 0}`}>
          {descansando ? "–" : pts}
        </span>
        {/* Los círculos son los sets: llenos los ganados, vacíos los que
            faltan para llevarse el partido. */}
        <span className="pips">
          <span className="eti">sets</span>
          {Array.from({ length: setsPara }, (_, i) => (
            <i key={i} className={i < sets ? "pip on" : "pip"} />
          ))}
        </span>
        <span className={saca ? "saque on" : "saque"}>
          <Ic n="raq" />
          <span>Saque</span>
        </span>
        {golpe?.lado === cual && (
          <span className="sfx" key={`s${golpe.n}`}>
            {golpe.sfx}
          </span>
        )}
      </button>
    );
  };

  const restante = st.descansoDesde !== null ? t.descansoSet * 60_000 - (ahora - st.descansoDesde) : 0;
  const restaTiempo = st.tiempoDesde !== null ? (t.duracionTiempo || 60) * 1000 - (ahora - st.tiempoDesde) : 0;
  const ladoDelTiempo = st.tiempoLado === "a" ? a : st.tiempoLado === "b" ? b : null;

  /** Los dos lados, para los paneles que preguntan «¿a quién?». */
  const lados: Array<{ cual: Lado; quien: typeof a }> = [
    { cual: "a", quien: a },
    { cual: "b", quien: b },
  ];

  return (
    <div className="tablero on">
      <div className="tb-top">
        {encabezado ? (
          <>
            <span className="eti">Torneo</span>
            <span className="val">{encabezado.torneo || "–"}</span>
          </>
        ) : (
          <>
            <span className="eti">Mesa</span>
            <span className="val">{p.mesa || "–"}</span>
            <span className="eti">Árbitro</span>
            <span className="val">{arbitro ? arbitro.nombre : "sin asignar"}</span>
          </>
        )}
        <span className="eti">Fase</span>
        <span className="val">
          {encabezado ? encabezado.etapa : etiquetaEtapa(t, p)} · al mejor de {setsPara * 2 - 1}
          {p.meta && p.meta !== 11 ? ` · sets a ${p.meta}` : ""}
        </span>
        {(st.ventaja.a > 0 || st.ventaja.b > 0) && (
          <>
            <span className="eti">Hándicap</span>
            <span className="val">
              {nombreDe(t.jugadores.find((j) => j.id === (st.ventaja.a ? p.aId : p.bId)))} empieza cada set con{" "}
              {st.ventaja.a || st.ventaja.b} {(st.ventaja.a || st.ventaja.b) === 1 ? "punto" : "puntos"}
            </span>
          </>
        )}
        <span className="sp" />
        <button className="tb-salir" onClick={alSalir}>
          Salir
        </button>
      </div>

      <div className="tb-campo" style={st.invertido ? { flexDirection: "row-reverse" } : undefined}>
        {lado("a")}
        {lado("b")}

        {/* Fin del partido: el árbitro no guarda nada por su cuenta, lo
            manda a la mesa de control, que es quien lo hace oficial. */}
        {terminado && (
          <div className="aviso on">
            <div className="caja">
              <h3>{st.descalificado ? "Partido terminado por descalificación" : "Fin del partido"}</h3>
              <p>
                <span className="gan">{nombreDe(ganador)}</span>
                gana {st.sets.a}–{st.sets.b}.
              </p>
              {st.descalificado && (
                <p className="marcasets">
                  {nombreDe(st.descalificado === "a" ? a : b)} fue descalificado
                  {st.tarjetas.find((x) => x.color === "roja")?.motivo
                    ? `: ${st.tarjetas.find((x) => x.color === "roja")!.motivo}`
                    : ""}
                  . Los sets que faltaban se le dan al contrario, que es como se anota en la hoja.
                </p>
              )}
              <p className="sets-fin">
                {st.historial.map((s, i) => (
                  <span key={i}>
                    {s.a}–{s.b}
                  </span>
                ))}
              </p>
              <div className="fila centrada">
                <button className="btn" onClick={alCerrar}>
                  {textoCerrar ?? (t.validacionObligatoria ? "Mandar a la mesa de control" : "Guardar y salir")}
                </button>
                <button className="btn leve" onClick={alDeshacer}>
                  Me equivoqué, deshacer
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tiempo muerto: el juego está parado y el marcador se queda
            donde está. Lo que cambia es que hay un minuto corriendo y
            alguien tiene que decir cuándo se vuelve. */}
        {enTiempo && !descansando && (
          <div className="aviso on tiempo">
            <div className="caja">
              <h3>Tiempo muerto</h3>
              <p>
                Lo pidió <b>{nombreDe(ladoDelTiempo)}</b>. Es el único del partido para ese lado.
              </p>
              <div className={restaTiempo <= 0 ? "crono fuera" : "crono"}>
                {restaTiempo > 0 ? reloj(restaTiempo) : "se acabó el minuto"}
              </div>
              <p className="marcasets">
                Va {st.sets.a}–{st.sets.b} · {st.pa}–{st.pb}
              </p>
              <div className="fila centrada">
                <button className="btn grande" onClick={alReanudar}>
                  Seguir jugando
                </button>
                <button className="btn leve" onClick={alDeshacer}>
                  Deshacer, no lo pidió
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Elegir quién pide el tiempo o a quién se amonesta. Preguntar el
            lado antes que la falta evita la equivocación cara: sancionar
            al que no era. */}
        {pidiendo && !terminado && (
          <div className="aviso on sancion">
            <div className="caja">
              {pidiendo === "tiempo" ? (
                <>
                  <h3>¿Quién pide tiempo?</h3>
                  <p>Un tiempo muerto por lado y por partido, de {t.duracionTiempo || 60} segundos.</p>
                  <div className="fila centrada">
                    {lados.map(({ cual, quien }) => (
                      <button
                        key={cual}
                        className="btn grande"
                        disabled={st.tiempoGastado[cual]}
                        title={st.tiempoGastado[cual] ? "Ya gastó el suyo" : undefined}
                        onClick={() => {
                          alTiempo(cual);
                          cerrarPanel();
                        }}
                      >
                        {nombreDe(quien, cual === "a" ? "A" : "B")}
                        {st.tiempoGastado[cual] && <em> · ya lo usó</em>}
                      </button>
                    ))}
                  </div>
                </>
              ) : !sancionando ? (
                <>
                  <h3>¿A quién se amonesta?</h3>
                  <p>Queda escrito en el acta con la hora y con tu nombre.</p>
                  <div className="fila centrada">
                    {lados.map(({ cual, quien }) => (
                      <button key={cual} className="btn grande" onClick={() => setSancionando(cual)}>
                        {nombreDe(quien, cual === "a" ? "A" : "B")}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <h3>Tarjeta a {nombreDe(sancionando === "a" ? a : b)}</h3>
                  <p>
                    {(() => {
                      const n = st.tarjetas.filter((x) => x.lado === sancionando).length;
                      return n === 0
                        ? "Sin tarjetas todavía en este partido."
                        : `Ya lleva ${n} en este partido: la siguiente sube de grado.`;
                    })()}
                  </p>
                  <input
                    className="motivo"
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Motivo (opcional): retrasar el juego, golpear la mesa…"
                  />
                  <div className="faltas">
                    {FALTAS.map((f) => (
                      <button
                        key={f.id}
                        className={`falta ${f.color}${f.puntos ? " pena" : ""}`}
                        onClick={() => {
                          if (
                            f.color === "roja" &&
                            !confirm(
                              `La roja descalifica: el partido se le da a ${nombreDe(
                                sancionando === "a" ? b : a,
                              )}. La decide el juez árbitro. ¿Seguir?`,
                            )
                          )
                            return;
                          alTarjeta(sancionando, f.color, f.puntos, motivo.trim());
                          cerrarPanel();
                        }}
                      >
                        <b>{f.rot}</b>
                        <span>{f.que}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="fila centrada">
                <button className="btn leve" onClick={cerrarPanel}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Sorteo antes del primer punto: quien gana elige sacar, recibir
            o lado; si elige lado, el otro decide el saque. */}
        {sorteo && preparando && (
          <div className="aviso on sorteo">
            <div className="caja">
              {sorteo.girando ? (
                <>
                  <h3>Sorteo</h3>
                  <p className={`sorteo-nombre ${sorteo.muestra}`}>{nombreDe(sorteo.muestra === "a" ? a : b)}</p>
                  <p>Decidiendo quién elige…</p>
                </>
              ) : !sorteo.eligeLado ? (
                <>
                  <h3>Gana el sorteo</h3>
                  <p className={`sorteo-nombre ${sorteo.gana}`}>{nombreDe(sorteo.gana === "a" ? a : b)}</p>
                  <p>No saca por ganar: elige si saca o recibe.</p>
                  <div className="fila centrada">
                    <button className="btn grande" onClick={() => decidir(sorteo.gana)}>
                      Elige sacar
                    </button>
                    <button className="btn grande" onClick={() => decidir(sorteo.gana === "a" ? "b" : "a")}>
                      Elige recibir
                    </button>
                  </div>
                  <div className="fila centrada">
                    <button className="btn leve" onClick={() => setSorteo({ ...sorteo, eligeLado: true })}>
                      Prefiere elegir lado
                    </button>
                    <button className="btn leve" onClick={() => setSorteo(null)}>
                      Cancelar
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h3>{nombreDe(sorteo.gana === "a" ? a : b)} elige lado</h3>
                  <p>
                    Entonces el saque lo decide <b>{nombreDe(sorteo.gana === "a" ? b : a)}</b>:
                  </p>
                  <div className="fila centrada">
                    <button className="btn grande" onClick={() => decidir(sorteo.gana === "a" ? "b" : "a")}>
                      Saca {nombreDe(sorteo.gana === "a" ? b : a)}
                    </button>
                    <button className="btn grande" onClick={() => decidir(sorteo.gana)}>
                      Recibe {nombreDe(sorteo.gana === "a" ? b : a)}
                    </button>
                  </div>
                  <div className="fila centrada">
                    <button className="btn leve" onClick={() => setSorteo({ ...sorteo, eligeLado: false })}>
                      Volver
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Descanso entre sets: el reglamento da un minuto y el marcador
            del set siguiente todavía no existe. */}
        {descansando && (
          <div className="aviso on descanso">
            <div className="caja">
              <h3>Descanso</h3>
              <p className="marcasets">
                Sets {st.sets.a}–{st.sets.b}
              </p>
              <p>
                El set {st.historial.length} quedó {ultimo?.a}–{ultimo?.b}. Cambio de lado.
              </p>
              <div className={restante <= 0 ? "crono fuera" : "crono"}>
                {restante > 0 ? reloj(restante) : "se acabó el minuto"}
              </div>
              <p className="quien-saca">
                Abre el set {st.historial.length + 1}:{" "}
                <b>{nombreDe(st.saca === "a" ? a : b)}</b>
              </p>
              <div className="fila centrada">
                <button className="btn grande" onClick={alReanudar}>
                  Reanudar
                </button>
                <button className="btn leve" onClick={alDeshacer}>
                  Deshacer el último punto
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* La tira son los puntos del set que se está jugando, no los del
          partido entero: al cerrar un set el marcador vuelve a cero y
          dejar ahí las marcas anteriores hace contar mal de un vistazo. */}
      <div className="tira" aria-hidden="true">
        {(() => {
          const N = 24;
          const ult = st.puntosDelSet.slice(-N);
          const huecos = Math.max(0, N - ult.length);
          return [
            ...Array.from({ length: huecos }, (_, i) => <i key={`v${i}`} className="vacia" />),
            ...ult.map((lado, i) => (
              <i key={`p${i}`} className={i === ult.length - 1 && !descansando ? `${lado} ultimo` : lado} />
            )),
          ];
        })()}
      </div>

      {preparando ? (
        <div className="tb-pie preparar">
          <span className="prep-eti">Saca primero</span>
          <div className="prep-op">
            <button
              className={st.saca === "a" ? "bpie on a" : "bpie"}
              onClick={() => alIniciar("a", st.invertido)}
            >
              {nombreDe(a, "A")}
            </button>
            <button
              className={st.saca === "b" ? "bpie on b" : "bpie"}
              onClick={() => alIniciar("b", st.invertido)}
            >
              {nombreDe(b, "B")}
            </button>
          </div>
          <span className="sp" />
          <button className="bpie" onClick={sortear} title="Sortea quién elige sacar o recibir">
            Sorteo
          </button>
          <button className="bpie" onClick={() => alIniciar(st.saca, !st.invertido)}>
            Cambiar lado
          </button>
        </div>
      ) : (
        <div className="tb-pie">
          <div className="sets">
            {st.historial.map((s, i) => (
              <span key={i}>
                Set {i + 1}{" "}
                <b>
                  {s.a}–{s.b}
                </b>
              </span>
            ))}
            {st.deuce && !terminado && <span className="vent">Ventaja</span>}
          </div>
          {/* Lo que ya se sancionó, a la vista: el árbitro tiene que saber
              en qué falta va cada uno antes de sacar la siguiente. */}
          {st.tarjetas.length > 0 && (
            <div className="tarjetitas">
              {st.tarjetas.map((x, i) => (
                <span
                  key={i}
                  className={`tj ${x.color}`}
                  title={`${nombreDe(x.lado === "a" ? a : b)}${x.motivo ? ` · ${x.motivo}` : ""}${
                    x.puntos ? ` · ${x.puntos} al contrario` : ""
                  }`}
                >
                  {x.lado === "a" ? "A" : "B"}
                  {x.puntos ? `+${x.puntos}` : ""}
                </span>
              ))}
            </div>
          )}
          <span className="sp" />
          <button
            className="bpie"
            onClick={() => setPidiendo("tiempo")}
            disabled={terminado || (st.tiempoGastado.a && st.tiempoGastado.b)}
            title="Tiempo muerto: uno por lado y por partido"
          >
            Tiempo
          </button>
          <button className="bpie" onClick={() => setPidiendo("tarjeta")} disabled={terminado}>
            Tarjeta
          </button>
          <button className="bpie rojo" onClick={alDeshacer} disabled={!st.jugados && !st.tarjetas.length}>
            Deshacer
          </button>
        </div>
      )}
    </div>
  );
}
