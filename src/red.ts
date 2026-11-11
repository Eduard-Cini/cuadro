import { useCallback, useEffect, useRef, useState } from "react";
import type { Credencial, Evento, Paquete, Torneo } from "./nucleo";
import { estaVacio, pruebaPeticion } from "./nucleo";
import type { Rol } from "./almacen";
import { leerCredencial } from "./almacen";

export type EstadoRed = "apagado" | "conectando" | "conectado" | "caido" | "sin-credencial";

export interface Conexion {
  estado: EstadoRed;
  /** Última vez que entró o salió algo, en reloj local. */
  ultimo: number;
  recibidos: number;
  enviados: number;
  /** Eventos que el relevo devolvió por falta de permiso. */
  negados: number;
  error: string;
  /**
   * Revisión que tiene el relevo cuando es más alta que la de aquí.
   *
   * Solo le pasa a la mesa de control, y significa que lo que está
   * mandando no entra: el relevo guarda una versión más nueva del mismo
   * torneo —de otro navegador, de otra jornada— y no la va a pisar con una
   * más vieja. Quién tiene la buena solo lo sabe quien está delante.
   */
  atraso: number | null;
  /** Deja este aparato con el torneo tal como lo tiene el relevo. */
  traerDelRelevo: () => Promise<void>;
  sincronizar: () => void;
  /**
   * Manda una petición firmada. Devuelve null si este aparato no está dado
   * de alta.
   *
   * Todo el tráfico firmado pasa por aquí para que el contador lo lleve un
   * solo sitio: dos llamadas que se dieran el mismo número harían que el
   * relevo rechazara la segunda por repetida.
   */
  pedir: (ruta: string, metodo: "GET" | "POST", cuerpo?: unknown) => Promise<Response | null>;
}

interface Opciones {
  /** Dirección del relevo. Vacío significa trabajar sin red. */
  url: string;
  rol: Rol;
  /** Identidad de este dispositivo ante el relevo. */
  credencial: Credencial | null;
  /** El contador crece con cada petición y hay que guardarlo. */
  alAvanzar: (n: number) => void;
  /** El torneo vivo, por referencia: anotar un punto no reinicia la red. */
  torneo: React.MutableRefObject<Torneo>;
  alRecibir: (estructura: Torneo | null, eventos: Array<{ id: string; eventos: Evento[] }>) => void;
}

export const limpiarUrl = (url: string): string => url.trim().replace(/\/+$/, "");

/**
 * El paquete con lo que todavía no ha llegado al relevo.
 *
 * Devuelve null si no hay nada pendiente, que en un torneo tranquilo es
 * casi siempre: la vuelta de sincronización se queda en una sola lectura.
 */
function pendientesDe(t: Torneo, quien: string, resueltos: Set<string>): Paquete | null {
  const partidos: Paquete["partidos"] = [];
  for (const p of t.partidos) {
    const nuevos = p.eventos.filter((ev) => !resueltos.has(ev.id));
    if (nuevos.length) partidos.push({ id: p.id, eventos: nuevos });
  }
  return partidos.length ? { torneoId: t.id, revision: t.revision, desde: quien, partidos } : null;
}

/**
 * Petición firmada.
 *
 * El token no viaja: viaja una prueba de que se conoce, calculada sobre el
 * método, la ruta, el contador y el cuerpo. Con eso, quien escuche la red
 * no se lleva la credencial, no puede cambiar el cuerpo por el camino, y
 * no puede repetir la petición más tarde.
 */
async function pedirFirmado(
  base: string,
  ruta: string,
  metodo: "GET" | "POST",
  cuerpo: unknown,
  cred: Credencial,
  n: number,
): Promise<Response> {
  const crudo = cuerpo === undefined ? "" : JSON.stringify(cuerpo);
  return fetch(base + ruta, {
    method: metodo,
    headers: {
      "content-type": "application/json",
      "x-quien": cred.quien,
      "x-n": String(n),
      "x-prueba": pruebaPeticion(cred.token, metodo, ruta, n, crudo),
    },
    body: metodo === "POST" ? crudo : undefined,
  });
}

/**
 * Habla con el relevo de la red local.
 *
 * El diseño evita la pregunta difícil: como los eventos son idempotentes,
 * el cliente no necesita saber qué mandó ya. Manda lo suyo, pide lo que no
 * tiene, y si algo se pierde la vuelta siguiente lo arregla. No hay
 * confirmaciones que perder ni estado a medias que reconciliar.
 *
 * Por eso hay dos disparadores y ninguno es crítico: el aviso instantáneo
 * del relevo, para que el marcador de la pantalla se mueva mientras se
 * juega, y un repaso periódico que tapa lo que se haya caído. Si el Wi-Fi
 * del gimnasio se va diez minutos, la tablet sigue anotando puntos contra
 * su copia local y al volver la red se pone al día sola.
 */
export function useRelevo(op: Opciones): Conexion {
  const [estado, setEstado] = useState<EstadoRed>("apagado");
  const [ultimo, setUltimo] = useState(0);
  const [recibidos, setRecibidos] = useState(0);
  const [enviados, setEnviados] = useState(0);
  const [negados, setNegados] = useState(0);
  const [error, setError] = useState("");
  const [atraso, setAtraso] = useState<number | null>(null);

  const seq = useRef(0);
  const revisionVista = useRef(-1);
  const corriendo = useRef(false);
  const pedir = useRef<() => void>(() => {});

  /*
   * Qué se ha mandado ya.
   *
   * Sin esto, cada vuelta reenvía el torneo entero: al principio no se
   * nota, pero con treinta y dos jugadores y la tarde avanzada son cientos
   * de kilobytes cada tres segundos por dispositivo, contra un punto de
   * acceso doméstico. Se manda solo lo que el relevo todavía no ha
   * confirmado, y la estructura únicamente cuando el juez la cambia.
   */
  const resueltos = useRef(new Set<string>());
  const revisionEnviada = useRef(-1);

  const url = limpiarUrl(op.url);
  const { rol, credencial } = op;
  const torneo = op.torneo;
  const alRecibir = useRef(op.alRecibir);
  alRecibir.current = op.alRecibir;
  const alAvanzar = useRef(op.alAvanzar);
  alAvanzar.current = op.alAvanzar;

  /* El contador vive en un ref para que dos peticiones seguidas no se den
     el mismo número, que el relevo rechazaría por repetido. */
  const contador = useRef(credencial?.n ?? 0);
  useEffect(() => {
    if (credencial && credencial.n > contador.current) contador.current = credencial.n;
  }, [credencial]);
  const siguienteN = () => {
    // Dos pestañas con la misma credencial comparten el contador por el
    // almacenamiento. Si cada una llevara el suyo, la que se queda atrás
    // repite números que el relevo ya vio y se le rechaza todo.
    const guardado = credencial ? (leerCredencial()?.n ?? 0) : 0;
    contador.current = Math.max(contador.current, guardado) + 1;
    alAvanzar.current(contador.current);
    return contador.current;
  };

  const vuelta = useCallback(async () => {
    if (!url || corriendo.current) return;
    corriendo.current = true;

    try {
      const t = torneo.current;

      /* 1. Lo propio sale primero, y solo lo que falte por mandar. */
      if (credencial) {
        // Un torneo en blanco no se manda: recién creado con «Torneo nuevo»
        // todavía no hay nada que enseñar, y en un aparato que nunca tuvo
        // torneo mandarlo dejaría a las tablets y a la pantalla sin el que
        // se está jugando. Se manda en cuanto tenga jugadores.
        const estructuraNueva = rol === "juez" && t.revision !== revisionEnviada.current && !estaVacio(t);

        if (estructuraNueva) {
          // La estructura viaja sin los marcadores. Son dos cosas distintas
          // y tienen ritmos distintos: el sorteo y las mesas cambian unas
          // pocas veces por torneo, los puntos cada segundo. Mandarlos
          // juntos obligaría a reenviar la partida entera cada vez que el
          // juez mueve una mesa.
          const ligero: Torneo = { ...t, partidos: t.partidos.map((p) => ({ ...p, eventos: [] })) };
          // `reemplazar`: si el relevo tiene abierta otra categoría, se cambia
          // a esta. El torneo abierto en la mesa de control es el que tienen
          // que ver las tablets; el relevo guarda el anterior en su carpeta
          // y lo devuelve entero si se vuelve a abrir.
          const r = await pedirFirmado(
            url,
            "/api/estructura",
            "POST",
            { torneo: ligero, reemplazar: true },
            credencial,
            siguienteN(),
          );
          if (r.status === 409) {
            const d = await r.json();
            setError(`El relevo tiene otro torneo cargado (${d.torneoId ?? "?"}).`);
          } else if (r.status === 401 || r.status === 403) {
            setEstado("sin-credencial");
            setError((await r.json()).error ?? "credencial rechazada");
            return;
          } else if (!r.ok) {
            throw new Error(`el relevo respondió ${r.status}`);
          } else {
            revisionEnviada.current = t.revision;
            // Si el relevo responde con una revisión mayor que la mandada,
            // no la aceptó. Se avisa en vez de seguir como si nada.
            const d = await r.json().catch(() => ({}));
            setAtraso(typeof d.revision === "number" && d.revision > t.revision ? d.revision : null);
          }
        }

        if (rol !== "pantalla") {
          const paq = pendientesDe(t, credencial.quien, resueltos.current);
          if (paq) {
            const r = await pedirFirmado(url, "/api/paquete", "POST", paq, credencial, siguienteN());
            if (r.status === 401 || r.status === 403) {
              setEstado("sin-credencial");
              setError((await r.json()).error ?? "credencial rechazada");
              return;
            }
            if (!r.ok) throw new Error(`el relevo respondió ${r.status}`);
            const d = await r.json();
            // Lo guardado y lo rechazado se dan por resuelto igual: de un
            // evento negado por permisos no se saca nada reintentándolo, y
            // reintentar en bucle taparía el aviso que el árbitro necesita
            // ver.
            for (const id of d.resueltos ?? []) resueltos.current.add(id);
            if (d.nuevos) setEnviados((n) => n + d.nuevos);
            if (d.negados) {
              setNegados((n) => n + d.negados);
              setError(`El relevo devolvió ${d.negados}: ${(d.motivos ?? []).join("; ")}`);
            }
          }
        }
      }

      /* 2. Y después se recoge lo que hayan dejado los demás. Leer no
            necesita credencial: el torneo está proyectado en la pared. */
      const r = await fetch(`${url}/api/estado?seq=${seq.current}&revision=${revisionVista.current}`);
      if (!r.ok) throw new Error(`el relevo respondió ${r.status}`);
      const d = await r.json();

      /* Si el relevo arrancó de cero, lo dado por mandado ya no vale. */
      if (typeof d.seq === "number" && d.seq < seq.current) {
        resueltos.current.clear();
        revisionEnviada.current = -1;
      }
      seq.current = d.seq ?? seq.current;
      const cuantos = (d.eventos ?? []).reduce((n: number, x: { eventos: Evento[] }) => n + x.eventos.length, 0);
      // El juez es la fuente de la estructura: no se la deja imponer por
      // el relevo, que solo le devolvería su propio eco con retraso.
      const estructura: Torneo | null = rol === "juez" ? null : (d.estructura ?? null);
      if (estructura || cuantos) {
        alRecibir.current(estructura, d.eventos ?? []);
        // Lo que llega del relevo, el relevo ya lo tiene. Sin esto, cada
        // dispositivo le devolvería en la vuelta siguiente los eventos que
        // el propio relevo le acaba de dar, y el tráfico se multiplicaría
        // por el número de aparatos conectados.
        for (const x of d.eventos ?? []) for (const ev of x.eventos) resueltos.current.add(ev.id);
        if (cuantos) setRecibidos((n) => n + cuantos);
      }
      if (typeof d.revision === "number") revisionVista.current = d.revision;

      setEstado(credencial || rol === "pantalla" ? "conectado" : "sin-credencial");
      if (credencial || rol === "pantalla") setError("");
      setUltimo(Date.now());
    } catch (e) {
      setEstado("caido");
      setError(e instanceof Error ? e.message : "no se pudo hablar con el relevo");
    } finally {
      corriendo.current = false;
    }
  }, [url, rol, credencial, torneo]);

  pedir.current = vuelta;

  useEffect(() => {
    if (!url) {
      setEstado("apagado");
      return;
    }
    setEstado("conectando");
    setAtraso(null);
    revisionVista.current = -1;
    seq.current = 0;
    resueltos.current.clear();
    revisionEnviada.current = -1;
    void vuelta();

    let fuente: EventSource | null = null;
    try {
      fuente = new EventSource(`${url}/api/flujo`);
      fuente.onmessage = () => pedir.current();
      fuente.onerror = () => setEstado((e) => (e === "conectado" ? "caido" : e));
    } catch {
      /* sin avisos: queda el repaso periódico */
    }

    const reloj = setInterval(() => pedir.current(), 3000);
    return () => {
      clearInterval(reloj);
      fuente?.close();
    };
  }, [url, vuelta]);

  /**
   * Toda petición firmada pasa por aquí, y por eso aquí se detecta que la
   * credencial ha dejado de valer.
   *
   * Pasa cuando el relevo se reinicia descartando las altas. Antes el
   * aparato seguía enseñando «en red» en verde mientras el otro lado
   * rechazaba todo lo que mandaba: un árbitro podía anotar un partido
   * entero creyendo que llegaba.
   */
  const pedirFirmadoAqui = useCallback(
    async (ruta: string, metodo: "GET" | "POST", cuerpo?: unknown) => {
      if (!url || !credencial) return null;
      const r = await pedirFirmado(url, ruta, metodo, cuerpo, credencial, siguienteN());
      if (r.status === 401 || r.status === 403) {
        setEstado("sin-credencial");
        setError("El relevo ya no reconoce esta credencial. Pide un código nuevo al juez.");
      }
      return r;
    },
    // `siguienteN` solo toca refs, así que no hace falta que entre aquí.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [url, credencial],
  );

  /**
   * Trae el torneo entero del relevo, estructura incluida.
   *
   * La mesa de control normalmente no acepta estructura del relevo —es
   * ella quien la dicta—, así que esto solo corre cuando quien está
   * delante lo pide, al ver el aviso de que el relevo va por delante.
   */
  const traerDelRelevo = useCallback(async () => {
    if (!url) return;
    const r = await fetch(`${url}/api/estado?seq=0&revision=-1`);
    if (!r.ok) return;
    const d = await r.json();
    alRecibir.current(d.estructura ?? null, d.eventos ?? []);
    for (const x of d.eventos ?? []) for (const ev of x.eventos) resueltos.current.add(ev.id);
    if (typeof d.revision === "number") revisionEnviada.current = d.revision;
    seq.current = d.seq ?? seq.current;
    setAtraso(null);
  }, [url]);

  return {
    estado,
    ultimo,
    recibidos,
    enviados,
    negados,
    error,
    atraso,
    traerDelRelevo,
    sincronizar: () => pedir.current(),
    pedir: pedirFirmadoAqui,
  };
}

/* ---------- alta y consultas sueltas ---------- */

/**
 * Canjea un código de alta por una credencial.
 *
 * El código lo canta el juez o se lee de un QR, sirve una sola vez y
 * caduca. Lo que vuelve —el token— se queda en este dispositivo y no se
 * vuelve a mandar nunca por la red.
 */
export async function darDeAlta(
  url: string,
  codigo: string,
  desdeAqui = false,
): Promise<{ ok: boolean; credencial?: Credencial; detalle: string }> {
  const base = limpiarUrl(url);
  if (!base) return { ok: false, detalle: "Falta la dirección del relevo." };
  if (!codigo.trim() && !desdeAqui) return { ok: false, detalle: "Falta el código." };
  try {
    const r = await fetch(`${base}/api/alta`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ codigo: codigo.trim().toUpperCase(), desdeAqui }),
    });
    const d = await r.json();
    if (!r.ok) return { ok: false, detalle: d.error ?? "El relevo no aceptó el código." };
    return {
      ok: true,
      credencial: { quien: d.quien, papel: d.papel, nombre: d.nombre, token: d.token, n: 0 },
      detalle: `Dado de alta como ${d.nombre}.`,
    };
  } catch {
    return { ok: false, detalle: "No respondió. Revisa que sea la misma red y la dirección." };
  }
}

type Pedir = Conexion["pedir"];

/** El juez pide un código para dar de alta a un árbitro. */
export async function pedirInvitacion(
  pedir: Pedir,
  quien: string,
  nombre: string,
): Promise<{ ok: boolean; codigo?: string; detalle: string }> {
  try {
    const r = await pedir("/api/invitacion", "POST", { quien, nombre, papel: "arbitro" });
    if (!r) return { ok: false, detalle: "Esta tablet todavía no está dada de alta en el relevo." };
    const d = await r.json();
    if (!r.ok) return { ok: false, detalle: d.error ?? "No se pudo pedir el código." };
    return { ok: true, codigo: d.codigo, detalle: `Código para ${nombre}: ${d.codigo}` };
  } catch {
    return { ok: false, detalle: "No se pudo hablar con el relevo." };
  }
}

export interface Dispositivo {
  quien: string;
  papel: string;
  nombre: string;
  alta: number;
  visto: number;
  peticiones: number;
}

export interface Rechazo {
  ts: number;
  motivo: string;
  detalle: string;
}

/** Quién está dado de alta y qué se ha rechazado. Solo lo ve el juez. */
export async function verAccesos(
  pedir: Pedir,
): Promise<{ ok: boolean; dispositivos: Dispositivo[]; rechazos: Rechazo[]; detalle: string }> {
  const vacio = { dispositivos: [], rechazos: [] };
  try {
    const r = await pedir("/api/acceso", "GET");
    if (!r) return { ok: false, ...vacio, detalle: "Esta tablet no está dada de alta." };
    const d = await r.json();
    if (!r.ok) return { ok: false, ...vacio, detalle: d.error ?? "No se pudo consultar." };
    return { ok: true, dispositivos: d.dispositivos ?? [], rechazos: d.rechazos ?? [], detalle: "" };
  } catch {
    return { ok: false, ...vacio, detalle: "No se pudo hablar con el relevo." };
  }
}

/** Comprueba que hay un relevo al otro lado antes de guardar la dirección. */
export async function probar(
  url: string,
): Promise<{
  ok: boolean;
  detalle: string;
  juezDadoDeAlta?: boolean;
  altaLocalDisponible?: boolean;
  /** Ahí contesta algo, pero no es un relevo: no vale la pena insistir. */
  ajeno?: boolean;
}> {
  const base = limpiarUrl(url);
  if (!base) return { ok: false, detalle: "Falta la dirección." };
  try {
    const r = await fetch(`${base}/api/salud`);
    if (!r.ok) return { ok: false, ajeno: true, detalle: `Respondió ${r.status}.` };
    let d: Record<string, unknown>;
    try {
      d = await r.json();
    } catch {
      return { ok: false, ajeno: true, detalle: "En esa dirección no hay un relevo de TTorneo." };
    }
    if (d.ok !== true) return { ok: false, ajeno: true, detalle: "En esa dirección no hay un relevo de TTorneo." };
    return {
      ok: true,
      juezDadoDeAlta: d.juezDadoDeAlta === true,
      altaLocalDisponible: d.altaLocalDisponible === true,
      detalle: `Relevo encontrado: ${d.eventos ?? 0} eventos, ${d.dispositivos ?? 0} dispositivos dados de alta.`,
    };
  } catch {
    return { ok: false, detalle: "No respondió. Revisa que sea la misma red y que el relevo esté corriendo." };
  }
}
