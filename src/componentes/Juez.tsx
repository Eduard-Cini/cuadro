import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  aplicarPaquete,
  armarCuadro,
  bloquesSugeridos,
  clasificar,
  enOrdenDeSiembra,
  estadisticas,
  ganadorDe,
  nombreDe,
  nombreRonda,
  partidoListo,
  pendientesDeGrupo,
  podio,
  puntosDe,
  reducir,
  repartir,
  repartirBloques,
  setsDe,
  sortear,
  unir,
} from "../nucleo";
import type { Credencial, Evento, Formato, Modalidad, Reglamento, Sistema, Torneo, Vista, Voto } from "../nucleo";
import {
  abrirDelArchivo,
  archivarYEmpezar,
  borrarDelArchivo,
  delArchivo,
  exportar,
  guardarEnArchivo,
  leerEntrante,
  leerJugadores,
  listaTorneos,
  nuevoId,
  valida,
} from "../almacen";
import type { EnvioResultados } from "../almacen";
import type { Conexion } from "../red";
import { pedirInvitacion, probar, verAccesos } from "../red";
import { Accesos } from "./Accesos";
import { Guia } from "./Guia";
import { Conectar } from "./Conectar";
import { Distancia } from "./Distancia";
import { Mesas } from "./Mesas";
import { Resultados } from "./Resultados";
import { TarjetaPartido } from "./TarjetaPartido";
import { TablaBloques } from "./TablaBloques";
import { Votacion } from "./Votacion";

/**
 * Las categorías que puede tener una jornada.
 *
 * La elección va primero y sola en la pantalla porque decide cómo se lee
 * todo lo demás: en dobles y mixtos, cada inscripción son dos personas,
 * y la lista de jugadores, el sorteo y el cuadro hablan de parejas.
 */
const MODALIDADES: Array<{ id: Modalidad; rot: string; que: string }> = [
  {
    id: "individual",
    rot: "Individual",
    que: "Una persona por lado. Es lo normal en un torneo escolar.",
  },
  {
    id: "dobles",
    rot: "Dobles",
    que: "Dos por lado, con una sola inscripción y un solo lugar en el cuadro.",
  },
  {
    id: "mixtos",
    rot: "Mixtos",
    que: "Dobles con la pareja formada por un hombre y una mujer.",
  },
];

const SISTEMAS: Array<{ id: Sistema; rot: string; que: string }> = [
  {
    id: "grupos",
    rot: "Grupos y eliminatoria",
    que: "Fase de grupos, y los que avanzan juegan un cuadro hasta la final.",
  },
  {
    id: "todos",
    rot: "Todos contra todos",
    que: "Round robin: cada quien juega con todos una vez, repartido en jornadas. Gana el primero de la tabla.",
  },
];

const REGLAMENTOS: Array<{ id: Reglamento; rot: string; que: string }> = [
  {
    id: "formal",
    rot: "Formal (reglamento ITTF)",
    que: "Sets a 11, un minuto entre sets, tiempo muerto de un minuto y resultados validados por ti. Sin hándicap. No se puede cambiar.",
  },
  {
    id: "personalizado",
    rot: "Amateur o personalizado",
    que: "Tú decides a cuántos puntos se juega, los descansos, el hándicap y si los resultados pasan por ti.",
  },
];

const VISTAS: Array<[Vista, string]> = [
  ["torneo", "Torneo"],
  ["jugadores", "Jugadores"],
  ["arbitros", "Árbitros"],
  ["grupos", "Sorteo"],
  ["cuadro", "Llave"],
  ["mesas", "Mesas"],
  ["resultados", "Resultados"],
  ["distancia", "A distancia"],
  ["red", "Red"],
];

interface Props {
  t: Torneo;
  actualizar: (fn: (t: Torneo) => void) => void;
  cambiarEstructura: (fn: (t: Torneo) => void) => void;
  anotarEn: (partidoId: string, ...evs: Evento[]) => void;
  alAbrir: (id: string) => void;
  quien: string;
  conexion: Conexion;
  relevo: { url: string };
  alGuardarRelevo: (url: string) => void;
  choque: Torneo | null;
  alAdoptar: () => void;
  credencial: Credencial | null;
  alCredencial: (c: Credencial | null) => void;
  alRepartir: () => void;
  alInforme: () => void;
}

/** Partidos que ganaron eventos de una copia a otra. */
const tocadosPorUnion = (antes: Torneo, despues: Torneo): string[] =>
  despues.partidos
    .filter((p) => p.eventos.length > (antes.partidos.find((x) => x.id === p.id)?.eventos.length ?? 0))
    .map((p) => p.id);

export function Juez({
  t,
  actualizar,
  cambiarEstructura,
  anotarEn,
  alAbrir,
  quien,
  conexion,
  relevo,
  alGuardarRelevo,
  choque,
  alAdoptar,
  credencial,
  alCredencial,
  alRepartir,
  alInforme,
}: Props) {
  const [vista, setVista] = useState<Vista>("torneo");
  const [nuevo, setNuevo] = useState({ nombre: "", nombre2: "", club: "", rank: "" });
  const [arb, setArb] = useState({ nombre: "", mesa: "1" });
  const [bulk, setBulk] = useState(false);
  const [texto, setTexto] = useState("");
  const [nota, setNota] = useState("");
  const [semilla, setSemilla] = useState("");
  /** Códigos de alta recién pedidos, por árbitro. */
  const [codigos, setCodigos] = useState<Record<string, string>>({});
  /** Partidos que acaban de llegar de una mesa autogestionada. */
  const [recibidos, setRecibidos] = useState<string[]>([]);
  /** El relevo avisa que la dirección de la computadora cambió. */
  const [cambioDir, setCambioDir] = useState<{ antes: string; ahora: string } | null>(null);
  useEffect(() => {
    if (!relevo.url) return;
    let vivo = true;
    const mirar = async () => {
      const r = await probar(relevo.url);
      if (vivo && r.ok) setCambioDir(r.cambioDireccion ?? null);
    };
    void mirar();
    const reloj = setInterval(() => void mirar(), 15000);
    return () => {
      vivo = false;
      clearInterval(reloj);
    };
  }, [relevo.url]);
  /** Cuántos aparatos hay dados de alta. Lo necesita la guía. */
  const [dispositivos, setDispositivos] = useState(0);
  /** La configuración se abre para tocarla y se vuelve a cerrar. */
  const [editandoConfig, setEditandoConfig] = useState(false);
  /**
   * En un torneo recién empezado, la categoría se elige antes que nada y
   * el resto de la configuración aparece después. En uno que ya existe no
   * hay nada que desplegar: todo se ve de una vez.
   */
  const [categoriaElegida, setCategoriaElegida] = useState(
    () => t.configurado || t.jugadores.length > 0 || !!t.nombre.trim(),
  );
  /** Sube cada vez que se toca el archivo, para volver a leer la lista. */
  const [verArchivo, setVerArchivo] = useState(0);
  const [verVotacion, setVerVotacion] = useState(false);
  /**
   * La tabla de votaciones mientras se llena. Vive aquí y no en la
   * votación para no perderla al cambiar de pestaña; al usar el resultado
   * se guarda en el torneo. Nulo: la que quedó guardada.
   */
  const [borradorVotos, setBorradorVotos] = useState<Voto[] | null>(null);
  useEffect(() => setBorradorVotos(null), [t.id]);
  const archivo = useRef<HTMLInputElement>(null);
  const respaldo = useRef<HTMLInputElement>(null);

  const nom = (id: string | null) => nombreDe(t.jugadores.find((j) => j.id === id));
  const exigir = t.validacionObligatoria;
  /*
   * Con algún partido ya anotado, el sorteo y la lista de jugadores quedan
   * fijos. Rehacer el sorteo, quitar a un jugador o vaciar la lista borra
   * los partidos con sus marcadores, y eso a media jornada no tiene
   * arreglo. Si alguien no se presenta, sus partidos se registran como
   * perdidos con «Corregir».
   */
  const yaSeJuega = t.partidos.some((p) => p.eventos.length > 0);
  const llaveJugada = t.partidos.some((p) => p.etapa === "final" && p.eventos.length > 0);
  const POR_QUE_FIJO =
    "Ya hay partidos con puntos anotados: rehacerlo borraría sus marcadores. Para empezar de cero, usa «Torneo nuevo» en la pestaña Torneo; este queda guardado en el archivo.";
  const todos = t.sistema === "todos";
  const hc = { base: "ranking" as const, porLugar: 1, ...(t.handicap ?? { activo: false, escalon: 100, tope: 7 }) };
  const formal = t.reglamento === "formal";
  const puntos = puntosDe(t);
  const porLugar = hc.base === "lugar";
  const porBloque = hc.base === "bloque";
  /** Bloques de nivel que hay en la lista: el número del más bajo. */
  const kBloques = Math.max(0, ...t.jugadores.map((j) => j.bloque ?? 0));
  const [kNuevo, setKNuevo] = useState("");
  const enRed = conexion.estado === "conectado" && credencial?.papel === "juez";

  /* La guía necesita saber si ya hay tablets dadas de alta. */
  const contarDispositivos = useCallback(async () => {
    if (!enRed) return;
    const r = await verAccesos(conexion.pedir);
    if (r.ok) setDispositivos(r.dispositivos.length);
  }, [enRed, conexion.pedir]);

  useEffect(() => {
    void contarDispositivos();
    if (!enRed) return;
    const reloj = setInterval(() => void contarDispositivos(), 10000);
    return () => clearInterval(reloj);
  }, [contarDispositivos, enRed]);

  /* ---------- jugadores ---------- */

  function agregarJugador() {
    const nombre = nuevo.nombre.trim();
    if (!nombre) return;
    const nombre2 = enParejas ? nuevo.nombre2.trim() : "";
    if (enParejas && !nombre2) {
      setNota("Falta el segundo nombre de la pareja.");
      return;
    }
    cambiarEstructura((d) => {
      d.jugadores.push({
        id: nuevoId(),
        nombre,
        nombre2,
        club: nuevo.club.trim(),
        rank: Number(nuevo.rank) || 0,
      });
    });
    setNuevo({ nombre: "", nombre2: "", club: "", rank: "" });
    setNota("");
  }

  function importarJugadores(txt: string) {
    const filas = leerJugadores(txt);
    if (!filas.length) {
      setNota("No se encontró ningún jugador en el texto.");
      return;
    }
    cambiarEstructura((d) => {
      for (const f of filas) d.jugadores.push({ id: nuevoId(), ...f, nombre2: enParejas ? f.nombre2 : "" });
    });
    const sinPareja = enParejas ? filas.filter((f) => !f.nombre2).length : 0;
    setNota(
      `Se importaron ${filas.length} ${enParejas ? "parejas" : "jugadores"}.` +
        (sinPareja ? ` A ${sinPareja} les falta el segundo nombre: complétalos en la lista.` : ""),
    );
  }

  /**
   * Sube o baja a alguien en la siembra.
   *
   * El primer movimiento toma el orden que se ve —por ranking— y desde ahí
   * manda la lista: así quien tiene ranking para casi todos puede ajustar
   * solo a uno, y quien no tiene ninguno ordena desde cero.
   */
  function mover(id: string, paso: -1 | 1) {
    cambiarEstructura((d) => {
      const lista = d.siembraManual ? [...d.jugadores] : [...d.jugadores].sort((a, b) => b.rank - a.rank);
      const i = lista.findIndex((x) => x.id === id);
      const k = i + paso;
      if (i < 0 || k < 0 || k >= lista.length) return;
      [lista[i], lista[k]] = [lista[k], lista[i]];
      d.jugadores = lista;
      d.siembraManual = true;
    });
  }

  /** Deja la lista en el orden de la votación, pone a cada quien en su bloque y guarda los votos. */
  function ordenarPorVotacion(orden: string[], bloques: Record<string, number>, votos: Voto[]) {
    cambiarEstructura((d) => {
      const porId = new Map(d.jugadores.map((j) => [j.id, j]));
      const arriba = orden.flatMap((id) => porId.get(id) ?? []);
      d.jugadores = [...arriba, ...d.jugadores.filter((j) => !orden.includes(j.id))];
      for (const j of d.jugadores) j.bloque = bloques[j.id] || undefined;
      d.siembraManual = true;
      d.votacion = { votos };
    });
    setBorradorVotos(null);
  }

  /** Inscribe a quienes venían en los votos y no estaban en la lista. */
  function inscribirDesdeVotos(nombres: string[]) {
    const nuevos = nombres.map((nombre) => ({ id: nuevoId(), nombre, nombre2: "", club: "", rank: 0 }));
    if (nuevos.length) cambiarEstructura((d) => void d.jugadores.push(...nuevos));
    return nuevos;
  }

  /** Reparte la lista en k bloques: por los puntos de la votación si la hay, si no por el lugar. */
  function repartirEnBloques(k: number) {
    cambiarEstructura((d) => {
      const b = repartirBloques(enOrdenDeSiembra(d), d.votacion?.votos, k);
      for (const j of d.jugadores) j.bloque = b.get(j.id);
    });
  }

  function alSubirCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => importarJugadores(String(fr.result));
    fr.onerror = () => setNota("No se pudo leer el archivo.");
    fr.readAsText(f, "utf-8");
    e.target.value = "";
  }

  /* ---------- resultados de una mesa autogestionada ---------- */

  /**
   * Suma lo que anotó una mesa autogestionada.
   *
   * Son eventos, igual que los de un árbitro: se unen a los que ya hay y
   * un envío repetido no duplica nada. Lo que llegó terminado queda por
   * validar, como cualquier resultado; el juez puede aceptarlo de un
   * golpe o revisarlo uno por uno.
   */
  function recibirEnvio(e: EnvioResultados) {
    if (e.torneoId !== t.id) {
      setNota(
        `Ese archivo es de otro torneo («${e.torneoNombre || "sin nombre"}»). Abre ese torneo en la pestaña Torneo y vuelve a cargarlo.`,
      );
      return;
    }
    const conocidos = new Set(t.partidos.map((p) => p.id));
    const ajenos = e.partidos.filter((x) => !conocidos.has(x.id)).length;
    const paquete = { torneoId: e.torneoId, revision: t.revision, desde: e.desde, partidos: e.partidos };
    // La cuenta se hace sobre una copia para poder decirla; el cambio de
    // verdad pasa por el estado, sin tocar la revisión: son eventos.
    const prueba = structuredClone(t) as Torneo;
    const nuevos = aplicarPaquete(prueba, paquete);
    const tocados = tocadosPorUnion(t, prueba);
    actualizar((d) => void aplicarPaquete(d, paquete));
    setRecibidos(tocados);
    setNota(
      (nuevos
        ? `Llegó lo anotado por ${e.desde || "la mesa autogestionada"}: ${tocados.length} ${tocados.length === 1 ? "partido" : "partidos"}, ${nuevos} ${nuevos === 1 ? "evento" : "eventos"}.`
        : "Ese envío ya estaba recibido: no traía nada nuevo.") +
        (ajenos
          ? ` ${ajenos} ${ajenos === 1 ? "partido no existe" : "partidos no existen"} en este torneo (quizá se rehízo el sorteo) y se ${ajenos === 1 ? "dejó" : "dejaron"} fuera.`
          : ""),
    );
    setVista("red");
  }

  /** Aceptar de un golpe lo recibido que ya está terminado. */
  function aceptarRecibidos() {
    const listos = recibidos.filter((id) => {
      const p = t.partidos.find((x) => x.id === id);
      return p && reducir(p, setsDe(t, p)).fase === "por-validar";
    });
    for (const id of listos) anotarEn(id, valida(quien));
    cambiarEstructura((d) => {
      for (const p of d.partidos)
        if (listos.includes(p.id)) {
          if (p.mesa) p.jugadaEn = p.mesa;
          p.mesa = 0;
        }
    });
    setRecibidos([]);
    setNota(
      listos.length === 1
        ? "Aceptado el resultado. Ya cuenta para la tabla."
        : `Aceptados ${listos.length} resultados. Ya cuentan para la tabla.`,
    );
  }

  /* ---------- sorteo y cuadro ---------- */

  function hacerSorteo(conAzar: boolean) {
    if (t.jugadores.length < 2) {
      setNota("Hacen falta al menos dos jugadores.");
      return;
    }
    if (yaSeJuega) {
      setNota(POR_QUE_FIJO);
      return;
    }

    const s = conAzar ? (Number(semilla) || Math.floor(Math.random() * 1_000_000)) : undefined;
    cambiarEstructura((d) => {
      const rr = d.sistema === "todos";
      const r = sortear(d.jugadores, rr ? 1 : d.nGrupos, { semilla: s, jornadas: rr, siembraManual: !!d.siembraManual });
      d.grupos = r.grupos;
      d.partidos = r.partidos;
      d.relajaciones = r.relajaciones;
      d.actaSorteo = r.acta;
      d.semillaSorteo = s ?? 0;
    });
    if (s) setSemilla(String(s));
    setNota(
      todos
        ? conAzar
          ? `Calendario armado con la semilla ${s}. Queda en el acta.`
          : "Calendario armado en el orden de la lista."
        : conAzar
          ? `Sorteo hecho con la semilla ${s}. Queda en el acta.`
          : t.siembraManual
            ? "Grupos repartidos en el orden de la lista."
            : "Grupos repartidos por ranking.",
    );
    setVista("grupos");
  }

  function hacerCuadro() {
    if (!t.grupos.length) {
      setNota("Primero hay que sortear los grupos.");
      return;
    }
    if (llaveJugada) {
      setNota("La eliminatoria ya tiene partidos anotados: volver a armarla borraría sus marcadores.");
      return;
    }
    cambiarEstructura((d) => {
      const fin = armarCuadro(d.grupos, d.partidos, d.clasifican, d.formatoGrupos, d.validacionObligatoria);
      d.partidos = d.partidos.filter((p) => p.etapa !== "final").concat(fin);
    });
    setVista("cuadro");
  }

  /* ---------- alta de árbitros ---------- */

  /**
   * Pide al relevo un código para que un árbitro dé de alta su tablet.
   *
   * El código sale de aquí y se canta en voz alta o se escribe en un
   * papel: sirve una sola vez, caduca en un cuarto de hora, y ata ese
   * aparato a esta persona y a su mesa. A partir de entonces el relevo
   * sabe quién manda cada punto sin fiarse de lo que diga el mensaje.
   */
  async function invitar(id: string, nombre: string) {
    const r = await pedirInvitacion(conexion.pedir, id, nombre);
    if (r.ok && r.codigo) {
      setCodigos((c) => ({ ...c, [id]: r.codigo! }));
      setNota(`Dile a ${nombre} que escriba ${r.codigo} en su tablet. Vale un cuarto de hora y una sola vez.`);
      void contarDispositivos();
    } else {
      setNota(r.detalle);
    }
  }

  /* ---------- pintado ---------- */

  const campo = (
    etiqueta: string,
    valor: string | number,
    alCambiar: (v: string) => void,
    extra?: React.InputHTMLAttributes<HTMLInputElement>,
  ) => (
    <label className="f">
      <span>{etiqueta}</span>
      <input value={valor} onChange={(e) => alCambiar(e.target.value)} {...extra} />
    </label>
  );

  /** En dobles y mixtos, cada inscripción son dos personas. */
  const enParejas = t.modalidad !== "individual";
  const QUIEN = enParejas ? "parejas" : "jugadores";
  const QUIEN1 = enParejas ? "pareja" : "jugador";

  const torneos = useMemo(() => listaTorneos(t), [t, verArchivo]);

  /** Deja el activo guardado y trae otro del archivo. */
  const cambiarDeTorneo = (id: string) => {
    const entrante = abrirDelArchivo(t, id);
    if (!entrante) {
      setNota("Ese torneo ya no está en el archivo.");
      return;
    }
    cambiarEstructura((d) => void Object.assign(d, entrante));
    setVerArchivo((n) => n + 1);
    setEditandoConfig(false);
    setCategoriaElegida(true);
    setVista("torneo");
    setNota(
      `Abierto «${entrante.nombre || "sin nombre"}». Las tablets lo van a ver en cuanto se sincronicen; las que estén` +
        " sin red se lo quedan pendiente hasta que vuelvan.",
    );
  };

  const finales = t.partidos.filter((p) => p.etapa === "final");
  const rondas = finales.length ? Math.max(...finales.map((p) => p.ronda ?? 0)) + 1 : 0;
  const campeones = podio(t);
  const pendientes = pendientesDeGrupo(t.partidos, t.formatoGrupos, exigir);
  const esperando = t.partidos.filter((p) => reducir(p, setsDe(t, p)).fase === "por-validar").length;

  return (
    <div>
      {cambioDir && credencial?.papel === "juez" && (
        <div className="nota mal">
          <div>
            <b>La dirección de esta computadora cambió.</b>
            <div>
              Antes era {cambioDir.antes} y ahora es {cambioDir.ahora}. Los teléfonos que ya estaban dados de alta no la
              conocen: cada árbitro tiene que volver a escanear su código QR.
            </div>
            <div className="fila">
              <button className="btn" onClick={alRepartir}>
                Repartir los códigos otra vez
              </button>
              <button
                className="btn leve"
                onClick={async () => {
                  await conexion.pedir("/api/direccion-vista", "POST", {});
                  setCambioDir(null);
                }}
              >
                Ya los repartí
              </button>
            </div>
          </div>
        </div>
      )}

      <Guia
        t={t}
        enRed={enRed}
        dispositivos={dispositivos}
        alIr={(v) => {
          setVista(v);
          setNota("");
        }}
        alCambiarModo={(g) => cambiarEstructura((d) => void (d.modoGuiado = g))}
        alInforme={alInforme}
      />

      <nav className="tabs" role="tablist">
        {VISTAS.filter(([v]) => !(todos && v === "cuadro")).map(([v, etiqueta]) => (
          <button
            key={v}
            className="tab"
            role="tab"
            aria-selected={vista === v}
            onClick={() => {
              setVista(v);
              setNota("");
            }}
          >
            {todos && v === "grupos" ? "Calendario" : etiqueta}
            {v === "resultados" && esperando > 0 && <b className="cuenta">{esperando}</b>}
          </button>
        ))}
      </nav>

      {nota && <p className="nota">{nota}</p>}

      {/* ---------------- torneo ---------------- */}
      {vista === "torneo" && t.configurado && !editandoConfig && (
        <div className="sec">
          <div className="fila entre">
            <div>
              <h2>El torneo</h2>
              <p className="sub">Ya está configurado. Se guarda cerrado para no tocarlo por error a media jornada.</p>
            </div>
            <div className="fila">
              <button className="btn leve" onClick={() => setEditandoConfig(true)}>
                Cambiar
              </button>
              <button
                className="btn grave"
                title="Guarda este en el archivo y deja la pantalla en blanco para la siguiente categoría"
                onClick={() => {
                  if (
                    !confirm(
                      "Este torneo se guarda en el archivo de aquí abajo y la pantalla queda en blanco para empezar otro. ¿Seguir?",
                    )
                  )
                    return;
                  // La revisión sigue subiendo: si no, el relevo se
                  // quedaría con el torneo viejo por tener número mayor.
                  const limpio = archivarYEmpezar(t);
                  cambiarEstructura((d) => void Object.assign(d, limpio));
                  setVerArchivo((n) => n + 1);
                  setEditandoConfig(false);
                  setCategoriaElegida(false);
                  setVista("torneo");
                  setNota("Torneo nuevo. El anterior quedó guardado en el archivo. Empieza por la categoría.");
                }}
              >
                Torneo nuevo
              </button>
            </div>
          </div>
          <ul className="resumen">
            <li>
              <span>Torneo</span>
              <b>{t.nombre || "sin nombre"}{t.sede ? ` · ${t.sede}` : ""}</b>
            </li>
            <li>
              <span>Categoría</span>
              <b>{MODALIDADES.find((m) => m.id === t.modalidad)?.rot ?? "Individual"}</b>
            </li>
            <li>
              <span>Mesas</span>
              <b>{t.mesas}</b>
            </li>
            <li>
              <span>Sistema</span>
              <b>{todos ? "todos contra todos, sin eliminatoria" : "grupos y eliminatoria"}</b>
            </li>
            <li>
              <span>Formato</span>
              <b>
                {todos
                  ? `al mejor de ${t.formatoGrupos * 2 - 1}`
                  : `grupos al mejor de ${t.formatoGrupos * 2 - 1} · eliminatoria al mejor de ${t.formatoFinales * 2 - 1}${t.formatoSemis ? `, semis y final al mejor de ${t.formatoSemis * 2 - 1}` : ""}`}
              </b>
            </li>
            {!todos && (
              <li>
                <span>Grupos</span>
                <b>
                  {t.nGrupos}, avanzan {t.clasifican} de cada uno
                </b>
              </li>
            )}
            <li>
              <span>Reglas</span>
              <b>{formal ? "formal, reglamento ITTF" : `amateur, sets a ${puntos} puntos`}</b>
            </li>
            <li>
              <span>Hándicap</span>
              <b>
                {!hc.activo || formal
                  ? "no"
                  : porBloque
                    ? `por bloques de nivel (${kBloques || "sin"} bloques), hasta ${hc.tope} por set`
                    : porLugar
                      ? `${hc.porLugar} por cada lugar de diferencia en la lista, hasta ${hc.tope} por set`
                      : `un punto por cada ${hc.escalon} de ranking, hasta ${hc.tope} por set`}
              </b>
            </li>
            <li>
              <span>Descansos</span>
              <b>
                {t.descansoSet} min entre sets · {t.descansoJugador} min entre partidos
              </b>
            </li>
            <li>
              <span>Resultados</span>
              <b>{t.validacionObligatoria ? "pasan por mí antes de contar" : "cuentan al cerrarlos el árbitro"}</b>
            </li>
          </ul>
        </div>
      )}

      {vista === "torneo" && (!t.configurado || editandoConfig) && (
        <>
          <div className="sec">
            <h2>¿Qué categoría es?</h2>
            <p className="sub">
              Cada categoría es un torneo aparte, con su sorteo, su cuadro y su campeón. Si la jornada tiene varias,
              haces una y luego abres la siguiente desde el archivo de aquí abajo; las mesas y los árbitros son los
              mismos.
            </p>
            <div className="modos">
              {MODALIDADES.map((m) => (
                <button
                  key={m.id}
                  className={t.modalidad === m.id && categoriaElegida ? "modo on" : "modo"}
                  onClick={() => {
                    cambiarEstructura((d) => void (d.modalidad = m.id));
                    setCategoriaElegida(true);
                  }}
                >
                  <b>{m.rot}</b>
                  <span>{m.que}</span>
                </button>
              ))}
            </div>
            {t.modalidad !== "individual" && categoriaElegida && (
              <p className="sub" style={{ margin: ".9rem 0 0" }}>
                A partir de aquí, donde diga «jugador» hay que leer «pareja»: se inscribe una vez, con los dos
                nombres, y ocupa un solo lugar en el sorteo y en el cuadro.
                {t.modalidad === "mixtos" && " En mixtos, cada pareja es un hombre y una mujer."}
              </p>
            )}
            {!categoriaElegida && (
              <p className="sub" style={{ margin: ".9rem 0 0" }}>
                Elige una y se abre el resto de la configuración.
              </p>
            )}
          </div>
        </>
      )}

      {vista === "torneo" && (!t.configurado || editandoConfig) && categoriaElegida && (
        <>
          <div className="sec">
            <h2>¿Cómo se juega?</h2>
            <p className="sub">
              Decide si hay eliminatoria. Cambiarlo con el torneo sorteado obliga a sortear de nuevo.
            </p>
            <div className="modos">
              {SISTEMAS.map((s) => (
                <button
                  key={s.id}
                  className={(t.sistema ?? "grupos") === s.id ? "modo on" : "modo"}
                  onClick={() =>
                    cambiarEstructura((d) => {
                      d.sistema = s.id;
                      if (s.id === "todos") d.nGrupos = 1;
                    })
                  }
                >
                  <b>{s.rot}</b>
                  <span>{s.que}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="sec">
            <h2>¿Con qué reglas?</h2>
            <p className="sub">
              En un torneo formal el reglamento no se toca. En uno amateur, las reglas son las que acuerden ustedes.
            </p>
            <div className="modos">
              {REGLAMENTOS.map((r) => (
                <button
                  key={r.id}
                  className={(t.reglamento ?? "personalizado") === r.id ? "modo on" : "modo"}
                  onClick={() => cambiarEstructura((d) => void (d.reglamento = r.id))}
                >
                  <b>{r.rot}</b>
                  <span>{r.que}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="sec">
            <h2>El torneo</h2>
            <p className="sub">
              {todos
                ? "Todos los partidos se juegan con el mismo formato."
                : "El formato puede ser distinto en grupos y en la eliminatoria, que es lo normal."}
            </p>
            <div className="campos">
              {campo("Nombre", t.nombre, (v) => cambiarEstructura((d) => void (d.nombre = v)))}
              {campo("Sede", t.sede, (v) => cambiarEstructura((d) => void (d.sede = v)), {
                placeholder: "Gimnasio, escuela…",
              })}
              {campo("Mesas", t.mesas, (v) => cambiarEstructura((d) => void (d.mesas = Math.max(1, Number(v) || 1))), {
                type: "number",
                min: 1,
                max: 24,
              })}
              <label className="f">
                <span>{todos ? "Formato de los partidos" : "Formato en grupos"}</span>
                <select
                  value={t.formatoGrupos}
                  onChange={(e) => cambiarEstructura((d) => void (d.formatoGrupos = Number(e.target.value) as Formato))}
                >
                  <option value={2}>Al mejor de 3</option>
                  <option value={3}>Al mejor de 5</option>
                  <option value={4}>Al mejor de 7</option>
                </select>
              </label>
              {!todos && (
                <>
                  <label className="f">
                    <span>Formato en eliminatoria</span>
                    <select
                      value={t.formatoFinales}
                      onChange={(e) =>
                        cambiarEstructura((d) => void (d.formatoFinales = Number(e.target.value) as Formato))
                      }
                    >
                      <option value={2}>Al mejor de 3</option>
                      <option value={3}>Al mejor de 5</option>
                      <option value={4}>Al mejor de 7</option>
                    </select>
                  </label>
                  <label className="f">
                    <span>Semis y final</span>
                    <select
                      value={t.formatoSemis ?? 0}
                      onChange={(e) =>
                        cambiarEstructura((d) => {
                          const v = Number(e.target.value);
                          if (v) d.formatoSemis = v as Formato;
                          else delete d.formatoSemis;
                        })
                      }
                    >
                      <option value={0}>Igual que la eliminatoria</option>
                      <option value={2}>Al mejor de 3</option>
                      <option value={3}>Al mejor de 5</option>
                      <option value={4}>Al mejor de 7</option>
                    </select>
                  </label>
                  {campo(
                    "Grupos",
                    t.nGrupos,
                    (v) => cambiarEstructura((d) => void (d.nGrupos = Math.max(1, Number(v) || 1))),
                    { type: "number", min: 1, max: 16 },
                  )}
                  {campo(
                    "Avanzan por grupo",
                    t.clasifican,
                    (v) => cambiarEstructura((d) => void (d.clasifican = Math.max(1, Number(v) || 1))),
                    { type: "number", min: 1, max: 8 },
                  )}
                </>
              )}
              {!formal &&
                campo(
                  "Puntos por set",
                  t.puntosSet ?? 11,
                  (v) => cambiarEstructura((d) => void (d.puntosSet = Math.max(5, Math.min(99, Number(v) || 11)))),
                  { type: "number", min: 5, max: 99 },
                )}
            </div>
            <p className="sub" style={{ margin: ".9rem 0 0" }}>
              Los sets se juegan a {puntos} puntos con dos de diferencia.
              {!formal && puntos !== 11 && " Los partidos que ya empezaron se quedan con lo que tenían."}
            </p>
          </div>

          {!formal && (
          <div className="sec">
            <h2>Hándicap</h2>
            <label className="check">
              <input
                type="checkbox"
                checked={hc.activo}
                onChange={(e) => cambiarEstructura((d) => void (d.handicap = { ...hc, activo: e.target.checked }))}
              />
              <span>
                <b>Jugar con hándicap</b>
                <em>
                  El de menor nivel empieza cada set con puntos de ventaja, según la diferencia. Un partido ya
                  empezado conserva la que tenía aunque cambies algo aquí.
                </em>
              </span>
            </label>
            {hc.activo && (
              <div className="campos">
                <label className="f">
                  <span>La diferencia sale de</span>
                  <select
                    value={hc.base}
                    onChange={(e) => {
                      const v = e.target.value;
                      const base = v === "lugar" || v === "bloque" ? v : "ranking";
                      cambiarEstructura((d) => void (d.handicap = { ...hc, base }));
                    }}
                  >
                    <option value="ranking">El ranking de cada jugador</option>
                    <option value="lugar">Su lugar en la lista, del 1 al n (sin ranking)</option>
                    <option value="bloque">Bloques de nivel, por ejemplo de una votación</option>
                  </select>
                </label>
                {porBloque
                  ? campo("Número de bloques", kNuevo || String(kBloques || bloquesSugeridos(t.jugadores.length)), setKNuevo, {
                      type: "number",
                      min: 1,
                      max: Math.max(1, t.jugadores.length),
                    })
                  : porLugar
                  ? campo(
                      "Puntos de ventaja por cada lugar",
                      hc.porLugar,
                      (v) =>
                        cambiarEstructura(
                          (d) => void (d.handicap = { ...hc, porLugar: Math.max(0.5, Math.min(9, Number(v) || 1)) }),
                        ),
                      { type: "number", min: 0.5, max: 9, step: 0.5 },
                    )
                  : campo(
                      "Un punto por cada (puntos de ranking)",
                      hc.escalon,
                      (v) =>
                        cambiarEstructura((d) => void (d.handicap = { ...hc, escalon: Math.max(1, Number(v) || 1) })),
                      { type: "number", min: 1 },
                    )}
                {campo(
                  "Ventaja máxima por set",
                  hc.tope,
                  (v) =>
                    cambiarEstructura(
                      (d) => void (d.handicap = { ...hc, tope: Math.max(0, Math.min(9, Number(v) || 0)) }),
                    ),
                  { type: "number", min: 0, max: 9 },
                )}
              </div>
            )}
            {hc.activo && porBloque && (
              <>
                <div className="fila">
                  <button
                    className="btn leve"
                    disabled={t.jugadores.length < 2}
                    onClick={() => {
                      repartirEnBloques(Number(kNuevo) || kBloques || bloquesSugeridos(t.jugadores.length));
                      setKNuevo("");
                    }}
                  >
                    {t.votacion?.votos.length ? "Repartir con los puntos de la votación" : "Repartir por el orden de la lista"}
                  </button>
                </div>
                <p className="sub" style={{ margin: ".9rem 0 0" }}>
                  Los del mismo bloque no se dan ventaja. Entre bloques, el de abajo empieza cada set con los puntos de la
                  tabla. Los bloques salen de la votación (pestaña Jugadores) o de repartir la lista aquí, y en la lista
                  puedes cambiar a alguien de bloque. A quien no tiene bloque no se le da ventaja.
                </p>
                {kBloques >= 2 ? (
                  <TablaBloques
                    k={kBloques}
                    tabla={hc.tablaBloques}
                    meta={puntos}
                    tope={hc.tope}
                    integrantes={Array.from({ length: kBloques }, (_, b) =>
                      enOrdenDeSiembra(t)
                        .filter((j) => j.bloque === b + 1)
                        .map((j) => nombreDe(j)),
                    )}
                    alCambiar={(tabla) => cambiarEstructura((d) => void (d.handicap = { ...hc, tablaBloques: tabla }))}
                  />
                ) : (
                  <p className="nota">Todavía no hay dos bloques: haz la votación o reparte la lista.</p>
                )}
              </>
            )}
            {hc.activo && hc.base === "ranking" && (
              <p className="sub" style={{ margin: ".9rem 0 0" }}>
                Ejemplo: con un punto por cada {hc.escalon}, si juegan uno de 1500 y otro de {1500 - hc.escalon * 3} de
                ranking, el de {1500 - hc.escalon * 3} empieza cada set con {Math.min(hc.tope, 3)}{" "}
                {Math.min(hc.tope, 3) === 1 ? "punto" : "puntos"}. A quien no tiene ranking no se le da ventaja.
              </p>
            )}
            {hc.activo && porLugar && (
              <p className="sub" style={{ margin: ".9rem 0 0" }}>
                Ordena la lista de jugadores de mejor a peor con las flechas: el 1 es el mejor. Ejemplo: entre el 1 y el
                4 hay tres lugares, así que el 4 empieza cada set con {Math.min(hc.tope, Math.floor(3 * hc.porLugar))}{" "}
                {Math.min(hc.tope, Math.floor(3 * hc.porLugar)) === 1 ? "punto" : "puntos"}.
              </p>
            )}
          </div>
          )}

          <div className="sec">
            <h2>Tiempos y permisos</h2>
            <p className="sub">
              Los descansos alimentan el reloj de la pantalla y la propuesta de mesas. Ponlos como se juega aquí, no
              como dice el papel.
            </p>
            <div className="campos">
              {campo(
                "Descanso entre sets (min)",
                t.descansoSet,
                (v) => cambiarEstructura((d) => void (d.descansoSet = Math.max(0, Number(v) || 0))),
                { type: "number", min: 0, max: 10, step: 1, disabled: formal },
              )}
              {campo(
                "Descanso entre partidos (min)",
                t.descansoJugador,
                (v) => cambiarEstructura((d) => void (d.descansoJugador = Math.max(0, Number(v) || 0))),
                { type: "number", min: 0, max: 120 },
              )}
              {campo(
                "Tiempo muerto (seg)",
                t.duracionTiempo,
                (v) => cambiarEstructura((d) => void (d.duracionTiempo = Math.max(10, Number(v) || 60))),
                { type: "number", min: 10, max: 300, step: 5, disabled: formal },
              )}
              {campo(
                "Duración supuesta de un partido (min)",
                t.duracionSupuesta,
                (v) => cambiarEstructura((d) => void (d.duracionSupuesta = Math.max(1, Number(v) || 1))),
                { type: "number", min: 1, max: 180 },
              )}
              {campo("Clave del juez", t.pinJuez, (v) => cambiarEstructura((d) => void (d.pinJuez = v.trim())), {
                placeholder: "vacío = sin clave",
                inputMode: "numeric",
              })}
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={t.validacionObligatoria}
                disabled={formal}
                onChange={(e) => cambiarEstructura((d) => void (d.validacionObligatoria = e.target.checked))}
              />
              <span>
                <b>Los resultados pasan por mí antes de contar</b>
                <em>
                  Con esto activado, lo que cierra un árbitro espera en «Resultados» hasta que lo aceptas. Apágalo solo
                  en torneos informales.
                </em>
              </span>
            </label>
            {formal && (
              <p className="sub" style={{ margin: ".7rem 0 0" }}>
                Torneo formal: el descanso entre sets, el tiempo muerto y la validación los fija el reglamento.
              </p>
            )}
          </div>

          <div className="sec">
            <div className="fila">
              <button
                className="btn"
                onClick={() => {
                  cambiarEstructura((d) => void (d.configurado = true));
                  setEditandoConfig(false);
                  setNota("Configuración guardada. Ahora toca cargar a los jugadores.");
                  setVista("jugadores");
                }}
              >
                Guardar la configuración
              </button>
              {t.configurado && (
                <button className="btn leve" onClick={() => setEditandoConfig(false)}>
                  Cancelar
                </button>
              )}
            </div>
            <p className="sub" style={{ marginTop: ".7rem" }}>
              Se puede cambiar después, pero hacerlo con el torneo empezado obliga a rehacer cuentas.
            </p>
          </div>
        </>
      )}

      {/* ---------------- archivo de torneos ---------------- */}
      {vista === "torneo" && (
        <div className="sec">
          <h2>Torneos de esta computadora</h2>
          <p className="sub">
            Las categorías de la jornada, guardadas aquí con todos sus puntos. Solo una está abierta a la vez: es la
            que ven las tablets y la pantalla. Al cambiar, la anterior se guarda entera y vuelve igual cuando la
            abres otra vez.
          </p>
          <ul className="estante">
            {torneos.map((x) => (
              <li key={x.id} className={x.activo ? "tsel abierto" : "tsel"}>
                <div className="tinfo">
                  <b>{x.nombre || "Sin nombre"}</b>
                  <span className="tmeta">
                    <i className="etapa">{MODALIDADES.find((m) => m.id === x.modalidad)?.rot ?? "Individual"}</i>
                    {x.sede ? ` · ${x.sede}` : ""} · {x.jugadores}{" "}
                    {x.modalidad === "individual" ? "jugadores" : "parejas"} · {x.jugados} de {x.partidos} partidos
                  </span>
                </div>
                {x.activo ? (
                  <span className="tabierto">abierto</span>
                ) : (
                  <div className="fila">
                    <button className="btn leve" onClick={() => cambiarDeTorneo(x.id)}>
                      Abrir
                    </button>
                    <button
                      className="btn leve"
                      title="Descargarlo sin abrirlo"
                      onClick={() => {
                        const g = delArchivo(x.id);
                        if (g) exportar(g);
                      }}
                    >
                      Descargar
                    </button>
                    <button
                      className="x"
                      title="Quitar del archivo"
                      onClick={() => {
                        if (!confirm(`Se borra «${x.nombre || "sin nombre"}» con todos sus partidos. ¿Seguir?`)) return;
                        borrarDelArchivo(x.id);
                        setVerArchivo((n) => n + 1);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {torneos.length === 1 && (
            <p className="sub" style={{ marginTop: ".8rem" }}>
              Solo hay uno. Cuando termines esta categoría, «Torneo nuevo» la guarda aquí y deja la pantalla lista para
              la siguiente.
            </p>
          )}
        </div>
      )}

      {/* ---------------- jugadores ---------------- */}
      {vista === "jugadores" && (
        <div className="sec">
          <h2>Jugadores</h2>
          <p className="sub">
            El orden de la lista es la siembra: por ranking, o el que tú fijes con las flechas aunque nadie tenga
            ranking.
            {hc.activo && !formal && (porBloque
              ? " El hándicap sale del bloque de cada quien: los del mismo bloque no se dan ventaja."
              : porLugar
              ? " El hándicap sale de este orden: el 1 es el mejor."
              : " El hándicap usa el ranking: a quien no tenga no se le da ventaja.")}
          </p>
          <div className="campos">
            {campo("Nombre", nuevo.nombre, (v) => setNuevo({ ...nuevo, nombre: v }), {
              placeholder: "Apellido Nombre",
              onKeyDown: (e) => e.key === "Enter" && agregarJugador(),
            })}
            {campo("Club", nuevo.club, (v) => setNuevo({ ...nuevo, club: v }), { placeholder: "Club o escuela" })}
            {campo("Ranking", nuevo.rank, (v) => setNuevo({ ...nuevo, rank: v }), {
              type: "number",
              min: 0,
              placeholder: "opcional",
            })}
          </div>
          <div className="fila">
            <button className="btn" onClick={agregarJugador}>
              Agregar
            </button>
            <button className="btn leve" onClick={() => setBulk((b) => !b)}>
              Pegar lista o cargar CSV
            </button>
            <button className="btn leve" onClick={() => setVerVotacion((v) => !v)}>
              {verVotacion ? "Cerrar la votación" : "Ranking por votación"}
            </button>
            <button
              className="btn grave"
              disabled={yaSeJuega}
              onClick={() => {
                if (!t.jugadores.length || !confirm("Se borran los jugadores, los grupos y los partidos. ¿Seguir?")) return;
                cambiarEstructura((d) => {
                  d.jugadores = [];
                  d.grupos = [];
                  d.partidos = [];
                  d.relajaciones = [];
                  d.actaSorteo = [];
                  delete d.votacion;
                });
                setBorradorVotos(null);
              }}
            >
              Vaciar
            </button>
          </div>

          {bulk && (
            <div style={{ marginTop: ".95rem" }}>
              <label className="f">
                <span>Archivo CSV — columnas {enParejas ? "pareja" : "nombre"}, club, ranking</span>
                <input ref={archivo} type="file" accept=".csv,.txt,text/csv,text/plain" onChange={alSubirCsv} />
              </label>
              <label className="f" style={{ marginTop: ".7rem" }}>
                <span>
                  O pega la lista, una {QUIEN1} por línea
                  {enParejas && " (los dos nombres separados por una barra)"}
                </span>
                <textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder={
                    enParejas
                      ? "Ramírez Luis / Ortega Ana, Deportivo Norte, 1420\nSalas Pedro / Nava Iris, Club Centro"
                      : "Ramírez Luis, Deportivo Norte, 1420\nOrtega Ana, Club Centro, 1385\nSalas Pedro"
                  }
                />
              </label>
              <div className="fila">
                <button
                  className="btn leve"
                  onClick={() => {
                    importarJugadores(texto);
                    setTexto("");
                  }}
                >
                  Importar lo pegado
                </button>
              </div>
            </div>
          )}

          {verVotacion && (
            <Votacion
              lista={enOrdenDeSiembra(t)}
              votos={borradorVotos ?? t.votacion?.votos ?? []}
              alCambiar={setBorradorVotos}
              alAplicar={(orden, bloques) => ordenarPorVotacion(orden, bloques, borradorVotos ?? t.votacion?.votos ?? [])}
              alInscribir={inscribirDesdeVotos}
              enParejas={enParejas}
              handicap={
                formal ? null : { activo: hc.activo, base: hc.base, tabla: hc.tablaBloques, tope: hc.tope, meta: puntos }
              }
              alTabla={(tabla) => cambiarEstructura((d) => void (d.handicap = { ...hc, tablaBloques: tabla }))}
              alActivarBloques={() => cambiarEstructura((d) => void (d.handicap = { ...hc, activo: true, base: "bloque" }))}
            />
          )}

          {t.jugadores.length > 1 && (
            <div className="sec compacta">
              <p className="sub">
                {t.siembraManual
                  ? "La lista está en el orden que tú fijaste, y ese orden es la siembra: los de arriba se reparten primero, uno por grupo."
                  : "La lista va por ranking, y ese orden es la siembra. Si no tienes ranking, o quieres otro orden, acomódalos con las flechas de mejor a peor o con una votación."}
              </p>
              {t.siembraManual && t.jugadores.some((j) => j.rank > 0) && (
                <div className="fila">
                  <button
                    className="btn leve"
                    onClick={() =>
                      cambiarEstructura((d) => {
                        d.jugadores = [...d.jugadores].sort((a, b) => b.rank - a.rank);
                        d.siembraManual = false;
                      })
                    }
                  >
                    Volver al orden por ranking
                  </button>
                </div>
              )}
            </div>
          )}

          <ul className="lista">
            {(t.siembraManual ? t.jugadores : [...t.jugadores].sort((a, b) => b.rank - a.rank)).map((j, i, lista) => (
                <li key={j.id} className="item">
                  <span className="idx">{i + 1}</span>
                  <span className="nom">{j.nombre}</span>
                  <span className="met">{[j.club, j.rank ? `rk ${j.rank}` : ""].filter(Boolean).join(" · ")}</span>
                  {hc.activo && porBloque && !formal && (
                    <select
                      className="bloque-sel"
                      value={j.bloque ?? 0}
                      title="Bloque de nivel para el hándicap"
                      aria-label={`Bloque de ${j.nombre}`}
                      onChange={(e) =>
                        cambiarEstructura((d) => {
                          const x = d.jugadores.find((y) => y.id === j.id);
                          if (x) x.bloque = Number(e.target.value) || undefined;
                        })
                      }
                    >
                      <option value={0}>sin bloque</option>
                      {Array.from({ length: Math.max(kBloques, 1) + 1 }, (_, b) => (
                        <option key={b} value={b + 1}>
                          bloque {b + 1}
                        </option>
                      ))}
                    </select>
                  )}
                  <span className="flechas">
                    <button className="x" title="Subir" disabled={i === 0} onClick={() => mover(j.id, -1)}>
                      ↑
                    </button>
                    <button className="x" title="Bajar" disabled={i === lista.length - 1} onClick={() => mover(j.id, 1)}>
                      ↓
                    </button>
                  </span>
                  <button
                    className="x"
                    title={
                      yaSeJuega
                        ? "Con partidos ya jugados no se quita a nadie: si no se presenta, registra sus partidos como perdidos con «Corregir»"
                        : "Quitar"
                    }
                    disabled={yaSeJuega}
                    onClick={() =>
                      cambiarEstructura((d) => {
                        d.jugadores = d.jugadores.filter((x) => x.id !== j.id);
                        d.grupos = [];
                        d.partidos = [];
                        d.relajaciones = [];
                      })
                    }
                  >
                    ✕
                  </button>
                </li>
              ))}
          </ul>
          {!t.jugadores.length && <p className="vacio">Todavía no hay {QUIEN}.</p>}
          {enParejas && t.jugadores.some((j) => !j.nombre2?.trim()) && (
            <p className="nota">
              Hay inscripciones con un solo nombre. En {t.modalidad === "mixtos" ? "mixtos" : "dobles"} tienen que ser
              dos: quítalas y vuélvelas a meter completas antes de sortear.
            </p>
          )}
        </div>
      )}

      {/* ---------------- árbitros ---------------- */}
      {vista === "arbitros" && (
        <div className="sec">
          <h2>Árbitros</h2>
          <p className="sub">
            Cada uno queda en una mesa. Desde su tablet elige su nombre de esta lista y solo ve los partidos de esa
            mesa.
          </p>
          <div className="campos">
            {campo("Nombre", arb.nombre, (v) => setArb({ ...arb, nombre: v }), { placeholder: "Nombre del árbitro" })}
            {campo("Mesa", arb.mesa, (v) => setArb({ ...arb, mesa: v }), { type: "number", min: 1 })}
          </div>
          <div className="fila">
            <button
              className="btn"
              onClick={() => {
                const nombre = arb.nombre.trim();
                if (!nombre) return;
                cambiarEstructura((d) =>
                  d.arbitros.push({ id: nuevoId(), nombre, mesa: Math.max(1, Number(arb.mesa) || 1) }),
                );
                setArb({ nombre: "", mesa: String(Math.min(t.mesas, (Number(arb.mesa) || 1) + 1)) });
              }}
            >
              Agregar
            </button>
          </div>
          <ul className="lista">
            {[...t.arbitros]
              .sort((a, b) => a.mesa - b.mesa)
              .map((a) => (
                <li key={a.id} className="item">
                  <span className="idx">{a.mesa}</span>
                  <span className="nom">{a.nombre}</span>
                  <span className="met">
                    {codigos[a.id] ? (
                      <b className="codigo-alta">{codigos[a.id]}</b>
                    ) : (
                      <button
                        className="btn chico leve"
                        disabled={conexion.estado !== "conectado"}
                        title={
                          conexion.estado === "conectado"
                            ? "Genera un código para su tablet"
                            : "Hace falta estar en red con el relevo"
                        }
                        onClick={() => void invitar(a.id, a.nombre)}
                      >
                        Dar de alta
                      </button>
                    )}
                    <select
                      value={a.mesa}
                      onChange={(e) =>
                        cambiarEstructura((d) => {
                          const x = d.arbitros.find((y) => y.id === a.id);
                          if (x) x.mesa = Number(e.target.value);
                        })
                      }
                    >
                      {Array.from({ length: Math.max(1, t.mesas) }, (_, i) => i + 1).map((m) => (
                        <option key={m} value={m}>
                          mesa {m}
                        </option>
                      ))}
                    </select>
                  </span>
                  <button
                    className="x"
                    title="Quitar"
                    onClick={() => cambiarEstructura((d) => void (d.arbitros = d.arbitros.filter((x) => x.id !== a.id)))}
                  >
                    ✕
                  </button>
                </li>
              ))}
          </ul>
          {!t.arbitros.length && <p className="vacio">Todavía no hay árbitros.</p>}
          {t.arbitros.length > 0 && t.arbitros.length < t.mesas && (
            <p className="nota">
              Hay {t.mesas} mesas y {t.arbitros.length} árbitros. Las mesas sin árbitro quedan al final de la propuesta
              de asignación.
            </p>
          )}
        </div>
      )}

      {/* ---------------- sorteo ---------------- */}
      {vista === "grupos" && (
        <>
          <div className="sec">
            <h2>{todos ? "Calendario" : "Sorteo"}</h2>
            <p className="sub">
              {todos
                ? "Todos contra todos, una vez. En cada jornada cada quien juega un partido; con número impar, en cada jornada descansa uno. La semilla decide qué toca en cada jornada."
                : "Reparte por siembra y trata de que no coincidan compañeros de club. Si no alcanza, lo dice y explica qué cedió."}
            </p>
            <div className="fila">
              <button className="btn" disabled={yaSeJuega} onClick={() => hacerSorteo(true)}>
                {todos ? "Armar el calendario" : "Sortear en la computadora"}
              </button>
              <button className="btn leve" disabled={yaSeJuega} onClick={() => hacerSorteo(false)}>
                {todos || t.siembraManual ? "En el orden de la lista" : "Repartir por ranking"}
              </button>
              <button
                className="btn grave"
                disabled={yaSeJuega}
                onClick={() => {
                  if (!t.grupos.length || !confirm("Se borran los grupos y todos los partidos. ¿Seguir?")) return;
                  cambiarEstructura((d) => {
                    d.grupos = [];
                    d.partidos = [];
                    d.relajaciones = [];
                    d.actaSorteo = [];
                  });
                }}
              >
                Deshacer sorteo
              </button>
            </div>
            {yaSeJuega && <p className="nota">{POR_QUE_FIJO}</p>}
            {t.semillaSorteo > 0 && (
              <div className="semilla">
                <span className="eti">Sorteo generado con la semilla</span>
                <b>{t.semillaSorteo}</b>
                <span className="pie">
                  Queda anotada en el acta. Con este número el sorteo se repite idéntico, que es lo que permite
                  demostrar cómo se hizo si alguien reclama.
                </span>
              </div>
            )}

            <details className="ayuda">
              <summary>Repetir un sorteo anterior</summary>
              <p className="sub">
                Solo hace falta para reproducir un sorteo ya hecho, delante de quien lo discuta. Para sortear
                normalmente no se toca: el número lo elige el sistema.
              </p>
              <div className="fila">
                <label className="f" style={{ maxWidth: "16rem" }}>
                  <span>Semilla</span>
                  <input
                    value={semilla}
                    onChange={(e) => setSemilla(e.target.value)}
                    placeholder={String(t.semillaSorteo || 482913)}
                    inputMode="numeric"
                  />
                </label>
              </div>
              <div className="fila">
                <button className="btn leve" disabled={!Number(semilla) || yaSeJuega} onClick={() => hacerSorteo(true)}>
                  Rehacer con esta semilla
                </button>
              </div>
            </details>

            {t.grupos.length > 0 &&
              !todos &&
              (t.relajaciones.length ? (
                <div className="nota mal">
                  <div>
                    <b>No se pudo separar a todos.</b>
                    {t.relajaciones.map((r, i) => (
                      <div key={i}>{r}</div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="nota bien">
                  Se respetaron todas las restricciones: sembrados repartidos y clubes separados.
                </p>
              ))}

            {t.actaSorteo.length > 0 && (
              <details className="ayuda">
                <summary>Acta del sorteo</summary>
                <ol className="acta">
                  {t.actaSorteo.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ol>
              </details>
            )}
          </div>

          <div className="gr">
            {t.grupos.map((gr) => {
              const suyos = t.partidos.filter((p) => p.grupoId === gr.id);
              const ord = clasificar(gr.jugadores, suyos, t.formatoGrupos, exigir);
              const m = estadisticas(gr.jugadores, suyos, t.formatoGrupos, exigir);
              return (
                <div key={gr.id} className="grupo">
                  <h3>{gr.nombre}</h3>
                  <table className="tab-pos">
                    <thead>
                      <tr>
                        <th />
                        <th>Jugador</th>
                        <th title="Partidos jugados">Jugados</th>
                        <th title="Sets ganados y perdidos">Sets</th>
                        <th title="Puntos de la tabla: 2 por partido ganado y 1 por perdido">Puntos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ord.map((id, i) => (
                        <tr key={id} className={!todos && i < t.clasifican ? "clasifica" : undefined}>
                          <td className="pos">{i + 1}</td>
                          <td className="j">{nom(id)}</td>
                          <td>{m[id].pj}</td>
                          <td>
                            {m[id].sg}–{m[id].sp}
                          </td>
                          <td className="p">{m[id].pts}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
          {!t.grupos.length && (
            <p className="vacio">{todos ? "Sin calendario. Ármalo desde arriba." : "Sin grupos. Sortea desde arriba."}</p>
          )}

          {todos && campeones && (
            <div className="campeon">
              <span className="copa" aria-hidden="true">
                🏆
              </span>
              <div>
                <span className="rot">Campeón</span>
                <b>{nom(campeones.campeon)}</b>
                <p>
                  Subcampeón: {nom(campeones.subcampeon)}
                  {campeones.terceros.length > 0 && ` · Tercer lugar: ${campeones.terceros.map(nom).join(" y ")}`}
                </p>
              </div>
              <button className="btn" onClick={alInforme}>
                Ver el acta
              </button>
            </div>
          )}

          {todos &&
            [...new Set(t.partidos.map((p) => p.jornada ?? 0).filter(Boolean))]
              .sort((a, b) => a - b)
              .map((j) => {
                const suyos = t.partidos.filter((p) => p.jornada === j).sort((a, b) => a.orden - b.orden);
                const hechos = suyos.filter((p) => partidoListo(p, t.formatoGrupos, exigir)).length;
                const descansa = t.grupos[0]?.jugadores.filter((id) => !suyos.some((p) => p.aId === id || p.bId === id));
                return (
                  <details key={j} className="ayuda jornada" open={hechos < suyos.length}>
                    <summary>
                      Jornada {j} · {hechos} de {suyos.length} jugados
                      {descansa?.length ? ` · descansa ${descansa.map(nom).join(", ")}` : ""}
                    </summary>
                    {suyos.map((p) => (
                      <TarjetaPartido key={p.id} t={t} p={p} alAbrir={alAbrir} />
                    ))}
                  </details>
                );
              })}
        </>
      )}

      {/* ---------------- cuadro ---------------- */}
      {vista === "cuadro" && (
        <>
          <div className="sec">
            <h2>Eliminatoria</h2>
            <p className="sub">Toma a los que avanzan de cada grupo y cruza primeros contra segundos.</p>
            <div className="fila">
              <button className="btn" disabled={llaveJugada} onClick={hacerCuadro}>
                Armar cuadro
              </button>
              <button
                className="btn grave"
                disabled={llaveJugada}
                title={llaveJugada ? "La eliminatoria ya tiene partidos anotados" : undefined}
                onClick={() => {
                  if (!finales.length || !confirm("Se borra el cuadro y sus marcadores. ¿Seguir?")) return;
                  cambiarEstructura((d) => void (d.partidos = d.partidos.filter((p) => p.etapa !== "final")));
                }}
              >
                Borrar cuadro
              </button>
            </div>
            <p className="sub" style={{ margin: ".85rem 0 0" }}>
              {!t.grupos.length
                ? "Primero hay que sortear los grupos."
                : pendientes
                  ? `Faltan ${pendientes} partidos de grupo. Puedes armarlo igual, pero con la tabla incompleta.`
                  : "Todos los grupos están cerrados."}
            </p>
          </div>

          {campeones && (
            <div className="campeon">
              <span className="copa" aria-hidden="true">
                🏆
              </span>
              <div>
                <span className="rot">Campeón</span>
                <b>{nom(campeones.campeon)}</b>
                <p>
                  Subcampeón: {nom(campeones.subcampeon)}
                  {campeones.terceros.length > 0 && ` · Tercer lugar: ${campeones.terceros.map(nom).join(" y ")}`}
                </p>
              </div>
              <button className="btn" onClick={alInforme}>
                Ver el acta
              </button>
            </div>
          )}

          {/* El cuadro se dibuja como el de papel: las llaves de cada ronda
              se juntan de dos en dos y el trazo lleva la vista al ganador. */}
          <div className="rondas">
            {Array.from({ length: rondas }, (_, r) => (
              <div className="ronda" key={r}>
                <h3>{nombreRonda(r, rondas)}</h3>
                <div className="llaves">
                  {finales
                    .filter((p) => p.ronda === r)
                    .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
                    .map((p) => {
                      const st = reducir(p, setsDe(t, p));
                      const g = ganadorDe(p, setsDe(t, p), exigir);
                      const jugable = !!(p.aId && p.bId);
                      const linea = (id: string | null, lado: "a" | "b") => (
                        <div className={g === id ? "gana" : id ? "" : "bye"}>
                          <span>{id ? nom(id) : p.ronda === 0 && (p.aId || p.bId) ? "descansa" : "por definir"}</span>
                          <b>{id ? st.sets[lado] : ""}</b>
                        </div>
                      );
                      return (
                        <div key={p.id} className={`ranura${r === rondas - 1 ? " ultima" : ""}${r > 0 ? " entra" : ""}`}>
                          <div
                            className={`llave${st.terminado ? " cerrada" : ""}${jugable ? "" : " muda"}`}
                            onClick={() => jugable && alAbrir(p.id)}
                            title={jugable ? "Abrir el partido" : undefined}
                          >
                            {linea(p.aId, "a")}
                            {linea(p.bId, "b")}
                            {p.mesa > 0 && !st.terminado && <span className="mesita">mesa {p.mesa}</span>}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
          {!finales.length && <p className="vacio">Sin cuadro todavía.</p>}
        </>
      )}

      {/* ---------------- mesas ---------------- */}
      {vista === "mesas" && <Mesas t={t} cambiarEstructura={cambiarEstructura} alAbrir={alAbrir} />}

      {/* ---------------- resultados ---------------- */}
      {vista === "resultados" && <Resultados t={t} anotarEn={anotarEn} cambiarEstructura={cambiarEstructura} alAbrir={alAbrir} quien={quien} />}

      {/* ---------------- a distancia ---------------- */}
      {vista === "distancia" && <Distancia t={t} anotarEn={anotarEn} cambiarEstructura={cambiarEstructura} quien={quien} />}

      {/* ---------------- red ---------------- */}
      {vista === "red" && (
        <>
          <Conectar
            conexion={conexion}
            relevo={relevo}
            alGuardar={alGuardarRelevo}
            choque={choque}
            alAdoptar={alAdoptar}
            credencial={credencial}
            alCredencial={alCredencial}
            detallado
          />

          <div className="sec">
            <h2>Terminar el torneo</h2>
            <p className="sub">
              Apaga el servidor de esta computadora. Los resultados quedan guardados y las tablets conservan su copia,
              pero dejan de sincronizarse. Cerrar la ventana negra hace lo mismo.
            </p>
            <div className="fila">
              <button
                className="btn grave"
                disabled={conexion.estado !== "conectado"}
                onClick={async () => {
                  if (!confirm("Se apaga el servidor y las tablets dejan de sincronizarse. ¿Terminar el torneo?")) return;
                  const r = await conexion.pedir("/api/apagar", "POST", {});
                  setNota(
                    r?.ok
                      ? "Torneo terminado. Ya puedes cerrar la ventana negra."
                      : "No se pudo apagar el servidor. Cierra la ventana negra a mano.",
                  );
                }}
              >
                Terminar el torneo y apagar el servidor
              </button>
            </div>
          </div>

          <div className="sec">
            <h2>Repartir la aplicación</h2>
            <p className="sub">
              Abre esta página en la pantalla del gimnasio o pásasela a los árbitros: cada uno escanea su código y entra
              identificado, con su mesa puesta, sin teclear la dirección.
            </p>
            <div className="fila">
              <button className="btn" onClick={alRepartir}>
                Abrir la página de reparto
              </button>
            </div>
          </div>

          {relevo.url && (
            <div className="sec">
              <h2>Llevarse TTorneo a otra computadora</h2>
              <p className="sub">
                Un archivo con todo lo necesario para organizar un torneo en otra computadora: la aplicación, el relevo y
                el lanzador. Allí solo hay que descomprimirlo, instalar Node.js (gratis, de nodejs.org) y hacer doble
                clic en «Iniciar torneo.bat». Los teléfonos no lo necesitan: entran con el código QR.
              </p>
              <div className="fila">
                <a className="btn leve" href={`${relevo.url.replace(/\/+$/, "")}/descargar/TTorneo.zip`} download="TTorneo.zip">
                  Descargar TTorneo.zip
                </a>
              </div>
            </div>
          )}

          {credencial?.papel === "juez" && <Accesos conexion={conexion} />}

          <div className="sec">
            <h2>Acta del torneo</h2>
            <p className="sub">
              El acta es el documento de la jornada: quiénes jugaron, cómo salió el sorteo, el orden de juego con todos
              los resultados, las tablas de cada grupo, la llave y las correcciones que hizo esta mesa. Se abre para
              revisarla y desde ahí se guarda como PDF o se imprime.
            </p>
            <div className="fila">
              <button className="btn" onClick={alInforme}>
                Ver el acta e imprimirla
              </button>
            </div>
          </div>

          <div className="sec">
            <h2>Respaldo y mesas autogestionadas</h2>
            <p className="sub">
              El archivo lleva el torneo entero, con todos los puntos anotados. Es el respaldo de la jornada y también
              lo que se le pasa a una mesa autogestionada para los días en que no estés: ella anota y te devuelve un
              archivo de resultados, que se abre aquí mismo y se suma a lo que ya tienes sin reemplazar nada.
            </p>
            <div className="fila">
              <button className="btn leve" onClick={() => exportar(t)}>
                Descargar el archivo
              </button>
              <button className="btn" onClick={() => respaldo.current?.click()}>
                Recibir resultados o cargar un archivo
              </button>
              <input
                ref={respaldo}
                type="file"
                accept=".json,application/json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const fr = new FileReader();
                  fr.onload = () => {
                    try {
                      const leido = leerEntrante(String(fr.result));
                      if ("envio" in leido) {
                        recibirEnvio(leido.envio);
                        return;
                      }
                      const entrante = leido.torneo;
                      if (entrante.id === t.id) {
                        // Es este mismo torneo, de otro momento o de otro
                        // aparato: se une. Los puntos se suman sin
                        // duplicarse y la estructura que vale es la de
                        // revisión más alta, así que no se pierde nada de
                        // lo que hay aquí.
                        const { torneo, resumen } = unir(t, entrante);
                        const nuevos = tocadosPorUnion(t, torneo);
                        cambiarEstructura((d) => {
                          Object.assign(d, torneo);
                          d.revision = Math.max(t.revision, entrante.revision);
                        });
                        setRecibidos(nuevos);
                        setNota(
                          resumen.eventosNuevos
                            ? `Se unió el archivo: ${resumen.eventosNuevos} eventos nuevos en ${resumen.partidosTocados} partidos.`
                            : "El archivo no traía nada que no tuvieras ya.",
                        );
                        return;
                      }
                      // Es otro torneo: entra al archivo y se abre, y el
                      // que estaba se guarda en vez de perderse.
                      if (!confirm(`Se va a abrir «${entrante.nombre || "sin nombre"}». El de ahora se guarda en el archivo. ¿Seguir?`))
                        return;
                      guardarEnArchivo(entrante);
                      cambiarDeTorneo(entrante.id);
                    } catch (err) {
                      setNota(err instanceof Error ? err.message : "No se pudo leer el archivo.");
                    }
                  };
                  fr.readAsText(f, "utf-8");
                  e.target.value = "";
                }}
              />
            </div>
            {recibidos.length > 0 &&
              (() => {
                const esperan = recibidos.filter((id) => {
                  const p = t.partidos.find((x) => x.id === id);
                  return p && reducir(p, setsDe(t, p)).fase === "por-validar";
                });
                return (
                  <div className="nota bien">
                    <div>
                      <b>
                        {esperan.length
                          ? `${esperan.length} ${esperan.length === 1 ? "resultado recibido espera" : "resultados recibidos esperan"} tu visto bueno.`
                          : "Lo recibido no trae partidos terminados por aceptar."}
                      </b>
                      <div className="fila" style={{ marginTop: ".6rem" }}>
                        {esperan.length > 0 && (
                          <button className="btn chico" onClick={aceptarRecibidos}>
                            Aceptarlos todos
                          </button>
                        )}
                        <button className="btn chico leve" onClick={() => setVista("resultados")}>
                          Revisarlos uno por uno
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}
            <p className="sub" style={{ marginTop: ".8rem" }}>
              Versión {__VERSION__}, compilada el {__COMPILADO__} · Revisión {t.revision} · {t.partidos.reduce((n, p) => n + p.eventos.length, 0)} eventos ·{" "}
              {t.partidos.filter((p) => partidoListo(p, setsDe(t, p), exigir)).length}{" "}
              partidos cerrados
            </p>
          </div>

          <div className="sec">
            <h2>Rol de juego</h2>
            <p className="sub">Orden en que se van a llamar los partidos. Se evita que alguien juegue dos seguidos.</p>
            <div className="fila">
              <button
                className="btn leve"
                onClick={() =>
                  cambiarEstructura((d) => {
                    const grupo = d.partidos.filter((p) => p.etapa === "grupo");
                    repartir(grupo);
                  })
                }
              >
                Rehacer el orden
              </button>
            </div>
          </div>
          {[...t.partidos]
            .filter((p) => p.aId && p.bId)
            .sort((a, b) => a.orden - b.orden)
            .slice(0, 40)
            .map((p) => (
              <TarjetaPartido key={p.id} t={t} p={p} alAbrir={alAbrir} />
            ))}
        </>
      )}
    </div>
  );
}
