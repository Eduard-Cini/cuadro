#!/usr/bin/env node
/**
 * Relevo de TTorneo: la pieza que junta las tablets sin internet.
 *
 * Corre en la computadora conectada a la pantalla del gimnasio. Hace tres
 * cosas a la vez:
 *
 *   1. Sirve la aplicación. Las tablets entran a http://<ip>:8080 y cargan
 *      TTorneo sin salir a internet, porque el archivo está aquí.
 *   2. Hace de buzón entre el juez y los árbitros.
 *   3. Controla quién puede escribir qué.
 *
 * De tenis de mesa no sabe nada: no conoce el reglamento, no calcula
 * marcadores y no decide quién gana. Guarda una estructura con su número
 * de revisión y un conjunto de eventos con identificador, y los reparte.
 * Toda la lógica vive en el núcleo, que está probado; si el relevo se cae,
 * cada tablet sigue funcionando sola con su copia y al volver se ponen al
 * día. Que el buzón sea tonto es lo que hace que el torneo no dependa de
 * que esta computadora siga encendida.
 *
 * Lo único que sí sabe es de permisos, y eso no se puede delegar en los
 * clientes: un permiso que comprueba quien pide es un permiso que no
 * existe.
 *
 *   node servidor/relevo.mjs [--puerto 8080] [--datos datos] [--nuevo-juez]
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";

const AQUI = resolve(fileURLToPath(import.meta.url), "..", "..");

/* ---------- argumentos ---------- */

const args = process.argv.slice(2);
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : porDefecto;
};
const bandera = (nombre) => args.includes(`--${nombre}`);

const PUERTO = Number(opcion("puerto", process.env.PORT ?? 8080));
const CARPETA = resolve(AQUI, opcion("datos", "datos"));
const ESTATICO = resolve(AQUI, opcion("sitio", "dist"));
const RESPALDO = join(CARPETA, "torneo.json");
const ACCESOS = join(CARPETA, "accesos.json");
const RED = join(CARPETA, "red.json");

/*
 * La dirección de la computadora en la red puede cambiar de un día a otro:
 * la asigna el router. Cada teléfono guarda su alta según la dirección con
 * la que entró, así que con una dirección nueva hay que volver a repartir
 * los códigos. El relevo recuerda la de la vez anterior y, si cambió, se lo
 * dice al juez hasta que confirme que ya los repartió.
 */
let cambioDireccion = null;

function guardarRed(ahora) {
  try {
    mkdirSync(CARPETA, { recursive: true });
    writeFileSync(RED, JSON.stringify({ direccion: ahora, anterior: cambioDireccion?.antes ?? null, pendiente: !!cambioDireccion }));
  } catch {
    /* sin disco no hay aviso, pero el torneo sigue */
  }
}

function revisarDireccion(ahora) {
  if (!ahora) return;
  let previo = null;
  try {
    previo = JSON.parse(readFileSync(RED, "utf8"));
  } catch {
    /* primera vez en esta carpeta */
  }
  if (previo?.pendiente && previo.anterior) cambioDireccion = { antes: previo.anterior, ahora };
  else if (previo?.direccion && previo.direccion !== ahora) cambioDireccion = { antes: previo.direccion, ahora };
  // Si volvió a la de antes, no hay nada que repartir.
  if (cambioDireccion && cambioDireccion.antes === ahora) cambioDireccion = null;
  guardarRed(ahora);
}

/**
 * Dónde se guarda una categoría que no está abierta.
 *
 * Una jornada tiene varias —individual, dobles, mixtos— y el relevo lleva
 * una a la vez: la que están viendo las tablets. Al cambiar de categoría,
 * la anterior se guarda aquí con todos sus eventos en vez de borrarse, y
 * vuelve entera si se abre otra vez. Sin esto, cambiar de categoría sería
 * tirar a la basura lo jugado en la anterior.
 */
const archivoDe = (id) => join(CARPETA, `torneo-${String(id).replace(/[^\w.-]+/g, "_")}.json`);

/* ---------- criptografía ---------- */

/*
 * En Node se usa la biblioteca estándar. En el navegador no se puede:
 * `crypto.subtle` solo existe en contextos seguros y el relevo sirve por
 * HTTP en una dirección de red local, así que del otro lado corre la
 * implementación de `src/nucleo/firma.ts`. Las dos calculan el mismo
 * HMAC-SHA-256 porque el algoritmo está fijado por norma, y las pruebas
 * del núcleo lo comprueban contra los vectores del RFC 4231.
 */
const sha256Hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const hmacHex = (clave, mensaje) => createHmac("sha256", clave).update(mensaje, "utf8").digest("hex");

const ALFABETO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
/** Código corto para cantarlo en voz alta sin que se confunda ningún carácter. */
const codigoLegible = (largo = 6) =>
  Array.from(randomBytes(largo), (b) => ALFABETO[b % ALFABETO.length]).join("");
const tokenNuevo = () => randomBytes(24).toString("hex");

function igualSeguro(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/** La misma cuenta que hace el cliente antes de mandar la petición. */
const pruebaPeticion = (token, metodo, ruta, n, cuerpo) =>
  hmacHex(token, `${metodo}\n${ruta}\n${n}\n${sha256Hex(cuerpo)}`);

/* ---------- estado del torneo ---------- */

/**
 * `seq` numera cada evento que entra. Una tablet que vuelve de un apagón
 * pide «lo que haya después del 812» y recibe solo eso, en vez del torneo
 * entero: en una red de gimnasio esa diferencia es la que decide si el
 * sistema aguanta o no.
 */
const estado = {
  torneoId: "",
  revision: 0,
  estructura: null,
  seq: 0,
  /** partidoId → Map(eventoId → evento) */
  eventos: new Map(),
  /** diario ordenado: [{ seq, partidoId, evento }] */
  diario: [],
};

/* ---------- estado de acceso ---------- */

const acceso = {
  /** quien → { token, papel, nombre, n, alta, visto } */
  credenciales: new Map(),
  /** código → { quien, papel, nombre, caduca } */
  invitaciones: new Map(),
  /** Código de un solo uso para dar de alta al juez. */
  codigoJuez: "",
  /** Lo que se ha rechazado, para que el juez lo vea. */
  rechazos: [],
};

const MINUTO = 60_000;
const VIDA_INVITACION = 15 * MINUTO;

function anotarRechazo(motivo, detalle) {
  acceso.rechazos.unshift({ ts: Date.now(), motivo, detalle });
  acceso.rechazos.length = Math.min(acceso.rechazos.length, 50);
  console.log(`  ✗ rechazado: ${motivo} — ${detalle}`);
}

const oyentes = new Set();

/* ---------- persistencia ---------- */

function cargarRespaldo() {
  if (existsSync(RESPALDO)) {
    try {
      const d = JSON.parse(readFileSync(RESPALDO, "utf8"));
      estado.torneoId = d.torneoId ?? "";
      estado.revision = d.revision ?? 0;
      estado.estructura = d.estructura ?? null;
      for (const [pid, lista] of Object.entries(d.eventos ?? {})) {
        const m = new Map();
        for (const ev of lista) {
          m.set(ev.id, ev);
          estado.diario.push({ seq: ++estado.seq, partidoId: pid, evento: ev });
        }
        estado.eventos.set(pid, m);
      }
      console.log(`  Respaldo recuperado: ${estado.diario.length} eventos, revisión ${estado.revision}.`);
    } catch (e) {
      console.error("  No se pudo leer el respaldo:", e.message);
    }
  }

  // Las altas sobreviven a un reinicio: si el relevo se reinicia a media
  // jornada, nadie tiene que volver a darse de alta con el juez.
  if (existsSync(ACCESOS) && !bandera("nuevo-juez")) {
    try {
      const d = JSON.parse(readFileSync(ACCESOS, "utf8"));
      for (const c of d.credenciales ?? []) acceso.credenciales.set(c.quien, c);
      console.log(`  Altas recuperadas: ${acceso.credenciales.size} dispositivos.`);
    } catch (e) {
      console.error("  No se pudieron leer las altas:", e.message);
    }
  }
}

/** Deja la categoría abierta guardada aparte, antes de cambiar a otra. */
function guardarCategoria() {
  if (!estado.torneoId) return;
  try {
    mkdirSync(CARPETA, { recursive: true });
    const eventos = {};
    for (const [pid, m] of estado.eventos) eventos[pid] = [...m.values()];
    writeFileSync(
      archivoDe(estado.torneoId),
      JSON.stringify({
        torneoId: estado.torneoId,
        revision: estado.revision,
        estructura: estado.estructura,
        eventos,
      }),
    );
    console.log(`  Categoría «${estado.estructura?.nombre || estado.torneoId}» guardada aparte.`);
  } catch (e) {
    console.error("  No se pudo guardar la categoría:", e.message);
  }
}

/** Vuelve a meter los eventos de una categoría que ya se había jugado. */
function recuperarCategoria(id) {
  const f = archivoDe(id);
  if (!existsSync(f)) return;
  try {
    const d = JSON.parse(readFileSync(f, "utf8"));
    for (const [pid, lista] of Object.entries(d.eventos ?? {})) {
      const m = new Map();
      for (const ev of lista) {
        m.set(ev.id, ev);
        estado.diario.push({ seq: ++estado.seq, partidoId: pid, evento: ev });
      }
      estado.eventos.set(pid, m);
    }
    console.log(`  Categoría recuperada del archivo: ${estado.diario.length} eventos.`);
  } catch (e) {
    console.error("  No se pudo recuperar la categoría:", e.message);
  }
}

let pendiente = null;
let ultimaEscritura = 0;
/**
 * Escribe a disco: lo primero al instante, y las ráfagas, agrupadas.
 *
 * Antes todo esperaba un segundo, y cerrar la ventana en ese segundo
 * dejaba lo último fuera del disco. Ahora un cambio que llega tras un rato
 * de calma —un punto, un alta, una estructura— se escribe en el momento, y
 * solo los que llegan pegados se juntan en una escritura un segundo
 * después: con seis tablets anotando a la vez no se reescribe el archivo
 * cien veces por segundo.
 */
function respaldar() {
  if (pendiente) return;
  const espera = 1000 - (Date.now() - ultimaEscritura);
  if (espera <= 0) escribirRespaldo();
  else pendiente = setTimeout(escribirRespaldo, espera);
}

/*
 * Al cerrarse, lo que esté esperando su segundo se escribe ya.
 *
 * Cerrar la ventana negra, Ctrl+C o «Terminar el torneo» paraban el
 * proceso con la última escritura pendiente: hasta un segundo de puntos
 * quedaba solo en las tablets. Ellas lo vuelven a mandar al reconectar,
 * pero el respaldo del disco no debería depender de eso.
 */
function guardarYSalir(codigo = 0) {
  if (pendiente) escribirRespaldo();
  process.exit(codigo);
}
for (const senal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  try {
    process.on(senal, () => guardarYSalir(0));
  } catch {
    /* esa señal no existe en este sistema */
  }
}

function escribirRespaldo() {
  if (pendiente) clearTimeout(pendiente);
  ultimaEscritura = Date.now();
  {
    pendiente = null;
    try {
      mkdirSync(CARPETA, { recursive: true });
      const eventos = {};
      for (const [pid, m] of estado.eventos) eventos[pid] = [...m.values()];
      writeFileSync(
        RESPALDO,
        JSON.stringify({
          torneoId: estado.torneoId,
          revision: estado.revision,
          estructura: estado.estructura,
          eventos,
        }),
      );
      writeFileSync(ACCESOS, JSON.stringify({ credenciales: [...acceso.credenciales.values()] }));
    } catch (e) {
      console.error("  No se pudo respaldar:", e.message);
    }
  }
}

function avisar() {
  const linea = `data: ${JSON.stringify({ seq: estado.seq, revision: estado.revision })}\n\n`;
  for (const res of oyentes) {
    try {
      res.write(linea);
    } catch {
      oyentes.delete(res);
    }
  }
}

/* ---------- permisos ---------- */

/**
 * ¿La petición viene de esta misma computadora?
 *
 * Quien está sentado delante de la máquina que corre el relevo es quien lo
 * arrancó, y ya tiene el código de la mesa de control impreso en la
 * ventana. Pedírselo otra vez no protege de nada y sí añade el paso donde
 * más gente se atasca: teclear seis letras para poder empezar.
 *
 * No vale para los árbitros: ellos entran desde otro aparato, por la red,
 * y a esos sí se les pide su código.
 */
const esDeAqui = (req) => {
  const dir = String(req.socket.remoteAddress ?? "");
  return dir === "::1" || dir === "127.0.0.1" || dir === "::ffff:127.0.0.1";
};

const TIPOS_DE_ARBITRO = new Set(["inicia", "punto", "anula", "reanuda", "cierra", "tiempo", "tarjeta", "resultado"]);
const TIPOS_DE_JUEZ = new Set(["valida", "corrige", "elige"]);

/**
 * Comprueba que quien manda esto es quien dice ser.
 *
 * No se compara ningún token: el cliente manda una prueba de que lo conoce
 * y aquí se rehace la misma cuenta. Por la red no viaja nunca el secreto,
 * que es lo que permite trabajar sobre HTTP sin regalarle las credenciales
 * a cualquiera que escuche el Wi-Fi del gimnasio.
 *
 * El contador tiene que crecer siempre. Sin eso, una petición capturada se
 * podría repetir tal cual para colar el mismo punto dos veces.
 */
function identificar(req, ruta, crudo) {
  const quien = req.headers["x-quien"];
  const n = Number(req.headers["x-n"]);
  const prueba = req.headers["x-prueba"];
  if (!quien || !prueba || !Number.isFinite(n)) return { error: "falta la credencial" };

  const cred = acceso.credenciales.get(String(quien));
  if (!cred) return { error: "esa credencial no está dada de alta" };
  if (n <= cred.n) return { error: "petición repetida o fuera de orden" };

  const esperado = pruebaPeticion(cred.token, req.method, ruta, n, crudo);
  if (!igualSeguro(esperado, String(prueba))) return { error: "la prueba no cuadra" };

  cred.n = n;
  cred.visto = Date.now();
  return { cred };
}

/** La mesa que la estructura del torneo le asigna a este árbitro. */
function mesaDe(quien) {
  const arb = estado.estructura?.arbitros?.find((a) => a.id === quien);
  return arb?.mesa ?? 0;
}

/**
 * ¿Este árbitro ya venía llevando este partido?
 *
 * Hace falta porque la mesa de un partido no es para siempre: en cuanto el
 * juez valida el resultado, la libera para que entre el siguiente. Si el
 * permiso dependiera solo de la mesa actual, un árbitro que cerró su
 * partido con la red caída volvería a encontrarse con que ya no puede
 * subir los últimos puntos —la mesa ya no es suya— y ese marcador se
 * perdería sin que nadie se enterara.
 *
 * Tener eventos propios en el partido es la prueba de que era suyo. No
 * abre ningún hueco: para tener el primero hay que haber estado asignado.
 */
function loVeniaLlevando(partidoId, quien) {
  const m = estado.eventos.get(partidoId);
  if (!m) return false;
  for (const ev of m.values()) if (ev.por === quien) return true;
  return false;
}

/**
 * Qué eventos puede meter esta credencial y cuáles no.
 *
 * Las dos reglas que pidió el reglamento de la casa:
 *   · un árbitro solo escribe en los partidos de *su* mesa;
 *   · aceptar, registrar y corregir es cosa del juez principal y de nadie
 *     más.
 *
 * Lo que no se puede impedir desde aquí, y conviene tener claro: un
 * árbitro con credencial válida puede anotar mal su propio partido. Contra
 * eso no hay criptografía, hay un juez mirando y un botón de corregir.
 */
function filtrar(cred, partidos) {
  const admitidos = [];
  const negados = [];
  const miMesa = cred.papel === "arbitro" ? mesaDe(cred.quien) : 0;

  for (const entrada of partidos ?? []) {
    const { id, eventos } = entrada ?? {};
    if (!id || !Array.isArray(eventos)) continue;

    const partido = estado.estructura?.partidos?.find((p) => p.id === id);
    const buenos = [];

    for (const ev of eventos) {
      if (!ev || typeof ev.id !== "string" || typeof ev.t !== "string") continue;

      if (cred.papel === "pantalla") {
        negados.push({ id, ev: ev.id, motivo: "la pantalla no escribe" });
        continue;
      }
      if (cred.papel === "arbitro") {
        if (TIPOS_DE_JUEZ.has(ev.t)) {
          negados.push({ id, ev: ev.id, motivo: `«${ev.t}» solo lo puede hacer el juez` });
          continue;
        }
        if (!TIPOS_DE_ARBITRO.has(ev.t)) {
          negados.push({ id, ev: ev.id, motivo: `evento desconocido: «${ev.t}»` });
          continue;
        }
        if (partido && partido.mesa !== miMesa && !loVeniaLlevando(id, cred.quien)) {
          negados.push({ id, ev: ev.id, motivo: `la mesa ${partido.mesa} no es la suya (${miMesa})` });
          continue;
        }
        if (!partido) {
          negados.push({ id, ev: ev.id, motivo: "ese partido no existe en el torneo" });
          continue;
        }
      }
      // Quien firma la petición es quien queda como autor. Un evento que
      // dice venir de otro se rechaza en vez de reescribirse, para que las
      // dos copias del registro no acaben diciendo cosas distintas.
      //
      // La excepción es el juez reenviando lo que le entregó una mesa
      // autogestionada en un archivo: son hechos de juego de otro aparato,
      // y se guardan con su autor de origen para que el acta diga quién los
      // anotó. Validar y corregir siguen siendo solo suyos.
      const reenvio = cred.papel === "juez" && TIPOS_DE_ARBITRO.has(ev.t);
      if (ev.por && ev.por !== cred.quien && !reenvio) {
        negados.push({ id, ev: ev.id, motivo: `dice venir de «${ev.por}» y no de «${cred.quien}»` });
        continue;
      }
      buenos.push(ev);
    }
    if (buenos.length) admitidos.push({ id, eventos: buenos });
  }
  return { admitidos, negados };
}

/**
 * Mete eventos nuevos. Repetir el mismo paquete no cambia nada.
 *
 * Devuelve también qué identificadores quedaron guardados, incluidos los
 * que ya estaban: el cliente necesita saber qué puede dejar de mandar, y
 * un evento que ya está aquí es tan definitivo como uno recién llegado.
 */
function absorber(partidos) {
  let nuevos = 0;
  const guardados = [];
  for (const entrada of partidos ?? []) {
    const { id, eventos } = entrada ?? {};
    if (!id || !Array.isArray(eventos)) continue;
    let m = estado.eventos.get(id);
    if (!m) estado.eventos.set(id, (m = new Map()));
    for (const ev of eventos) {
      if (!ev || typeof ev.id !== "string") continue;
      guardados.push(ev.id);
      if (m.has(ev.id)) continue;
      m.set(ev.id, ev);
      estado.diario.push({ seq: ++estado.seq, partidoId: id, evento: ev });
      nuevos++;
    }
  }
  if (nuevos) {
    respaldar();
    avisar();
  }
  return { nuevos, guardados };
}

/* ---------- utilidades http ---------- */

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const responder = (res, codigo, cuerpo) => {
  res.writeHead(codigo, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(cuerpo));
};

/**
 * Lee el cuerpo entero y lo decodifica una sola vez, al final.
 *
 * Concatenar los trozos como texto —`datos += trozo`— parece equivalente y
 * no lo es: cada trozo se decodifica por su cuenta, y un carácter de dos
 * bytes que quede partido entre dos paquetes TCP se convierte en dos
 * caracteres de reemplazo. El cuerpo cambia, su resumen deja de coincidir
 * con el que calculó quien lo mandó, y la petición se rechaza por firma
 * inválida.
 *
 * El fallo depende de dónde caiga la frontera del paquete, así que aparece
 * de forma intermitente y solo con acentos o eñes: es decir, en cualquier
 * torneo con nombres en español y nunca en las pruebas hechas en inglés.
 *
 * El texto crudo hace falta tal cual porque la prueba de identidad se
 * calcula sobre él; volver a serializar el objeto daría otra cadena.
 */
function leerCuerpo(req, limite = 8 * 1024 * 1024) {
  return new Promise((cumplir, fallar) => {
    const trozos = [];
    let bytes = 0;
    req.on("data", (trozo) => {
      trozos.push(trozo);
      bytes += trozo.length;
      if (bytes > limite) {
        fallar(new Error("cuerpo demasiado grande"));
        req.destroy();
      }
    });
    req.on("end", () => {
      const crudo = Buffer.concat(trozos).toString("utf8");
      try {
        cumplir({ crudo, datos: crudo ? JSON.parse(crudo) : {} });
      } catch {
        fallar(new Error("json inválido"));
      }
    });
    req.on("error", fallar);
  });
}

function agrupar(cambios) {
  const m = new Map();
  for (const x of cambios) {
    if (!m.has(x.partidoId)) m.set(x.partidoId, []);
    m.get(x.partidoId).push(x.evento);
  }
  return [...m.entries()].map(([id, eventos]) => ({ id, eventos }));
}

/* ---------- rutas ---------- */

async function api(req, res, url) {
  const ruta = url.pathname;

  /* --- lectura: abierta --- */
  /*
   * Mirar el torneo no se protege a propósito. Lo que hay dentro está
   * proyectado en la pared del gimnasio, y pedir credenciales para leer
   * obligaría a dar de alta también la pantalla y a cualquier teléfono que
   * quiera consultar los horarios. Se protege quién escribe, no quién
   * mira.
   */
  if (ruta === "/api/estado" && req.method === "GET") {
    const desdeSeq = Number(url.searchParams.get("seq") ?? 0);
    const revisionCliente = Number(url.searchParams.get("revision") ?? -1);
    const cambios = estado.diario.filter((x) => x.seq > desdeSeq);
    return responder(res, 200, {
      seq: estado.seq,
      revision: estado.revision,
      torneoId: estado.torneoId,
      estructura: revisionCliente < estado.revision ? estado.estructura : null,
      eventos: agrupar(cambios),
    });
  }

  if (ruta === "/api/salud") {
    return responder(res, 200, {
      ok: true,
      // La dirección con la que otros aparatos pueden llegar aquí. Hace
      // falta porque la página de reparto, servida en la computadora del
      // juez, se ve a sí misma como «localhost», y un código QR que diga
      // localhost manda al teléfono a su propio aparato.
      direcciones: direcciones(),
      puerto: PUERTO,
      torneoId: estado.torneoId,
      revision: estado.revision,
      seq: estado.seq,
      eventos: estado.diario.length,
      conectados: oyentes.size,
      dispositivos: acceso.credenciales.size,
      juezDadoDeAlta: acceso.credenciales.has("juez"),
      // La aplicación lo usa para entrar sin teclear. Vale siempre que la
      // petición venga de esta misma computadora: si ya hay una mesa de
      // control dada de alta, entrar otra vez la sustituye, y la aplicación
      // lo pregunta antes.
      altaLocalDisponible: esDeAqui(req),
      // Mientras el juez no confirme que volvió a repartir los códigos.
      cambioDireccion,
    });
  }

  /* --- alta: con código de un solo uso --- */
  if (ruta === "/api/alta" && req.method === "POST") {
    const { datos } = await leerCuerpo(req);
    const codigo = String(datos.codigo ?? "").trim().toUpperCase();

    /*
     * Desde la propia computadora, la mesa de control entra sin teclear.
     *
     * También cuando ya había una: es la salida para quien perdió su
     * credencial —borró los datos del navegador, pulsó «Salir de la red»,
     * cambió de navegador— y de otro modo tendría que reiniciar el relevo
     * desde una terminal a media jornada. No abre ningún hueco: quien está
     * delante de esta máquina ya puede cerrar el relevo y arrancarlo con
     * --nuevo-juez. La credencial anterior deja de valer en ese momento.
     */
    if (!codigo && datos.desdeAqui && esDeAqui(req)) {
      const habia = acceso.credenciales.has("juez");
      acceso.codigoJuez = "";
      const cred = {
        quien: "juez",
        papel: "juez",
        nombre: "Juez principal",
        token: tokenNuevo(),
        n: 0,
        alta: Date.now(),
        visto: Date.now(),
      };
      acceso.credenciales.set(cred.quien, cred);
      respaldar();
      console.log(
        habia
          ? "  ✓ alta: mesa de control recuperada desde esta misma computadora (la anterior deja de valer)"
          : "  ✓ alta: mesa de control, desde esta misma computadora",
      );
      return responder(res, 200, { quien: cred.quien, papel: cred.papel, nombre: cred.nombre, token: cred.token });
    }

    if (!codigo) return responder(res, 400, { error: "falta el código" });

    let ficha = null;
    if (acceso.codigoJuez && igualSeguro(codigo, acceso.codigoJuez)) {
      ficha = { quien: "juez", papel: "juez", nombre: "Juez principal" };
      acceso.codigoJuez = "";
    } else {
      const inv = acceso.invitaciones.get(codigo);
      if (inv && inv.caduca > Date.now()) {
        ficha = { quien: inv.quien, papel: inv.papel, nombre: inv.nombre };
        acceso.invitaciones.delete(codigo);
      }
    }

    if (!ficha) {
      anotarRechazo("código de alta inválido", `«${codigo}» desde ${req.socket.remoteAddress}`);
      return responder(res, 403, { error: "ese código no vale o ya se usó" });
    }

    const cred = { ...ficha, token: tokenNuevo(), n: 0, alta: Date.now(), visto: Date.now() };
    acceso.credenciales.set(cred.quien, cred);
    respaldar();
    console.log(`  ✓ alta: ${cred.nombre} (${cred.papel})`);
    return responder(res, 200, { quien: cred.quien, papel: cred.papel, nombre: cred.nombre, token: cred.token });
  }

  /* --- de aquí en adelante hay que identificarse --- */
  const { crudo, datos } = req.method === "POST" ? await leerCuerpo(req) : { crudo: "", datos: {} };
  const { cred, error } = identificar(req, ruta, crudo);
  if (error) {
    anotarRechazo(error, `${req.method} ${ruta} desde ${req.socket.remoteAddress}`);
    return responder(res, 401, { error });
  }

  if (ruta === "/api/invitacion" && req.method === "POST") {
    if (cred.papel !== "juez") return responder(res, 403, { error: "solo el juez da de alta a los demás" });
    const quien = String(datos.quien ?? "").trim();
    const papel = datos.papel === "pantalla" ? "pantalla" : "arbitro";
    if (!quien) return responder(res, 400, { error: "falta a quién se invita" });

    // Una invitación por persona: pedir otra anula la anterior.
    for (const [c, inv] of acceso.invitaciones) if (inv.quien === quien) acceso.invitaciones.delete(c);
    const codigo = codigoLegible();
    acceso.invitaciones.set(codigo, {
      quien,
      papel,
      nombre: String(datos.nombre ?? quien),
      caduca: Date.now() + VIDA_INVITACION,
    });
    return responder(res, 200, { codigo, caduca: Date.now() + VIDA_INVITACION });
  }

  if (ruta === "/api/estructura" && req.method === "POST") {
    if (cred.papel !== "juez") {
      anotarRechazo("intento de cambiar el torneo sin ser el juez", `${cred.nombre} (${cred.papel})`);
      return responder(res, 403, { error: "el torneo lo lleva el juez" });
    }
    const t = datos.torneo;
    if (!t || typeof t.revision !== "number") return responder(res, 400, { error: "falta el torneo" });
    if (estado.torneoId && t.id !== estado.torneoId && !datos.reemplazar) {
      return responder(res, 409, { error: "el relevo tiene otro torneo cargado", torneoId: estado.torneoId });
    }
    if (t.id !== estado.torneoId) {
      guardarCategoria();
      estado.eventos.clear();
      estado.diario.length = 0;
      estado.seq = 0;
      recuperarCategoria(t.id);
      // Cambiar de categoría lo pide el juez a propósito, así que la que
      // llega se sirve aunque su revisión sea menor que la de la anterior:
      // las revisiones de dos torneos distintos no se comparan entre sí.
      estado.revision = -1;
    }
    if (t.revision >= estado.revision) {
      estado.torneoId = t.id;
      estado.revision = t.revision;
      estado.estructura = t;
      absorber((t.partidos ?? []).map((p) => ({ id: p.id, eventos: p.eventos ?? [] })));
      respaldar();
      avisar();
    }
    // `atrasada` avisa de que lo que mandó el juez no entró porque aquí hay
    // una revisión más alta del mismo torneo. Callarlo dejaba a la mesa de
    // control «en red» y trabajando sobre algo que nadie más veía.
    return responder(res, 200, { revision: estado.revision, seq: estado.seq, atrasada: t.revision < estado.revision });
  }

  if (ruta === "/api/paquete" && req.method === "POST") {
    if (estado.torneoId && datos.torneoId && datos.torneoId !== estado.torneoId) {
      return responder(res, 409, { error: "ese paquete es de otro torneo", torneoId: estado.torneoId });
    }
    const { admitidos, negados } = filtrar(cred, datos.partidos);
    for (const x of negados) anotarRechazo(x.motivo, `${cred.nombre} → partido ${x.id}`);
    const { nuevos, guardados } = absorber(admitidos);
    return responder(res, 200, {
      seq: estado.seq,
      revision: estado.revision,
      nuevos,
      // Guardados y rechazados juntos son todo lo que el cliente mandó, y
      // de ninguno de los dos tiene que volver a saber nada.
      resueltos: [...guardados, ...negados.map((x) => x.ev)],
      negados: negados.length,
      motivos: [...new Set(negados.map((x) => x.motivo))],
    });
  }

  /*
   * Apagar el relevo desde la aplicación.
   *
   * Cerrar la ventana negra también sirve, pero hay que saber cuál de las
   * ventanas abiertas es, y a media jornada eso no está claro. Con esto se
   * termina desde donde se estaba trabajando.
   *
   * Solo el juez, y se responde antes de apagar: si el proceso muriera
   * primero, la aplicación se quedaría esperando una respuesta que nunca
   * llega y diría que falló algo que sí funcionó.
   */
  if (ruta === "/api/apagar" && req.method === "POST") {
    if (cred.papel !== "juez") return responder(res, 403, { error: "solo el juez cierra el torneo" });
    responder(res, 200, { ok: true });
    console.log("");
    console.log("  El juez ha cerrado el torneo desde la aplicacion.");
    console.log("  Los datos quedan guardados en " + CARPETA);
    console.log("  Ya puedes cerrar esta ventana.");
    console.log("");
    setTimeout(() => guardarYSalir(0), 300);
    return;
  }

  if (ruta === "/api/direccion-vista" && req.method === "POST") {
    if (cred.papel !== "juez") return responder(res, 403, { error: "solo el juez" });
    cambioDireccion = null;
    guardarRed(direcciones()[0]);
    return responder(res, 200, { ok: true });
  }

  if (ruta === "/api/acceso" && req.method === "GET") {
    if (cred.papel !== "juez") return responder(res, 403, { error: "solo el juez" });
    return responder(res, 200, {
      dispositivos: [...acceso.credenciales.values()].map((c) => ({
        quien: c.quien,
        papel: c.papel,
        nombre: c.nombre,
        alta: c.alta,
        visto: c.visto,
        peticiones: c.n,
      })),
      invitaciones: [...acceso.invitaciones.entries()].map(([codigo, i]) => ({ codigo, ...i })),
      rechazos: acceso.rechazos.slice(0, 20),
    });
  }

  responder(res, 404, { error: "no existe" });
}

/** El flujo de avisos va aparte: es GET y no lleva cuerpo que leer. */
function flujo(req, res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ seq: estado.seq, revision: estado.revision })}\n\n`);
  oyentes.add(res);
  // Latido: sin esto, un punto de acceso doméstico corta la conexión por
  // inactividad y el árbitro deja de recibir sin enterarse de nada.
  const latido = setInterval(() => {
    try {
      res.write(": latido\n\n");
    } catch {
      /* la limpieza la hace el cierre */
    }
  }, 20000);
  req.on("close", () => {
    clearInterval(latido);
    oyentes.delete(res);
  });
}

function estatico(req, res, url) {
  if (!existsSync(ESTATICO)) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(
      `<meta charset="utf-8"><title>TTorneo</title>` +
        `<p style="font:16px system-ui;padding:2rem;max-width:34rem">` +
        `El relevo está funcionando, pero no encuentra la aplicación compilada en <code>${ESTATICO}</code>.` +
        ` Corre <code>npm run build:relevo</code> y vuelve a arrancarlo.</p>`,
    );
  }

  const pedido = decodeURIComponent(url.pathname);
  const limpio = normalize(pedido).replace(/^(\.\.[/\\])+/, "");
  let archivo = join(ESTATICO, limpio);
  if (!archivo.startsWith(ESTATICO) || !existsSync(archivo) || pedido.endsWith("/")) {
    archivo = join(ESTATICO, "index.html");
  }
  if (!existsSync(archivo)) return responder(res, 404, { error: "no existe" });

  const tipo = TIPOS[extname(archivo)] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": tipo, "cache-control": "no-cache" });
  createReadStream(archivo).pipe(res);
}

/* ---------- arranque ---------- */

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, x-quien, x-n, x-prueba");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  try {
    if (url.pathname === "/api/flujo") return flujo(req, res);
    if (url.pathname === "/descargar/TTorneo.zip") return descargarPaquete(res);
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    estatico(req, res, url);
  } catch (e) {
    responder(res, 400, { error: e.message });
  }
});

function direcciones() {
  const out = [];
  for (const [nombre, lista] of Object.entries(networkInterfaces())) {
    for (const i of lista ?? []) if (i.family === "IPv4" && !i.internal) out.push({ ip: i.address, nombre });
  }
  // La primera es la que va en el QR, así que tiene que ser la del Wi-Fi.
  // Windows no las da en ningún orden útil: delante pueden ir la de una VPN
  // o una 169.254, que es la que se pone sola un adaptador sin red.
  return out.sort((a, b) => prioridad(a) - prioridad(b)).map((x) => x.ip);
}

function prioridad({ ip, nombre }) {
  if (ip.startsWith("169.254.")) return 9;
  if (/vEthernet|WSL|Hyper-V|VirtualBox|VMware|Tailscale|ZeroTier|Docker/i.test(nombre)) return 5;
  if (ip.startsWith("192.168.")) return 0;
  if (ip.startsWith("10.") || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 1;
  return 3;
}

/*
 * Un error al abrir el puerto no puede salir como un volcado de Node.
 *
 * Quien arranca esto es el juez del torneo, no un programador: si ve
 * «EADDRINUSE» con veinte líneas de rastro de pila, la jornada se para
 * ahí. Los dos casos que ocurren de verdad tienen explicación corta.
 */
servidor.on("error", (e) => {
  console.log("");
  if (e.code === "EADDRINUSE") {
    console.log(`  No se pudo empezar: el puerto ${PUERTO} ya esta ocupado.`);
    console.log("");
    console.log("  Casi siempre es que ya hay otro torneo abierto en esta");
    console.log("  computadora. Busca la otra ventana negra y cierrala, o");
    console.log("  arranca este con otro puerto:");
    console.log("");
    console.log(`      node servidor/relevo.mjs --puerto ${PUERTO + 1}`);
  } else if (e.code === "EACCES") {
    console.log(`  No se pudo empezar: el sistema no deja usar el puerto ${PUERTO}.`);
    console.log("  Prueba con uno por encima de 1024, por ejemplo 8080.");
  } else {
    console.log(`  No se pudo empezar: ${e.message}`);
  }
  console.log("");
  process.exit(1);
});

/* ---------- el paquete para llevarse TTorneo ---------- */

/*
 * TTorneo.zip: todo lo que hace falta para montar un torneo en otra
 * computadora, sin compilar nada ni instalar dependencias. Lleva la
 * aplicación ya compilada, este mismo archivo, el lanzador y unas
 * instrucciones. Del otro lado basta con tener Node.js.
 *
 * El ZIP se arma aquí, a mano, para que el relevo siga siendo un solo
 * archivo sin dependencias. Es el formato más sencillo que entiende
 * cualquier sistema: cada archivo comprimido con deflate y un índice al
 * final.
 */
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function armarZip(entradas) {
  const ahora = new Date();
  const fecha = ((ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate();
  const hora = (ahora.getHours() << 11) | (ahora.getMinutes() << 5) | Math.floor(ahora.getSeconds() / 2);
  const partes = [];
  const indice = [];
  let lugar = 0;
  for (const e of entradas) {
    const nombre = Buffer.from(e.nombre, "utf8");
    const comprimido = deflateRawSync(e.datos);
    const conviene = comprimido.length < e.datos.length;
    const cuerpo = conviene ? comprimido : e.datos;
    const metodo = conviene ? 8 : 0;
    const crc = crc32(e.datos);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(fecha, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(cuerpo.length, 18);
    local.writeUInt32LE(e.datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    partes.push(local, nombre, cuerpo);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(metodo, 10);
    cen.writeUInt16LE(hora, 12);
    cen.writeUInt16LE(fecha, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(cuerpo.length, 20);
    cen.writeUInt32LE(e.datos.length, 24);
    cen.writeUInt16LE(nombre.length, 28);
    cen.writeUInt32LE(lugar, 42);
    indice.push(cen, nombre);
    lugar += local.length + nombre.length + cuerpo.length;
  }
  const tamIndice = indice.reduce((n, b) => n + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(tamIndice, 12);
  fin.writeUInt32LE(lugar, 16);
  return Buffer.concat([...partes, ...indice, fin]);
}

const LEEME = [
  "TTorneo - gestor de torneos de tenis de mesa sin conexion",
  "",
  "Para montar un torneo en esta computadora:",
  "",
  "1. Instala Node.js, gratis, desde https://nodejs.org (elige la version LTS).",
  "   Solo hace falta la primera vez.",
  "2. Doble clic en \"Iniciar torneo.bat\". Se abre el navegador ya como",
  "   mesa de control.",
  "3. Los telefonos de los arbitros entran escaneando el codigo QR de",
  "   Red > Abrir la pagina de reparto. Tienen que estar en el mismo Wi-Fi",
  "   que esta computadora; no hace falta internet.",
  "4. Deja abierta la ventana negra mientras se juega. Al cerrarla se",
  "   termina el torneo; lo jugado queda guardado en la carpeta \"datos\".",
  "",
  "Si la mesa de control se pierde (otro navegador, datos borrados), abre",
  "TTorneo en esta misma computadora y pulsa \"Recuperar la mesa de control",
  "aqui\".",
  "",
].join("\r\n");

let paqueteHecho = null;

/** Los archivos del paquete, con la ruta que llevan dentro del ZIP. */
function entradasDelPaquete() {
  if (!existsSync(join(ESTATICO, "index.html"))) {
    throw new Error("la aplicacion no esta compilada (npm run build:relevo)");
  }
  const out = [];
  const recorrer = (dir) => {
    for (const n of readdirSync(dir)) {
      const ruta = join(dir, n);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else out.push({ nombre: `TTorneo/dist/${relative(ESTATICO, ruta).split("\\").join("/")}`, datos: readFileSync(ruta) });
    }
  };
  recorrer(ESTATICO);
  out.push({ nombre: "TTorneo/servidor/relevo.mjs", datos: readFileSync(fileURLToPath(import.meta.url)) });
  const lanzador = join(AQUI, "Iniciar torneo.bat");
  if (existsSync(lanzador)) out.push({ nombre: "TTorneo/Iniciar torneo.bat", datos: readFileSync(lanzador) });
  const ventana = join(AQUI, "servidor", "relevo.bat");
  if (existsSync(ventana)) out.push({ nombre: "TTorneo/servidor/relevo.bat", datos: readFileSync(ventana) });
  out.push({ nombre: "TTorneo/LEEME.txt", datos: Buffer.from(LEEME, "utf8") });
  return out;
}

function descargarPaquete(res) {
  try {
    paqueteHecho ??= armarZip(entradasDelPaquete());
  } catch (e) {
    return responder(res, 500, { error: `No se pudo armar el paquete: ${e.message}` });
  }
  res.writeHead(200, {
    "content-type": "application/zip",
    "content-disposition": 'attachment; filename="TTorneo.zip"',
    "content-length": paqueteHecho.length,
    "cache-control": "no-store",
  });
  res.end(paqueteHecho);
}

/* `node servidor/relevo.mjs --empaquetar ruta.zip` escribe el paquete y sale,
   sin arrancar el relevo. Es lo que usa `npm run paquete`. */
const destinoPaquete = opcion("empaquetar", "");
if (destinoPaquete) {
  try {
    const salida = resolve(process.cwd(), destinoPaquete);
    mkdirSync(dirname(salida), { recursive: true });
    const zip = armarZip(entradasDelPaquete());
    writeFileSync(salida, zip);
    console.log(`  Paquete listo: ${salida} (${Math.round(zip.length / 1024)} kB)`);
    process.exit(0);
  } catch (e) {
    console.error(`  No se pudo armar el paquete: ${e.message}`);
    process.exit(1);
  }
}

cargarRespaldo();
if (!acceso.credenciales.has("juez") || bandera("nuevo-juez")) {
  acceso.credenciales.delete("juez");
  acceso.codigoJuez = codigoLegible();
}

/*
 * Que no se cierre la ventana por accidente.
 *
 * Cerrar la ventana del relevo no borra nada, pero deja a las tablets sin
 * mesa de control hasta que alguien la vuelva a abrir. El lanzador abre el
 * relevo en una consola clásica de Windows, y aquí se le quita el botón de
 * cerrar: para terminar quedan Ctrl+C o «Terminar el torneo» en la mesa de
 * control. En Windows Terminal esto no tiene efecto (ahí la ventana es de
 * otro programa), y por eso el lanzador no lo usa.
 */
function protegerVentana() {
  if (process.platform !== "win32" || !bandera("proteger-ventana")) return;
  const ps =
    "Add-Type -Namespace TT -Name V -MemberDefinition '" +
    '[DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow();' +
    '[DllImport("user32.dll")] public static extern System.IntPtr GetSystemMenu(System.IntPtr h, bool r);' +
    '[DllImport("user32.dll")] public static extern bool DeleteMenu(System.IntPtr m, uint p, uint f);' +
    '[DllImport("user32.dll")] public static extern bool DrawMenuBar(System.IntPtr h);' +
    "'; $h = [TT.V]::GetConsoleWindow(); if ($h -ne [System.IntPtr]::Zero) { " +
    "$m = [TT.V]::GetSystemMenu($h, $false); [void][TT.V]::DeleteMenu($m, 0xF060, 0); [void][TT.V]::DrawMenuBar($h) }";
  try {
    const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore" });
    p.on("error", () => {});
  } catch {
    /* sin PowerShell queda solo el aviso escrito */
  }
}

/* El lanzador pide abrir el navegador cuando el relevo ya escucha, y no
   antes: si se abre antes, encuentra la puerta cerrada. */
function abrirNavegador() {
  if (process.platform !== "win32" || !bandera("abrir")) return;
  try {
    const p = spawn("cmd.exe", ["/c", "start", "", `http://localhost:${PUERTO}/`], { stdio: "ignore", detached: true });
    p.on("error", () => {});
    p.unref();
  } catch {
    /* que abran el navegador a mano */
  }
}

servidor.listen(PUERTO, () => {
  const ips = direcciones();
  revisarDireccion(ips[0]);
  protegerVentana();
  // Marco en ASCII a propósito: las consolas de Windows no siempre están
  // en UTF-8, y un banner con caracteres de caja aparece destrozado justo
  // en la máquina del gimnasio, que es donde nadie va a arreglarlo.
  console.log("\n  ==================================================");
  console.log("    TTORNEO - relevo de torneo");
  console.log("  ==================================================\n");
  console.log(`  Aplicación:  ${existsSync(ESTATICO) ? ESTATICO : "sin compilar (npm run build:relevo)"}`);
  console.log(`  Respaldo:    ${RESPALDO}\n`);
  console.log("  En las tablets, abre:");
  if (!ips.length) console.log(`    http://localhost:${PUERTO}   (esta máquina no está en ninguna red)`);
  for (const ip of ips) console.log(`    http://${ip}:${PUERTO}`);
  console.log(`\n  Para repartirlo:  http://${ips[0] ?? "localhost"}:${PUERTO}/entrar`);

  if (acceso.codigoJuez) {
    console.log("\n  +----------------------------------+");
    console.log("  |   CODIGO DE LA MESA DE CONTROL   |");
    console.log(`  |             ${acceso.codigoJuez}             |`);
    console.log("  +----------------------------------+");
    console.log("  Escríbelo en la tablet del juez. Sirve una sola vez.");
    console.log("  Desde ahí se dan de alta los árbitros, cada uno con su código.");
  } else {
    console.log("\n  Mesa de control ya dada de alta.");
    console.log(`  Si se perdió: abre http://localhost:${PUERTO} en esta computadora, elige`);
    console.log("  «Mesa de control» y pulsa «Recuperar la mesa de control aquí».");
  }
  if (cambioDireccion) {
    console.log("\n  !! LA DIRECCION DE ESTA COMPUTADORA CAMBIO");
    console.log(`     Antes: ${cambioDireccion.antes}   Ahora: ${cambioDireccion.ahora}`);
    console.log("     Los telefonos que ya estaban dados de alta tienen que volver a");
    console.log("     escanear su codigo QR. La mesa de control lo avisa y los genera.");
  }
  console.log("\n  Los resultados solo los acepta de un árbitro dado de alta y");
  console.log("  para su propia mesa. Validar y corregir, solo el juez.");
  console.log("\n  ##################################################");
  console.log("  ##   NO CIERRES ESTA VENTANA MIENTRAS SE JUEGA   ##");
  console.log("  ##################################################");
  console.log("  Si se cierra no se pierde nada, pero las tablets se quedan sin");
  console.log("  mesa de control hasta que vuelvas a abrir Iniciar torneo.");
  console.log("  Para terminar: en la mesa de control, Red > Terminar el torneo,");
  console.log("  o aqui mismo con Ctrl+C.\n");
  abrirNavegador();
});
