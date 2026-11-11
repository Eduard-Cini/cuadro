import { useEffect, useMemo, useState } from "react";
import { leerPartido, mensajeResultado, ordenar, reducir, unirEventos } from "../nucleo";
import type { Evento, Formato, Lado, Partido, PartidoRemoto, Torneo } from "../nucleo";
import { anula, cierra, escribir, inicia, leer, punto, reanuda, tarjeta, tiempo, torneoVacio } from "../almacen";
import { copiar, enlaceWhatsApp } from "../copiar";
import { Sprite } from "./Iconos";
import { Tablero } from "./Tablero";

/*
 * Partido a distancia: lo que ve un jugador al abrir su enlace.
 *
 * Solo su partido, sin elegir papel ni abrir archivos. Lleva el marcador
 * con el mismo tablero de los árbitros y al terminar arma el mensaje para
 * mandárselo al organizador por WhatsApp.
 *
 * No toca el torneo que el navegador pudiera tener guardado: cada partido
 * se guarda en su propia llave. Así el organizador puede abrir un enlace
 * en su teléfono para probarlo sin estropear su mesa de control, y si el
 * jugador cierra la página, al volver a abrir el mismo enlace sigue donde
 * iba.
 */

const POR = "remoto";

const codigoDeLaDireccion = (): string => location.hash.match(/^#jugar=([0-9A-Za-z]+)/)?.[1] ?? "";

const llaveDe = (pr: PartidoRemoto) => `ttorneo.jugar.${pr.torneoId}.${pr.partidoId}.${pr.a.id}.${pr.b.id}`;

function leerEventos(llave: string): Evento[] {
  try {
    const d: unknown = JSON.parse(leer(llave) ?? "[]");
    return Array.isArray(d) ? (d as Evento[]) : [];
  } catch {
    return [];
  }
}

/** El torneo mínimo que necesita el tablero: dos jugadores y un partido. */
function miniTorneo(pr: PartidoRemoto, eventos: Evento[]): { t: Torneo; p: Partido } {
  const p: Partido = {
    id: pr.partidoId,
    etapa: "grupo",
    aId: pr.a.id,
    bId: pr.b.id,
    mesa: 0,
    orden: 0,
    meta: pr.meta,
    ventaja: pr.ventaja,
    eventos,
  };
  const t: Torneo = {
    ...torneoVacio(),
    id: pr.torneoId,
    nombre: pr.torneo,
    puntosSet: pr.meta,
    formatoGrupos: pr.setsPara as Formato,
    formatoFinales: pr.setsPara as Formato,
    descansoSet: pr.descanso,
    validacionObligatoria: true,
    jugadores: [
      { id: pr.a.id, nombre: pr.a.nombre, club: "", rank: 0 },
      { id: pr.b.id, nombre: pr.b.nombre, club: "", rank: 0 },
    ],
    partidos: [p],
  };
  return { t, p };
}

const anulados = (eventos: Evento[]) => new Set(eventos.flatMap((e) => (e.t === "anula" ? [e.ref] : [])));

export function Jugar() {
  const pr = useMemo(() => leerPartido(codigoDeLaDireccion()), []);
  if (!pr) {
    return (
      <div className="jugar">
        <div className="jg-top">
          <h1 className="marca">
            TT<em>orneo</em>
          </h1>
          <p>Partido a distancia</p>
        </div>
        <div className="jg-cuerpo">
          <p className="nota mal">
            Este enlace llegó incompleto o dañado. Pídele al organizador que te lo vuelva a mandar y ábrelo tocándolo
            directamente en WhatsApp.
          </p>
        </div>
      </div>
    );
  }
  return <JugarPartido pr={pr} />;
}

function JugarPartido({ pr }: { pr: PartidoRemoto }) {
  const llave = llaveDe(pr);
  const [eventos, setEventos] = useState<Evento[]>(() => leerEventos(llave));
  const [viendoDatos, setViendoDatos] = useState(false);
  const [nota, setNota] = useState("");
  /** Si copiar no se pudo, el mensaje se enseña para copiarlo a mano. */
  const [aMano, setAMano] = useState(false);

  useEffect(() => {
    escribir(llave, JSON.stringify(eventos));
  }, [llave, eventos]);

  /*
   * Si el mismo enlace quedó abierto en dos pestañas, lo que se anota en
   * una llega a la otra. Se unen los eventos en vez de reemplazarlos, para
   * que una pestaña vieja no borre los puntos de la nueva.
   */
  useEffect(() => {
    const alCambiar = (e: StorageEvent) => {
      if (e.key !== llave || !e.newValue) return;
      try {
        const otros: unknown = JSON.parse(e.newValue);
        if (Array.isArray(otros)) setEventos((prev) => unirEventos(prev, otros as Evento[]));
      } catch {
        /* algo ilegible en la otra pestaña: se ignora */
      }
    };
    window.addEventListener("storage", alCambiar);
    return () => window.removeEventListener("storage", alCambiar);
  }, [llave]);

  const { t, p } = useMemo(() => miniTorneo(pr, eventos), [pr, eventos]);
  const st = reducir(p, pr.setsPara, pr.meta);
  const muertos = anulados(eventos);
  const cierre = ordenar(eventos).find((e) => e.t === "cierra" && !muertos.has(e.id));

  // El evento se crea fuera del actualizador: React puede llamarlo dos
  // veces y cada llamada crearía un evento distinto.
  const agregar = (...evs: Evento[]) => setEventos((prev) => [...prev, ...evs]);

  const deshacer = () => {
    const ultimo = [...ordenar(eventos)]
      .reverse()
      .find((e) => (e.t === "punto" || e.t === "reanuda" || e.t === "tarjeta" || e.t === "tiempo") && !muertos.has(e.id));
    if (ultimo) agregar(anula(ultimo.id, POR));
  };

  /** Empezar de cero anulando todo, para que otra pestaña abierta no lo reviva. */
  const empezarDeCero = () => {
    if (!confirm("Se borra el marcador de este partido en este teléfono. ¿Empezar de cero?")) return;
    agregar(...eventos.filter((e) => e.t !== "anula" && !muertos.has(e.id)).map((e) => anula(e.id, POR)));
    setViendoDatos(false);
  };

  const reglas =
    `Al mejor de ${pr.setsPara * 2 - 1} sets` +
    (pr.meta !== 11 ? `, sets a ${pr.meta}` : "") +
    (pr.ventaja
      ? `. Hándicap: ${pr.ventaja.lado === "a" ? pr.a.nombre : pr.b.nombre} empieza cada set con ${pr.ventaja.puntos} ${pr.ventaja.puntos === 1 ? "punto" : "puntos"}`
      : "") +
    ".";

  const cabecera = (
    <div className="jg-top">
      <h1 className="marca">
        TT<em>orneo</em>
      </h1>
      <p>
        {pr.torneo || "Torneo"} · {pr.etapa}
      </p>
    </div>
  );

  if (viendoDatos) {
    return (
      <div className="jugar">
        <Sprite />
        {cabecera}
        <div className="jg-cuerpo">
          <div className="sec">
            <h2>
              {pr.a.nombre} vs {pr.b.nombre}
            </h2>
            <p className="sub">{reglas}</p>
            <p className="sub">
              El marcador se guarda en este teléfono. Si cierras la página, vuelve a abrir el mismo enlace y sigue donde
              iba. Al terminar, la aplicación arma el mensaje para mandárselo al organizador.
            </p>
            <div className="fila">
              <button className="btn grande" onClick={() => setViendoDatos(false)}>
                Volver al marcador
              </button>
              <button className="btn grave" onClick={empezarDeCero} disabled={!st.jugados && !eventos.length}>
                Empezar de cero
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (cierre && st.terminado) {
    // La hora del cierre fija el código: mandarlo dos veces da el mismo
    // mensaje, y el organizador lo ve como repetido.
    const mensaje = mensajeResultado(pr, st.historial, cierre.ts);
    const gana = st.ganador === "a" ? pr.a.nombre : pr.b.nombre;
    const pierde = st.ganador === "a" ? pr.b.nombre : pr.a.nombre;
    const fecha = new Date(cierre.ts).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
    return (
      <div className="jugar">
        <Sprite />
        {cabecera}
        <div className="jg-cuerpo">
          <div className="jg-fin">
            <span className="eti">Resultado final</span>
            <div className="jg-marcador">
              <span className={st.ganador === "a" ? "gana" : ""}>{pr.a.nombre}</span>
              <b className="num">
                {st.sets.a}–{st.sets.b}
              </b>
              <span className={st.ganador === "b" ? "gana" : ""}>{pr.b.nombre}</span>
            </div>
            <p className="jg-sets">
              {st.historial.map((s, i) => (
                <span key={i}>
                  {s.a}–{s.b}
                </span>
              ))}
            </p>
            <p className="jg-quien">
              {gana} le gana a {pierde} · {fecha}
            </p>
            <p className="jg-codigo">{mensaje.split("\n").pop()}</p>
          </div>

          <div className="fila">
            <a className="btn grande" href={enlaceWhatsApp(mensaje)} target="_blank" rel="noopener noreferrer">
              Mandar por WhatsApp
            </a>
            <button
              className="btn leve"
              onClick={async () => {
                const ok = await copiar(mensaje);
                setAMano(!ok);
                setNota(ok ? "Mensaje copiado. Pégalo en el chat del organizador." : "");
              }}
            >
              Copiar el mensaje
            </button>
          </div>
          {nota && <p className="nota bien">{nota}</p>}
          {aMano && (
            <label className="f" style={{ marginTop: "1rem" }}>
              <span>No se pudo copiar solo. Mantén presionado el texto y cópialo:</span>
              <textarea readOnly value={mensaje} rows={5} onFocus={(e) => e.currentTarget.select()} />
            </label>
          )}
          <p className="sub jg-ayuda">
            Al tocar «Mandar por WhatsApp» elige el chat del organizador y envía el mensaje tal como sale, sin
            cambiarle nada. Si WhatsApp no se abre, toma una captura de esta pantalla y mándasela.
          </p>
          <div className="fila">
            <button
              className="btn leve"
              onClick={() => {
                agregar(anula(cierre.id, POR));
                setNota("");
              }}
            >
              Me equivoqué, volver al marcador
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Sprite />
      <Tablero
        t={t}
        p={p}
        quien={POR}
        encabezado={{ torneo: pr.torneo, etapa: pr.etapa }}
        textoCerrar="Ver el resultado para mandarlo"
        alPunto={(j: Lado) => agregar(punto(j, POR))}
        alDeshacer={deshacer}
        alTiempo={(lado: Lado) => agregar(tiempo(lado, POR))}
        alTarjeta={(lado, color, puntos, motivo) => agregar(tarjeta(lado, color, puntos, motivo, POR))}
        alReanudar={() => agregar(reanuda(POR))}
        alIniciar={(saque, invertido) => agregar(inicia(saque, invertido, POR))}
        alCerrar={() => agregar(cierra(POR))}
        alSalir={() => setViendoDatos(true)}
      />
    </>
  );
}
