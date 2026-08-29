import { useEffect, useRef, useState } from "react";
import { reducir } from "../nucleo";
import type { Lado, Partido, Torneo } from "../nucleo";
import { Ic } from "./Iconos";

/** Onomatopeyas de manga: aparecen al anotar. */
const SFX = ["パン", "スパッ", "カッ", "バシッ", "ズバッ", "ドン"];

interface Props {
  t: Torneo;
  p: Partido;
  alPunto: (j: Lado) => void;
  alDeshacer: () => void;
  alSalir: () => void;
}

export function Tablero({ t, p, alPunto, alDeshacer, alSalir }: Props) {
  const setsPara = p.etapa === "final" ? t.formatoFinales : t.formatoGrupos;
  const st = reducir(p, setsPara);

  const jug = (id: string | null) => t.jugadores.find((j) => j.id === id);
  const a = jug(p.aId);
  const b = jug(p.bId);
  const arbitro = t.arbitros.find((x) => x.mesa === p.mesa);

  const [golpe, setGolpe] = useState<{ lado: Lado; n: number; sfx: string } | null>(null);
  const [volteado, setVolteado] = useState(false);
  const [setsAvisados, setSetsAvisados] = useState(st.historial.length);
  const [finCerrado, setFinCerrado] = useState(false);
  const puntos = useRef(p.eventos.length);

  // Al deshacer, los avisos vuelven a su sitio.
  useEffect(() => {
    if (p.eventos.length < puntos.current) {
      setSetsAvisados(st.historial.length);
      setFinCerrado(false);
    }
    puntos.current = p.eventos.length;
  }, [p.eventos.length, st.historial.length]);

  function anotar(j: Lado) {
    if (st.terminado) return;
    setGolpe({ lado: j, n: Date.now(), sfx: SFX[Math.floor(Math.random() * SFX.length)] });
    alPunto(j);
  }

  const mostrarFin = st.terminado && !finCerrado;
  const mostrarSet = !st.terminado && st.historial.length > setsAvisados;
  const ultimo = st.historial[st.historial.length - 1];
  const ganador = st.ganador === "a" ? a : b;

  const lado = (cual: Lado) => {
    const j = cual === "a" ? a : b;
    const pts = cual === "a" ? st.pa : st.pb;
    const sets = cual === "a" ? st.sets.a : st.sets.b;
    return (
      <button
        className={`lado ${cual}`}
        onClick={() => anotar(cual)}
        aria-label={`Punto para ${j?.nombre ?? ""}`}
      >
        <i className="lineas" key={`l${golpe?.lado === cual ? golpe.n : 0}`}
           style={{ animation: golpe?.lado === cual ? undefined : "none" }} />
        <span className="jn">{j?.nombre ?? "—"}</span>
        <span className="jc">{j?.club ?? ""}</span>
        <span className="pt num" key={`p${golpe?.lado === cual ? golpe.n : 0}`}>
          {pts}
        </span>
        <span className="pips">
          {Array.from({ length: setsPara }, (_, i) => (
            <i key={i} className={i < sets ? "pip on" : "pip"} />
          ))}
        </span>
        <span className={!st.terminado && st.saca === cual ? "saque on" : "saque"}>
          <Ic n="raq" />
          Saque
        </span>
        {golpe?.lado === cual && (
          <span className="sfx" key={`s${golpe.n}`}>
            {golpe.sfx}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="tablero on">
      <div className="tb-top">
        <span className="eti">Mesa</span>
        <span className="val">{p.mesa || "–"}</span>
        <span className="eti">Árbitro</span>
        <span className="val">{arbitro ? arbitro.nombre : "sin asignar"}</span>
        <span className="eti">Etapa</span>
        <span className="val">
          {p.etapa === "final" ? "eliminatoria" : "grupos"} · al mejor de {setsPara * 2 - 1}
        </span>
        <span className="sp" />
        <button className="tb-salir" onClick={alSalir}>
          Salir
        </button>
      </div>

      <div className="tb-campo" style={volteado ? { flexDirection: "row-reverse" } : undefined}>
        {lado("a")}
        {lado("b")}

        {(mostrarFin || mostrarSet) && (
          <div className="aviso on">
            <div className="caja">
              {mostrarFin ? (
                <>
                  <h3>Fin del partido</h3>
                  <p>
                    <span className="gan">{ganador?.nombre}</span>
                    gana {st.sets.a}–{st.sets.b}.
                  </p>
                  <button
                    className="btn"
                    onClick={() => {
                      setFinCerrado(true);
                      alSalir();
                    }}
                  >
                    Guardar y salir
                  </button>
                </>
              ) : (
                <>
                  <h3>Fin del set {st.historial.length}</h3>
                  <p>
                    Quedó {ultimo?.a}–{ultimo?.b}. Cambio de lado.
                  </p>
                  <button className="btn" onClick={() => setSetsAvisados(st.historial.length)}>
                    Continuar
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

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
          {st.deuce && !st.terminado && (
            <span>
              <b>VENTAJA</b>
            </span>
          )}
        </div>
        <span className="sp" />
        <button className="bpie" onClick={() => setVolteado((v) => !v)}>
          Cambiar lado
        </button>
        <button className="bpie rojo" onClick={alDeshacer} disabled={p.eventos.length === 0}>
          Deshacer
        </button>
      </div>
    </div>
  );
}
