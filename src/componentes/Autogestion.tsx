import { useMemo, useRef, useState } from "react";
import { nombreDe, reducir, revisarParciales, setsDe } from "../nucleo";
import type { Evento, Partido, Torneo } from "../nucleo";
import { compartirEnvio, envioDe, resultado } from "../almacen";
import { TarjetaPartido } from "./TarjetaPartido";

interface Props {
  t: Torneo;
  /** Con lo que firma este aparato cada evento. */
  quien: string;
  /** Lo que tienen en común todos los eventos de este aparato. */
  prefijo: string;
  anotador: string;
  alCambiarAnotador: (nombre: string) => void;
  alAbrir: (id: string) => void;
  anotarEn: (partidoId: string, ...evs: Evento[]) => void;
  /** Carga el torneo que mandó el juez. Devuelve qué pasó, para decirlo. */
  alCargar: (texto: string) => string;
}

type Parcial = { a: string; b: string };

/**
 * Mesa autogestionada: para los días en que no está el juez.
 *
 * En un torneo de varios días no siempre hay quien dirija. Los propios
 * jugadores llevan el marcador, o solo escriben cómo quedó cada set, y al
 * final del día le mandan al juez un archivo con lo anotado. El juez lo
 * recibe, lo revisa y el torneo se pone al día.
 *
 * Aquí no se toca la estructura: ni sorteo, ni mesas, ni jugadores. Solo
 * se anotan partidos, y lo anotado viaja como hechos que se suman a lo
 * que ya tiene el juez, sin reemplazar nada.
 */
export function Autogestion({ t, quien, prefijo, anotador, alCambiarAnotador, alAbrir, anotarEn, alCargar }: Props) {
  const [nota, setNota] = useState("");
  const [jornada, setJornada] = useState(0);
  const [escribiendo, setEscribiendo] = useState<string | null>(null);
  const [sets, setSets] = useState<Parcial[]>([]);
  const [error, setError] = useState("");
  const archivo = useRef<HTMLInputElement>(null);

  const nom = (id: string | null) => nombreDe(t.jugadores.find((j) => j.id === id));
  const jornadas = useMemo(
    () => [...new Set(t.partidos.map((p) => p.jornada ?? 0).filter(Boolean))].sort((a, b) => a - b),
    [t.partidos],
  );

  const conEstado = t.partidos
    .filter((p) => p.aId && p.bId)
    .map((p) => ({ p, st: reducir(p, setsDe(t, p)) }))
    .filter(({ p }) => !jornada || p.jornada === jornada);
  const porJugar = conEstado.filter(({ st }) => !st.terminado && st.fase !== "por-validar").sort((x, y) => x.p.orden - y.p.orden);
  const mios = conEstado.filter(({ p }) => p.eventos.some((e) => e.por.startsWith(prefijo)));
  const envio = envioDe(t, prefijo, anotador);

  function abrirEditor(p: Partido) {
    setEscribiendo(p.id);
    setError("");
    setSets(Array.from({ length: setsDe(t, p) }, () => ({ a: "", b: "" })));
  }

  function guardar(p: Partido) {
    const limpios = sets
      .filter((s) => s.a.trim() !== "" || s.b.trim() !== "")
      .map((s) => ({ a: Number(s.a), b: Number(s.b) }));
    const mal = revisarParciales(limpios, setsDe(t, p), p.meta ?? 11);
    if (mal) {
      setError(mal);
      return;
    }
    anotarEn(p.id, resultado(limpios, anotador ? `Anotado por ${anotador}` : "", quien));
    setEscribiendo(null);
    setNota(`Guardado: ${nom(p.aId)} ${limpios.map((s) => `${s.a}-${s.b}`).join(", ")} ${nom(p.bId)}.`);
  }

  const editor = (p: Partido) => {
    const maxSets = setsDe(t, p) * 2 - 1;
    return (
      <div className="corrector">
        <p className="sub">
          Escribe cómo quedó cada set{p.ventaja ? ", con los puntos de hándicap incluidos" : ""}. Se guarda como
          resultado terminado y espera a que el juez lo acepte.
        </p>
        <div className="parciales-edit">
          <div className="cabecera">
            <span />
            <span>{nom(p.aId)}</span>
            <span>{nom(p.bId)}</span>
          </div>
          {sets.map((s, i) => (
            <div className="renglon" key={i}>
              <span>Set {i + 1}</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={s.a}
                onChange={(e) => setSets(sets.map((x, k) => (k === i ? { ...x, a: e.target.value } : x)))}
              />
              <input
                type="number"
                min={0}
                inputMode="numeric"
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
        {error && <p className="nota mal">{error}</p>}
        <div className="fila">
          <button className="btn" onClick={() => guardar(p)}>
            Guardar el resultado
          </button>
          <button className="btn leve" onClick={() => setEscribiendo(null)}>
            Cancelar
          </button>
        </div>
      </div>
    );
  };

  const cargador = (
    <input
      ref={archivo}
      type="file"
      accept=".json,application/json"
      style={{ display: "none" }}
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        const fr = new FileReader();
        fr.onload = () => setNota(alCargar(String(fr.result)));
        fr.onerror = () => setNota("No se pudo leer el archivo.");
        fr.readAsText(f, "utf-8");
        e.target.value = "";
      }}
    />
  );

  return (
    <div>
      <div className="sec">
        <h2>Mesa autogestionada</h2>
        <p className="sub">
          Para los días en que no está el juez. Aquí se anotan los partidos —con el marcador punto a punto o
          escribiendo cómo quedó cada set— y al final se le mandan al juez en un archivo. Cuando lo recibe, el torneo
          se pone al día.
        </p>
        {cargador}
        {!t.partidos.length ? (
          <>
            <p className="nota">
              Este aparato todavía no tiene el torneo. Pídele al juez el archivo (en la mesa de control: Red → Descargar
              el archivo) y ábrelo aquí.
            </p>
            <div className="fila">
              <button className="btn" onClick={() => archivo.current?.click()}>
                Abrir el archivo del torneo
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="sub">
              Torneo: <b>{t.nombre || "sin nombre"}</b>
            </p>
            <div className="campos">
              <label className="f">
                <span>¿Quién anota?</span>
                <input
                  value={anotador}
                  onChange={(e) => alCambiarAnotador(e.target.value)}
                  placeholder="Tu nombre, para que el juez sepa de quién viene"
                />
              </label>
            </div>
            <div className="fila">
              <button className="btn leve" onClick={() => archivo.current?.click()}>
                Abrir un archivo más nuevo del torneo
              </button>
            </div>
          </>
        )}
      </div>

      {nota && <p className="nota">{nota}</p>}

      {t.partidos.length > 0 && (
        <>
          {jornadas.length > 0 && (
            <div className="sec compacta">
              <label className="f" style={{ maxWidth: "16rem" }}>
                <span>Jornada</span>
                <select value={jornada} onChange={(e) => setJornada(Number(e.target.value))}>
                  <option value={0}>Todas</option>
                  {jornadas.map((j) => (
                    <option key={j} value={j}>
                      Jornada {j}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="sec compacta">
            <h3 className="sub-titulo">Por jugar</h3>
          </div>
          {porJugar.map(({ p }, i) => (
            <div key={p.id}>
              <TarjetaPartido
                t={t}
                p={p}
                alAbrir={alAbrir}
                numero={i + 1}
                extra={
                  escribiendo === p.id ? null : (
                    <>
                      <button className="btn chico" onClick={() => alAbrir(p.id)}>
                        Llevar el marcador
                      </button>
                      <button className="btn chico leve" onClick={() => abrirEditor(p)}>
                        Escribir el resultado
                      </button>
                    </>
                  )
                }
              />
              {escribiendo === p.id && editor(p)}
            </div>
          ))}
          {!porJugar.length && <p className="vacio">No queda nada por jugar{jornada ? " en esta jornada" : ""}.</p>}

          <div className="sec">
            <h2>Mandar al juez</h2>
            <p className="sub">
              {envio.partidos.length
                ? `Hay ${envio.partidos.length} ${envio.partidos.length === 1 ? "partido anotado" : "partidos anotados"} en este aparato. Mándaselos al juez cuando terminen: los recibe en la mesa de control, en Red → Recibir resultados.`
                : "Todavía no has anotado nada aquí."}
            </p>
            <div className="fila">
              <button
                className="btn"
                disabled={!envio.partidos.length}
                onClick={async () => {
                  const r = await compartirEnvio(envio);
                  setNota(
                    r === "compartido"
                      ? "Listo. El juez solo tiene que abrir ese archivo en Red → Recibir resultados."
                      : "Se descargó el archivo de resultados. Mándaselo al juez por WhatsApp o correo: lo abre en Red → Recibir resultados.",
                  );
                }}
              >
                Mandar los resultados al juez
              </button>
            </div>
            <p className="sub" style={{ marginTop: ".7rem" }}>
              Puedes mandarlo las veces que quieras: lo que el juez ya tenía no se duplica.
            </p>
          </div>

          {mios.length > 0 && (
            <>
              <div className="sec compacta">
                <h3 className="sub-titulo">Anotados en este aparato</h3>
              </div>
              {mios.map(({ p, st }) => (
                <div key={p.id}>
                  <TarjetaPartido t={t} p={p} alAbrir={alAbrir} />
                  {st.historial.length > 0 && (
                    <p className="detalle-sets">Parciales: {st.historial.map((s) => `${s.a}-${s.b}`).join(", ")}</p>
                  )}
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
