import { useMemo, useState } from "react";
import {
  buscarResultados,
  enlaceDe,
  etiquetaEtapa,
  nombreDe,
  partidoRemoto,
  reducir,
  registroDesdeCaptura,
  revisarResultados,
  setsDe,
  textoDeEnlaces,
} from "../nucleo";
import type { Evento, Partido, Torneo } from "../nucleo";
import { copiar, enlaceWhatsApp } from "../copiar";
import { TarjetaPartido } from "./TarjetaPartido";

interface Props {
  t: Torneo;
  anotarEn: (partidoId: string, ...evs: Evento[]) => void;
  cambiarEstructura: (fn: (d: Torneo) => void) => void;
  quien: string;
}

type Parcial = { a: string; b: string };

/** Dirección de esta aplicación, terminada en «/»: de aquí salen los enlaces. */
const origenDeLaApp = () => new URL(import.meta.env.BASE_URL, location.href).href;

/**
 * ¿Los enlaces solo se abrirían en esta red?
 *
 * Pasa cuando la mesa de control se abrió desde el relevo del gimnasio
 * (http y una IP local). Un enlace así no le sirve a un jugador que está
 * en su casa, y es mejor decirlo antes de que lo mande a todo el grupo.
 */
function soloEnEstaRed(origen: string): boolean {
  const u = new URL(origen);
  return (
    u.protocol !== "https:" ||
    /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(u.hostname) ||
    u.hostname.endsWith(".local")
  );
}

/** Orden para listar: grupos o jornadas primero, luego la llave por ronda. */
function clave(t: Torneo, p: Partido): string {
  const n = (x: number | undefined, k = 3) => String(x ?? 0).padStart(k, "0");
  if (p.etapa === "final") return `2-${n(p.ronda)}-${n(p.slot)}`;
  const grupo = t.grupos.find((g) => g.id === p.grupoId)?.nombre ?? "";
  return `1-${n(p.jornada)}-${grupo}-${n(p.orden, 5)}`;
}

/**
 * Torneo a distancia, desde la mesa de control.
 *
 * Tres cosas: mandar a cada pareja el enlace de su partido, pegar los
 * mensajes con los resultados que regresan, y, si alguien manda solo una
 * captura, escribir el resultado a mano. En los tres casos el partido
 * queda registrado y aceptado, y la tabla y la llave avanzan solas.
 */
export function Distancia({ t, anotarEn, cambiarEstructura, quien }: Props) {
  const origen = useMemo(origenDeLaApp, []);
  const local = soloEnEstaRed(origen);

  const [pegado, setPegado] = useState("");
  const [filtro, setFiltro] = useState("");
  const [escribiendo, setEscribiendo] = useState<string | null>(null);
  const [sets, setSets] = useState<Parcial[]>([]);
  const [error, setError] = useState("");
  const [nota, setNota] = useState("");
  /** Texto que no se pudo copiar solo y se enseña para copiarlo a mano. */
  const [aMano, setAMano] = useState("");

  const nom = (id: string | null) => nombreDe(t.jugadores.find((j) => j.id === id));

  const porJugar = t.partidos
    .filter((p) => p.aId && p.bId && !reducir(p, setsDe(t, p)).terminado)
    .sort((x, y) => (clave(t, x) < clave(t, y) ? -1 : clave(t, x) > clave(t, y) ? 1 : 0));
  const etapas = [...new Set(porJugar.map((p) => etiquetaEtapa(t, p)))];
  const filtroVigente = etapas.includes(filtro) ? filtro : "";
  const lista = filtroVigente ? porJugar.filter((p) => etiquetaEtapa(t, p) === filtroVigente) : porJugar;

  const { resultados, dañados } = useMemo(() => buscarResultados(pegado), [pegado]);
  const revisiones = useMemo(() => revisarResultados(t, resultados, quien), [t, resultados, quien]);
  const nuevos = revisiones.flatMap((r) => (r.tipo === "nuevo" ? [r] : []));

  /** Lo registrado ya no ocupa mesa ni árbitro, igual que al aceptar. */
  function soltarMesas(ids: string[]) {
    const ocupan = t.partidos.some((p) => ids.includes(p.id) && (p.mesa || p.arbitroId));
    if (!ocupan) return;
    cambiarEstructura((d) => {
      for (const p of d.partidos) {
        if (!ids.includes(p.id)) continue;
        p.mesa = 0;
        p.arbitroId = undefined;
      }
    });
  }

  async function copiarOEnseñar(texto: string, listo: string) {
    const ok = await copiar(texto);
    setAMano(ok ? "" : texto);
    setNota(ok ? listo : "");
  }

  function registrarPegados() {
    for (const r of nuevos) anotarEn(r.partidoId, ...r.eventos);
    soltarMesas(nuevos.map((r) => r.partidoId));
    setNota(
      `${nuevos.length === 1 ? "Registrado 1 resultado" : `Registrados ${nuevos.length} resultados`}. La tabla y la llave ya están al día.`,
    );
    setPegado("");
  }

  function abrirEditor(p: Partido) {
    setEscribiendo(p.id);
    setError("");
    setNota("");
    setSets(Array.from({ length: setsDe(t, p) }, () => ({ a: "", b: "" })));
  }

  function guardarCaptura(p: Partido) {
    const limpios = sets
      .filter((s) => s.a.trim() !== "" || s.b.trim() !== "")
      .map((s) => ({ a: Number(s.a), b: Number(s.b) }));
    const r = registroDesdeCaptura(t, p, limpios, quien);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    anotarEn(p.id, ...r.eventos);
    soltarMesas([p.id]);
    setEscribiendo(null);
    setNota(`Registrado: ${nom(p.aId)} ${limpios.map((s) => `${s.a}-${s.b}`).join(", ")} ${nom(p.bId)}.`);
  }

  const editor = (p: Partido) => {
    const maxSets = setsDe(t, p) * 2 - 1;
    const meta = p.meta ?? 11;
    return (
      <div className="corrector">
        <p className="sub">
          Escribe cómo quedó cada set, tal como se ve en la captura{p.ventaja ? ", con los puntos de hándicap incluidos" : ""}
          {meta !== 11 ? ` (sets a ${meta})` : ""}. Se registra y se acepta de una vez.
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
                aria-label={`Set ${i + 1}, ${nom(p.aId)}`}
                value={s.a}
                onChange={(e) => setSets(sets.map((x, k) => (k === i ? { ...x, a: e.target.value } : x)))}
              />
              <input
                type="number"
                min={0}
                inputMode="numeric"
                aria-label={`Set ${i + 1}, ${nom(p.bId)}`}
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
          <button className="btn" onClick={() => guardarCaptura(p)}>
            Registrar el resultado
          </button>
          <button className="btn leve" onClick={() => setEscribiendo(null)}>
            Cancelar
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="sec">
        <h2>Torneo a distancia</h2>
        <p className="sub">
          Para cuando no puedes estar en cada partido. Mandas a cada pareja el enlace de su partido; lo abren en el
          teléfono, llevan el marcador y al terminar te mandan el resultado por WhatsApp. Tú pegas el mensaje aquí y
          queda registrado. Si alguien solo te manda una captura, escribe el resultado a mano en su partido.
        </p>
        {local && (
          <p className="nota mal">
            Estás en {origen}, una dirección que solo se abre en esta red. Los enlaces no le van a servir a quien esté
            en otro lado: abre la mesa de control desde la dirección publicada en internet y manda los enlaces desde
            ahí.
          </p>
        )}
        {!t.partidos.length && <p className="nota">Todavía no hay partidos. Haz primero el sorteo o el calendario.</p>}
      </div>

      {nota && <p className="nota bien">{nota}</p>}
      {aMano && (
        <label className="f" style={{ marginBottom: "1.5rem" }}>
          <span>No se pudo copiar solo. Mantén presionado el texto y cópialo:</span>
          <textarea readOnly value={aMano} rows={6} onFocus={(e) => e.currentTarget.select()} />
        </label>
      )}

      <div className="sec">
        <h2>Recibir resultados</h2>
        <p className="sub">
          Copia en WhatsApp el mensaje que te mandaron y pégalo aquí. Puedes pegar varios mensajes juntos.
        </p>
        <textarea
          value={pegado}
          onChange={(e) => setPegado(e.target.value)}
          placeholder="Pega aquí los mensajes de resultado"
          rows={4}
        />
        {pegado.trim() !== "" && (
          <div className="revisiones">
            {revisiones.map((r, i) => (
              <div key={i} className={`rev ${r.tipo}`}>
                <b>{r.tipo === "nuevo" ? "Nuevo" : r.tipo === "repetido" ? "Ya estaba" : "No entra"}</b>
                <span>{r.lectura}</span>
                {r.tipo !== "nuevo" && <em>{r.motivo}</em>}
              </div>
            ))}
            {dañados > 0 && (
              <div className="rev error">
                <b>Incompleto</b>
                <span>
                  {dañados === 1 ? "Un código llegó mocho o cambiado" : `${dañados} códigos llegaron mochos o cambiados`}.
                </span>
                <em>Pide que te reenvíen el mensaje sin editarlo, o escribe el resultado a mano desde la captura.</em>
              </div>
            )}
            {!revisiones.length && !dañados && (
              <p className="nota mal">
                En lo pegado no hay ningún código de resultado (empiezan con TT1-). Si te mandaron una captura,
                escribe el resultado a mano en su partido, abajo.
              </p>
            )}
          </div>
        )}
        <div className="fila">
          <button className="btn" disabled={!nuevos.length} onClick={registrarPegados}>
            {nuevos.length > 1 ? `Registrar ${nuevos.length} resultados` : "Registrar el resultado"}
          </button>
          {pegado && (
            <button className="btn leve" onClick={() => setPegado("")}>
              Borrar lo pegado
            </button>
          )}
        </div>
      </div>

      <div className="sec">
        <h2>Por jugar {porJugar.length > 0 && <b className="cuenta">{porJugar.length}</b>}</h2>
        <p className="sub">
          Copia los enlaces y pégalos en el grupo del torneo, o manda cada uno por separado. Cada enlace abre solo
          ese partido.
        </p>
        {etapas.length > 1 && (
          <label className="f" style={{ maxWidth: "18rem" }}>
            <span>Qué mandar</span>
            <select value={filtroVigente} onChange={(e) => setFiltro(e.target.value)}>
              <option value="">Todo lo pendiente</option>
              {etapas.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="fila">
          <button
            className="btn"
            disabled={!lista.length}
            onClick={() =>
              void copiarOEnseñar(
                textoDeEnlaces(t, lista, origen),
                `Copiados ${lista.length === 1 ? "el enlace" : `los ${lista.length} enlaces`}. Pégalos en el grupo del torneo.`,
              )
            }
          >
            Copiar {lista.length === 1 ? "el enlace" : "los enlaces"}
            {filtroVigente ? ` de ${filtroVigente}` : ""}
          </button>
        </div>
      </div>

      {lista.map((p) => {
        const pr = partidoRemoto(t, p);
        if (!pr) return null;
        const enlace = enlaceDe(origen, pr);
        const paraUno = `${t.nombre || "Torneo"} · ${pr.etapa}\n${pr.a.nombre} vs ${pr.b.nombre}\nAbre tu partido aquí y al terminar mándame el resultado:\n${enlace}`;
        return (
          <div key={p.id}>
            <TarjetaPartido
              t={t}
              p={p}
              extra={
                escribiendo === p.id ? null : (
                  <>
                    <button className="btn chico" onClick={() => void copiarOEnseñar(enlace, `Enlace de ${pr.a.nombre} vs ${pr.b.nombre} copiado.`)}>
                      Copiar enlace
                    </button>
                    <a className="btn chico leve" href={enlaceWhatsApp(paraUno)} target="_blank" rel="noopener noreferrer">
                      WhatsApp
                    </a>
                    <button className="btn chico leve" onClick={() => abrirEditor(p)}>
                      Escribir resultado
                    </button>
                  </>
                )
              }
            />
            {escribiendo === p.id && editor(p)}
          </div>
        );
      })}
      {t.partidos.length > 0 && !porJugar.length && <p className="vacio">No queda ningún partido por jugar.</p>}
    </>
  );
}
