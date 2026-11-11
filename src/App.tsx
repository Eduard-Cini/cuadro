import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { aplicarHandicap, aplicarPaquete, aplicarReglas, propagar, unir } from "./nucleo";
import type { Credencial, Evento, Lado, Torneo } from "./nucleo";
import {
  LLAVE_ANOTADOR,
  LLAVE_ARBITRO,
  LLAVE_MESA,
  LLAVE_RELEVO,
  LLAVE_ROL,
  anula,
  borrar,
  cargar,
  cierra,
  escribir,
  guardar,
  guardarCredencial,
  idDispositivo,
  inicia,
  leer,
  leerCredencial,
  leerEntrante,
  punto,
  reanuda,
  tarjeta,
  tiempo,
  torneoVacio,
} from "./almacen";
import type { Rol } from "./almacen";
import { darDeAlta, probar, useRelevo } from "./red";
import { Arbitro } from "./componentes/Arbitro";
import { Autogestion } from "./componentes/Autogestion";
import { Ic, Sprite } from "./componentes/Iconos";
import { Informe } from "./componentes/Informe";
import { Juez } from "./componentes/Juez";
import { Pantalla } from "./componentes/Pantalla";
import { Repartir } from "./componentes/Repartir";
import { Tablero } from "./componentes/Tablero";
import { usePestanaUnica } from "./pestana";

/**
 * La pantalla del gimnasio se abre con `#pantalla` en la dirección.
 *
 * Va en la dirección y no en el almacenamiento porque lo normal es que la
 * pantalla sea otra ventana del mismo navegador donde está la mesa de
 * control: si el papel se guardara, al recargar la mesa de control se
 * encontraría convertida en pantalla.
 */
const esPantallaPorEnlace = () => location.hash.replace(/^#[/]?/, "") === "pantalla";

const ROLES: Array<{ id: Rol; clase: string; icono: "mesa" | "raq" | "tv"; titulo: string; texto: string }> = [
  {
    id: "juez",
    clase: "j",
    icono: "mesa",
    titulo: "Mesa de control",
    texto: "Configuras el torneo, haces el sorteo, apruebas las mesas y validas los resultados.",
  },
  {
    id: "arbitro",
    clase: "t",
    icono: "raq",
    titulo: "Tablero",
    texto: "Te identificas, ves los partidos de tu mesa y llevas el marcador. Nada más.",
  },
  {
    id: "pantalla",
    clase: "p",
    icono: "tv",
    titulo: "Pantalla",
    texto: "Para el proyector o la televisión del gimnasio: resultados y próximos partidos.",
  },
  {
    id: "autogestion",
    clase: "t",
    icono: "raq",
    titulo: "Mesa autogestionada",
    texto: "Para los días sin juez: anotan los propios jugadores y después le mandan los resultados al juez.",
  },
];

export default function App() {
  const [t, setT] = useState<Torneo>(() => cargar() ?? torneoVacio());
  const [rol, setRol] = useState<Rol | null>(() =>
    esPantallaPorEnlace() ? "pantalla" : ((leer(LLAVE_ROL) as Rol | null) ?? null),
  );
  const [arbitroId, setArbitroId] = useState<string | null>(() => leer(LLAVE_ARBITRO));
  const [mesa, setMesa] = useState<number | null>(() => {
    const m = leer(LLAVE_MESA);
    return m ? Number(m) : null;
  });
  const [abierto, setAbierto] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [pidiendoPin, setPidiendoPin] = useState(false);
  /** Torneo del relevo que no se pudo unir con el de este dispositivo. */
  const [choque, setChoque] = useState<Torneo | null>(null);
  const [credencial, setCredencial] = useState<Credencial | null>(() => leerCredencial());
  const [repartiendo, setRepartiendo] = useState(() => location.pathname.replace(/\/+$/, "").endsWith("/entrar"));
  /** El acta ocupa la pantalla entera: al imprimir no debe salir nada más. */
  const [informando, setInformando] = useState(false);
  const [avisoAlta, setAvisoAlta] = useState("");
  /** Esta pantalla está en la computadora que corre el relevo. */
  const [altaLocal, setAltaLocal] = useState(false);
  /** El relevo ya tiene una mesa de control dada de alta. */
  const [hayJuez, setHayJuez] = useState(false);
  /** Otra pestaña más nueva tomó el trabajo: esta no guarda ni manda. */
  const enPausa = usePestanaUnica(rol !== null && rol !== "pantalla");
  /** Quién anota en una mesa autogestionada. */
  const [anotador, setAnotador] = useState(() => leer(LLAVE_ANOTADOR) ?? "");

  /** Dirección desde la que se sirve esto: la que va en el código QR. */
  const origen = useMemo(
    () => (location.origin + import.meta.env.BASE_URL).replace(/\/+$/, ""),
    [],
  );

  const dispositivo = useMemo(() => idDispositivo(), []);
  const relevoGuardado = useMemo(() => {
    try {
      return JSON.parse(leer(LLAVE_RELEVO) ?? "{}") as { url?: string };
    } catch {
      return {};
    }
  }, []);
  const [relevo, setRelevo] = useState({ url: relevoGuardado.url ?? "" });

  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    // La pantalla solo mira, y una pestaña en pausa ya no manda: si
    // guardaran, pisarían la copia de la pestaña que sí está trabajando.
    if (rol === "pantalla" || enPausa) return;
    guardar(t);
  }, [t, rol, enPausa]);

  /**
   * Toda modificación pasa por aquí.
   *
   * La copia es profunda a propósito. Con una copia superficial, `fn`
   * mutaría los partidos del estado anterior, y como React puede invocar
   * el actualizador más de una vez con el mismo `prev`, un punto se
   * contaba dos veces. El actualizador tiene que ser puro: clonar primero
   * y mutar solo el clon.
   */
  const actualizar = useCallback((fn: (d: Torneo) => void) => {
    setT((prev) => {
      const d = structuredClone(prev) as Torneo;
      fn(d);
      return d;
    });
  }, []);

  /**
   * Cambio de estructura: sube la revisión.
   *
   * Es la frontera que sostiene la sincronización. Lo que decide el juez
   * —configuración, sorteo, mesas, cuadro— lleva número de revisión y al
   * unir gana la más alta. Los eventos de un partido no pasan por aquí:
   * esos se suman siempre, vengan de donde vengan.
   */
  const cambiarEstructura = useCallback(
    (fn: (d: Torneo) => void) =>
      actualizar((d) => {
        fn(d);
        // Las reglas del torneo, los puntos por set y la ventaja del
        // hándicap dependen de la configuración y de quién juega cada
        // partido, y eso lo cambian el sorteo, el cuadro y los rankings: se
        // recalculan en cada cambio de estructura, solo en lo que aún no
        // empieza.
        aplicarReglas(d);
        d.revision++;
      }),
    [actualizar],
  );

  /** Añade eventos a un partido sin tocar la revisión. */
  const anotarEn = useCallback(
    (partidoId: string, ...evs: Evento[]) =>
      actualizar((d) => {
        const p = d.partidos.find((x) => x.id === partidoId);
        if (p) p.eventos.push(...evs);
      }),
    [actualizar],
  );

  /* ---------- red local ---------- */

  const recibir = useCallback(
    (estructura: Torneo | null, eventos: Array<{ id: string; eventos: Evento[] }>) => {
      setT((prev) => {
        let base = prev;
        if (estructura) {
          const { torneo, resumen } = unir(prev, estructura);
          // Dos torneos con contenido y distinta identidad no se mezclan
          // solos: el dispositivo se queda con el suyo y se lo cuenta a
          // quien lo esté usando, que es el único que sabe cuál vale.
          setChoque(resumen.compatible ? null : estructura);
          base = torneo;
        }
        if (eventos.length) {
          const d = structuredClone(base) as Torneo;
          aplicarPaquete(d, { torneoId: d.id, revision: d.revision, desde: "relevo", partidos: eventos });
          base = d;
        }
        return base;
      });
    },
    [],
  );

  const ponerCredencial = useCallback((c: Credencial | null) => {
    setCredencial(c);
    guardarCredencial(c);
  }, []);

  /* El contador no puede retroceder ni con una recarga: el relevo rechaza
     una petición con un número que ya vio, y esa es justamente la defensa
     contra que alguien repita una capturada. */
  const avanzarContador = useCallback((n: number) => {
    const c = leerCredencial();
    if (c && n > c.n) guardarCredencial({ ...c, n });
  }, []);

  const conexion = useRelevo({
    url: enPausa ? "" : relevo.url,
    rol: rol ?? "pantalla",
    credencial,
    alAvanzar: avanzarContador,
    torneo: tRef,
    alRecibir: recibir,
  });

  /** Cambiar de torneo es cosa de quien está delante, no del relevo. */
  const adoptarDelRelevo = useCallback(() => {
    if (!choque) return;
    setT(choque);
    setChoque(null);
  }, [choque]);

  const guardarRelevo = useCallback((url: string) => {
    setRelevo({ url });
    escribir(LLAVE_RELEVO, JSON.stringify({ url }));
  }, []);

  /*
   * ¿Estamos en la computadora que sirve la aplicación? Entonces la mesa
   * de control entra sin código: quien está delante de esa máquina es
   * quien arrancó el torneo.
   *
   * Se pregunta cada pocos segundos y no una sola vez al cargar: si el
   * relevo se reinicia con la página ya abierta, la respuesta cambia, y
   * antes el botón de entrar no volvía a aparecer hasta recargar.
   */
  useEffect(() => {
    if (credencial || enPausa) return;
    let vivo = true;
    let reloj: ReturnType<typeof setInterval> | undefined;
    const mirar = async () => {
      const r = await probar(location.origin);
      if (!vivo) return;
      setAltaLocal(!!r.altaLocalDisponible);
      setHayJuez(!!r.juezDadoDeAlta);
      // Si esta página la sirve un relevo, su dirección es esta misma: no
      // tiene sentido pedirle a nadie que la escriba. Solo la primera vez,
      // para respetar a quien eligió trabajar sin red.
      if (r.ok && leer(LLAVE_RELEVO) === null) {
        setRelevo({ url: location.origin });
        escribir(LLAVE_RELEVO, JSON.stringify({ url: location.origin }));
      }
      // Publicada en internet no hay relevo que buscar: no se insiste.
      if (r.ajeno && reloj) clearInterval(reloj);
    };
    reloj = setInterval(() => void mirar(), 4000);
    void mirar();
    return () => {
      vivo = false;
      clearInterval(reloj);
    };
  }, [credencial, enPausa]);

  /** Canjea un código de alta y deja el aparato listo para su papel. */
  const canjear = useCallback(async (codigo: string, desdeAqui = false) => {
    setAvisoAlta(desdeAqui ? "Abriendo la mesa de control…" : "Dando de alta esta tablet…");
    const r = await darDeAlta(location.origin, codigo, desdeAqui);
    if (r.ok && r.credencial) {
      const papel = r.credencial.papel;
      const suyo: Rol = papel === "juez" ? "juez" : papel === "pantalla" ? "pantalla" : "arbitro";
      setRelevo({ url: location.origin });
      escribir(LLAVE_RELEVO, JSON.stringify({ url: location.origin }));
      setCredencial(r.credencial);
      guardarCredencial(r.credencial);
      setRol(suyo);
      escribir(LLAVE_ROL, suyo);
      setRepartiendo(false);
      setAltaLocal(false);
      setAvisoAlta(`Listo, ${r.credencial.nombre}. Ya puedes anotar.`);
    } else {
      setAvisoAlta(r.detalle);
    }
    return r.ok;
  }, []);

  /*
   * La mesa de control, en la computadora del relevo, se conecta sola.
   *
   * Antes había que encontrar un botón que solo salía en la pantalla de
   * inicio, y un navegador que recordaba el papel de la vez anterior se la
   * saltaba: la mesa de control abría «sin red» y sin pista de por qué.
   * Solo cuando el relevo no tiene ninguna dada de alta; si ya hay una, se
   * pregunta antes de sustituirla.
   */
  const autoAlta = useRef(false);
  useEffect(() => {
    if (rol !== "juez" || credencial || enPausa || !altaLocal || hayJuez || autoAlta.current) return;
    autoAlta.current = true;
    void canjear("", true).then((ok) => {
      if (!ok) autoAlta.current = false;
    });
  }, [rol, credencial, enPausa, altaLocal, hayJuez, canjear]);

  /** Recuperar la mesa de control cuando el relevo ya tenía una. */
  const recuperarJuez = () => {
    if (
      !confirm(
        "El relevo ya tiene una mesa de control dada de alta. Si sigues, esta pasa a ser la mesa de control y la otra, si existe, deja de poder escribir. ¿Seguir?",
      )
    )
      return;
    void canjear("", true);
  };

  /**
   * Alta al vuelo: el árbitro escanea el QR del juez y entra identificado.
   *
   * Se mira al arrancar y también al cambiar la dirección, porque un
   * árbitro puede escanear con la aplicación ya abierta —la dejó puesta, o
   * el primer intento no cuajó— y entonces el navegador no recarga nada:
   * solo cambia la parte que va tras la almohadilla.
   *
   * El código se borra de la barra en cuanto se canjea, para que no quede
   * en el historial ni lo herede el siguiente que use la tablet.
   */
  useEffect(() => {
    const mirar = () => {
      const m = location.hash.match(/alta=([A-Za-z0-9]+)/);
      if (!m) return;
      const codigo = m[1].toUpperCase();
      history.replaceState(null, "", location.pathname + location.search);
      void canjear(codigo);
    };
    mirar();
    window.addEventListener("hashchange", mirar);
    return () => window.removeEventListener("hashchange", mirar);
  }, [canjear]);


  /**
   * El cuadro avanza solo cuando entra un resultado.
   *
   * La guarda de igualdad es lo que impide el ciclo: si propagar no mueve
   * nada, no se toca el estado y el efecto no vuelve a dispararse.
   */
  useEffect(() => {
    if (rol !== "juez" && rol !== "autogestion") return;
    const finales = t.partidos.filter((p) => p.etapa === "final");
    if (!finales.length) return;
    const copia = structuredClone(finales);
    propagar(copia, t.formatoFinales, t.validacionObligatoria);
    const movio = copia.some((p, i) => p.aId !== finales[i].aId || p.bId !== finales[i].bId);
    if (!movio) return;
    if (rol === "juez") {
      cambiarEstructura((d) => propagar(d.partidos.filter((p) => p.etapa === "final"), d.formatoFinales, d.validacionObligatoria));
    } else {
      // La mesa autogestionada también ve avanzar el cuadro, para saber
      // qué se juega después, pero sin subir la revisión: la estructura
      // sigue siendo del juez, y él llega a la misma al recibir los
      // resultados porque el avance sale solo de quién ganó.
      actualizar((d) => {
        propagar(d.partidos.filter((p) => p.etapa === "final"), d.formatoFinales, d.validacionObligatoria);
        aplicarHandicap(d);
      });
    }
  }, [t, rol, cambiarEstructura, actualizar]);

  /* ---------- tablero ---------- */

  const partido = t.partidos.find((p) => p.id === abierto) ?? null;

  /*
   * Quién queda como autor de cada evento.
   *
   * Con credencial es el identificador que el relevo verificó; sin ella,
   * el del propio aparato. Nunca el nombre escrito a mano: el relevo
   * rechaza los eventos cuyo autor no case con quien firma la petición, y
   * así el registro dice quién anotó de verdad, no quién dijo ser.
   */
  /*
   * La mesa autogestionada firma con el aparato y con quien anota. El
   * aparato va primero y no cambia, y por él se reconoce después lo que
   * hay que mandarle al juez; el nombre es para que el acta diga quién fue.
   */
  const prefijoAuto = `autogestion:${dispositivo}`;
  const anotadorLimpio = anotador.trim().replace(/[^\p{L}\p{N} .-]/gu, "").slice(0, 40);
  const quien =
    rol === "autogestion"
      ? `${prefijoAuto}:${anotadorLimpio || "sin nombre"}`
      : (credencial?.quien ?? (rol === "juez" ? "juez" : dispositivo));

  /** Lo que la mesa autogestionada abre: el torneo que le mandó el juez. */
  const cargarEnAutogestion = (texto: string): string => {
    try {
      const r = leerEntrante(texto);
      if (!("torneo" in r)) return "Ese archivo es un envío de resultados, no el torneo. El torneo lo descarga el juez en Red.";
      const entrante = r.torneo;
      const prev = tRef.current;
      if (prev.id === entrante.id) {
        const { torneo, resumen } = unir(prev, entrante);
        setT(torneo);
        return `Torneo puesto al día: ${resumen.eventosNuevos} eventos nuevos. Lo anotado aquí se conserva.`;
      }
      if (prev.partidos.some((p) => p.eventos.some((e) => e.por.startsWith(prefijoAuto)))) {
        return "Este aparato tiene anotado otro torneo. Mándale primero esos resultados al juez, o borra los datos de este navegador.";
      }
      setT(entrante);
      return `Abierto «${entrante.nombre || "sin nombre"}».`;
    } catch (e) {
      return e instanceof Error ? e.message : "No se pudo leer el archivo.";
    }
  };

  /* Darse de alta ya identifica: el código venía emitido para una persona. */
  const arbitroEfectivo = credencial?.papel === "arbitro" ? credencial.quien : arbitroId;

  const elegirRol = (r: Rol) => {
    if (r === "juez" && t.pinJuez) {
      setPidiendoPin(true);
      return;
    }
    if (r === "pantalla") {
      // No se guarda: va en la dirección, para que recargar la conserve
      // sin cambiarle el papel a las demás pestañas de este navegador.
      history.replaceState(null, "", location.pathname + location.search + "#pantalla");
      setRol(r);
      return;
    }
    setRol(r);
    escribir(LLAVE_ROL, r);
  };

  const salirDePantalla = () => {
    history.replaceState(null, "", location.pathname + location.search);
    if (leer(LLAVE_ROL) === "pantalla") borrar(LLAVE_ROL);
    setRol(null);
  };

  const elegirArbitro = (id: string | null, m: number | null) => {
    setArbitroId(id);
    setMesa(m);
    if (id) escribir(LLAVE_ARBITRO, id);
    else borrar(LLAVE_ARBITRO);
    if (m) escribir(LLAVE_MESA, String(m));
    else borrar(LLAVE_MESA);
  };

  if (enPausa) {
    return (
      <>
        <Sprite />
        <div id="splash" className="on">
          <div className="sp-top">
            <h1 className="marca">
              TT<em>orneo</em>
            </h1>
            <p>Esta pestaña quedó en pausa</p>
          </div>
          <div className="sp-local">
            <p>TTorneo se abrió en otra pestaña de este navegador, y solo una puede trabajar a la vez.</p>
            <button className="btn grande" onClick={() => location.reload()}>
              Seguir en esta pestaña
            </button>
            <span>Lo que hiciste aquí está guardado. Si sigues en esta, la otra queda en pausa.</span>
          </div>
        </div>
      </>
    );
  }

  if (informando) {
    return <Informe t={t} alSalir={() => setInformando(false)} />;
  }

  if (repartiendo) {
    return (
      <>
        <Sprite />
        {avisoAlta && <p className="nota flotante">{avisoAlta}</p>}
        <Repartir
          origen={origen}
          arbitros={t.arbitros}
          conexion={conexion}
          credencial={credencial}
          publico={credencial?.papel !== "juez"}
          alSalir={() => setRepartiendo(false)}
        />
      </>
    );
  }

  if (partido) {
    return (
      <>
        <Sprite />
        <Tablero
          t={t}
          p={partido}
          quien={quien}
          alPunto={(j: Lado) => anotarEn(partido.id, punto(j, quien))}
          alDeshacer={() => {
            const vivos = new Set(partido.eventos.filter((e) => e.t === "anula").map((e) => e.ref));
            const ultimo = [...partido.eventos]
              .reverse()
              .find(
                (e) =>
                  (e.t === "punto" || e.t === "reanuda" || e.t === "tarjeta" || e.t === "tiempo") &&
                  !vivos.has(e.id),
              );
            if (ultimo) anotarEn(partido.id, anula(ultimo.id, quien));
          }}
          alTiempo={(lado: Lado) => anotarEn(partido.id, tiempo(lado, quien))}
          alTarjeta={(lado, color, puntos, motivo) =>
            anotarEn(partido.id, tarjeta(lado, color, puntos, motivo, quien))
          }
          alReanudar={() => anotarEn(partido.id, reanuda(quien))}
          alIniciar={(saque, invertido) => anotarEn(partido.id, inicia(saque, invertido, quien))}
          alCerrar={() => {
            anotarEn(partido.id, cierra(quien));
            setAbierto(null);
          }}
          alSalir={() => setAbierto(null)}
        />
      </>
    );
  }

  if (pidiendoPin) {
    return (
      <>
        <Sprite />
        <div id="splash" className="on">
          <div className="sp-top">
            <h1 className="marca">
              TT<em>orneo</em>
            </h1>
            <p>La mesa de control está protegida.</p>
          </div>
          <form
            className="pinbox"
            onSubmit={(e) => {
              e.preventDefault();
              if (pin === t.pinJuez) {
                setRol("juez");
                escribir(LLAVE_ROL, "juez");
                setPidiendoPin(false);
                setPin("");
              } else {
                setPin("");
              }
            }}
          >
            <label className="f">
              <span>Clave del juez</span>
              <input
                type="password"
                inputMode="numeric"
                value={pin}
                autoFocus
                onChange={(e) => setPin(e.target.value)}
              />
            </label>
            <div className="fila">
              <button className="btn" type="submit">
                Entrar
              </button>
              <button className="btn leve" type="button" onClick={() => setPidiendoPin(false)}>
                Volver
              </button>
            </div>
          </form>
        </div>
      </>
    );
  }

  if (!rol) {
    return (
      <>
        <Sprite />
        <div id="splash" className="on">
          <div className="sp-top">
            <h1 className="marca">
              TT<em>orneo</em>
            </h1>
            <p>{avisoAlta || "¿Qué eres en este torneo?"}</p>
          </div>
          {altaLocal && !credencial && (
            <div className="sp-local">
              <p>Esta es la computadora que está sirviendo el torneo.</p>
              {hayJuez ? (
                <>
                  <button className="btn grande" onClick={recuperarJuez}>
                    Recuperar la mesa de control aquí
                  </button>
                  <span>El relevo ya tiene una mesa de control. Úsalo si la perdiste: la otra dejará de valer.</span>
                </>
              ) : (
                <>
                  <button className="btn grande" onClick={() => void canjear("", true)}>
                    Abrir la mesa de control aquí
                  </button>
                  <span>Sin escribir ningún código: ya estás en la máquina que lo arrancó.</span>
                </>
              )}
            </div>
          )}
          <div className="sp-roles">
            {ROLES.map((r) => (
              <button key={r.id} className={`rol ${r.clase}`} onClick={() => elegirRol(r.id)}>
                <i className="capa trama-clara" />
                <Ic n={r.icono} />
                <h3>{r.titulo}</h3>
                <p>{r.texto}</p>
              </button>
            ))}
          </div>
        </div>
      </>
    );
  }

  if (rol === "pantalla") {
    return (
      <>
        <Sprite />
        <Pantalla t={t} conexion={conexion} alSalir={salirDePantalla} />
      </>
    );
  }

  const arbitro = t.arbitros.find((a) => a.id === arbitroEfectivo) ?? null;

  return (
    <>
      <Sprite />
      <header className="banda">
        <div className="banda-int">
          <div>
            <h1 className="marca">
              TT<em>orneo</em>
            </h1>
            <p className="lema">
              {rol === "juez"
                ? "Juez principal"
                : rol === "autogestion"
                  ? `Mesa autogestionada${anotadorLimpio ? ` · ${anotadorLimpio}` : ""}`
                  : arbitro
                  ? `${arbitro.nombre} · mesa ${arbitro.mesa}`
                  : `Árbitro${mesa ? ` · mesa ${mesa}` : ""}`}
              {t.nombre ? ` · ${t.nombre}` : ""}
            </p>
          </div>
          <span className="sp" />
          <span className="version" title={`Compilado el ${__COMPILADO__}. Si dos aparatos muestran versiones distintas, uno tiene una copia vieja guardada por el navegador.`}>
            v{__VERSION__}
          </span>
          <span className={`enlace ${conexion.estado}`} title={conexion.error || conexion.estado}>
            <i />
            {conexion.estado === "conectado"
              ? "en red"
              : conexion.estado === "conectando"
                ? "conectando"
                : conexion.estado === "caido"
                  ? "sin relevo"
                  : conexion.estado === "sin-credencial"
                    ? "sin alta"
                    : "sin red"}
          </span>
          <button
            className="rolchip"
            onClick={() => {
              setRol(null);
              borrar(LLAVE_ROL);
            }}
          >
            <Ic n="raq" />
            <span>{rol === "juez" ? "Mesa de control" : rol === "autogestion" ? "Autogestionada" : "Tablero"}</span>
          </button>
        </div>
      </header>
      <div id="app">
        {avisoAlta && <p className="nota">{avisoAlta}</p>}

        {/* Por qué no está en red y qué hacer, dicho donde se ve. Antes solo
            había dos palabras en la esquina y la explicación estaba en otra
            pestaña. */}
        {rol === "juez" && !credencial && altaLocal && hayJuez && (
          <div className="nota mal">
            <div>
              <b>Esta pestaña no está conectada como mesa de control.</b>
              <div>
                El relevo ya tiene una mesa de control dada de alta, pero no es esta: pudo ser otro navegador, o se
                borraron los datos de este. Lo que hagas aquí no llega a las tablets ni a la pantalla.
              </div>
              <div className="fila">
                <button className="btn" onClick={recuperarJuez}>
                  Recuperar la mesa de control aquí
                </button>
              </div>
            </div>
          </div>
        )}
        {rol === "juez" && !credencial && !altaLocal && conexion.estado === "sin-credencial" && (
          <p className="nota mal">
            Este aparato ve el torneo pero no puede escribir en él: falta darlo de alta. Ve a «Red» y escribe el código
            de la mesa de control, que sale en la ventana del relevo.
          </p>
        )}
        {rol === "juez" && conexion.atraso !== null && (
          <div className="nota mal">
            <div>
              <b>El relevo tiene una versión más nueva de este torneo.</b>
              <div>
                La de aquí es la revisión {t.revision} y la del relevo, la {conexion.atraso}. Mientras no elijas, los
                cambios que hagas aquí no llegan a las tablets ni a la pantalla.
              </div>
              <div className="fila">
                <button
                  className="btn"
                  onClick={() => {
                    if (!confirm("Se reemplaza lo que ven las tablets y la pantalla por el torneo de este aparato. ¿Seguir?"))
                      return;
                    const hasta = conexion.atraso ?? t.revision;
                    cambiarEstructura((d) => void (d.revision = Math.max(d.revision, hasta)));
                  }}
                >
                  Vale el de aquí
                </button>
                <button
                  className="btn leve"
                  onClick={() => {
                    if (!confirm("Este aparato se queda con el torneo como lo tiene el relevo. Los puntos anotados se conservan. ¿Seguir?"))
                      return;
                    void conexion.traerDelRelevo();
                  }}
                >
                  Vale el del relevo
                </button>
              </div>
            </div>
          </div>
        )}
        {rol !== "autogestion" && credencial && conexion.estado === "conectado" && conexion.error && (
          <p className="nota mal">{conexion.error}</p>
        )}

        {rol === "juez" ? (
          <Juez
            t={t}
            actualizar={actualizar}
            cambiarEstructura={cambiarEstructura}
            anotarEn={anotarEn}
            alAbrir={setAbierto}
            quien="juez"
            conexion={conexion}
            relevo={relevo}
            alGuardarRelevo={guardarRelevo}
            choque={choque}
            alAdoptar={adoptarDelRelevo}
            credencial={credencial}
            alCredencial={ponerCredencial}
            alRepartir={() => setRepartiendo(true)}
            alInforme={() => setInformando(true)}
          />
        ) : rol === "autogestion" ? (
          <Autogestion
            t={t}
            quien={quien}
            prefijo={prefijoAuto}
            anotador={anotador}
            alCambiarAnotador={(n) => {
              setAnotador(n);
              escribir(LLAVE_ANOTADOR, n);
            }}
            alAbrir={setAbierto}
            anotarEn={anotarEn}
            alCargar={cargarEnAutogestion}
          />
        ) : (
          <Arbitro
            t={t}
            arbitroId={arbitroEfectivo}
            mesa={mesa}
            alIdentificarse={elegirArbitro}
            alAbrir={setAbierto}
            conexion={conexion}
            relevo={relevo}
            alGuardarRelevo={guardarRelevo}
            choque={choque}
            alAdoptar={adoptarDelRelevo}
            credencial={credencial}
            alCredencial={ponerCredencial}
          />
        )}
      </div>
    </>
  );
}
