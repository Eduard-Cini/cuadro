import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  aplicarPaquete,
  armarCuadro,
  aplicarPropuesta,
  clasificar,
  estadisticas,
  partidoListo,
  propagar,
  pruebaPeticion,
  reducir,
  setsDe,
  sortear,
  sugerirAsignacion,
  unir,
} from "./nucleo";
import type { Credencial, Evento, Jugador, Lado, Partido, Torneo } from "./nucleo";

/**
 * Simulacro de torneo completo.
 *
 * Levanta un relevo de verdad, da de alta una mesa de control y cuatro
 * tablets de árbitro, y juega un torneo entero contra él: sorteo, fase de
 * grupos punto a punto, validaciones, reasignación de mesas y cuadro
 * eliminatorio. Por el camino provoca a propósito lo que va a pasar en el
 * gimnasio —se cae el Wi-Fi, se reinicia una tablet, se reenvían paquetes
 * repetidos— y lo que ojalá no pase: alguien intentando meter resultados
 * que no le tocan.
 *
 * Sirve para dos cosas distintas y las dos hacen falta:
 *
 *  · Como prueba, salta si una de estas propiedades se rompe al tocar el
 *    código, que es cuando los fallos de sincronización aparecen.
 *  · Como ensayo, se corre antes de la prueba de campo con el árbitro y
 *    deja un informe de lo que ocurrió. Es mucho más barato descubrir aquí
 *    que un marcador no converge que descubrirlo con doce jugadores
 *    esperando.
 *
 *     npm run simulacro
 */

const CUANTOS_ARBITROS = 4;
const CUANTOS_JUGADORES = 12;
const PUERTO = 8300 + Math.floor(Math.random() * 400);

const informe: string[] = [];
const anotar = (linea: string) => informe.push(linea);

/* ---------- una tablet ---------- */

/**
 * Un dispositivo del torneo.
 *
 * Usa exactamente las mismas funciones del núcleo que la aplicación real
 * —unir, paqueteDe, aplicarPaquete— para que lo que se comprueba aquí sea
 * el código que va a correr en el gimnasio y no una imitación.
 */
class Tablet {
  torneo: Torneo;
  cred: Credencial | null = null;
  seq = 0;
  revisionVista = -1;
  enRed = true;
  recibidos = 0;
  enviados = 0;
  rechazados = 0;
  motivos: string[] = [];
  /** Lo mismo que lleva la aplicación: qué confirmó ya el relevo. */
  resueltos = new Set<string>();
  revisionEnviada = -1;
  /** Para medir el tráfico: bytes subidos y eventos puestos en el cable. */
  bytesSubidos = 0;
  eventosMandados = 0;

  constructor(
    public nombre: string,
    torneo: Torneo,
  ) {
    this.torneo = torneo;
  }

  async firmado(ruta: string, metodo: "GET" | "POST", cuerpo?: unknown) {
    if (!this.cred) throw new Error(`${this.nombre} no está dada de alta`);
    const crudo = cuerpo === undefined ? "" : JSON.stringify(cuerpo);
    this.bytesSubidos += crudo.length;
    this.cred.n += 1;
    return fetch(`http://localhost:${PUERTO}${ruta}`, {
      method: metodo,
      headers: {
        "content-type": "application/json",
        "x-quien": this.cred.quien,
        "x-n": String(this.cred.n),
        "x-prueba": pruebaPeticion(this.cred.token, metodo, ruta, this.cred.n, crudo),
      },
      body: metodo === "POST" ? crudo : undefined,
    });
  }

  async darDeAlta(codigo: string) {
    const r = await fetch(`http://localhost:${PUERTO}/api/alta`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ codigo }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(`${this.nombre}: ${d.error}`);
    this.cred = { quien: d.quien, papel: d.papel, nombre: d.nombre, token: d.token, n: 0 };
    return this.cred;
  }

  async invitar(quien: string, nombre: string): Promise<string> {
    const r = await this.firmado("/api/invitacion", "POST", { quien, nombre, papel: "arbitro" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return d.codigo;
  }

  /** Sube lo suyo y baja lo de los demás. Igual que hace la aplicación. */
  async sincronizar() {
    if (!this.enRed) return;

    if (this.cred?.papel === "juez" && this.torneo.revision !== this.revisionEnviada) {
      // La estructura va sin marcadores: son dos cosas con ritmos muy
      // distintos y mandarlas juntas es lo que hacía crecer el tráfico.
      const ligero: Torneo = {
        ...this.torneo,
        partidos: this.torneo.partidos.map((p) => ({ ...p, eventos: [] })),
      };
      const r = await this.firmado("/api/estructura", "POST", { torneo: ligero });
      if (r.ok) this.revisionEnviada = this.torneo.revision;
    }

    if (this.cred) {
      const partidos = this.torneo.partidos
        .map((p) => ({ id: p.id, eventos: p.eventos.filter((ev) => !this.resueltos.has(ev.id)) }))
        .filter((x) => x.eventos.length);
      if (partidos.length) {
        this.eventosMandados += partidos.reduce((n, x) => n + x.eventos.length, 0);
        const r = await this.firmado("/api/paquete", "POST", {
          torneoId: this.torneo.id,
          revision: this.torneo.revision,
          desde: this.cred.quien,
          partidos,
        });
        const d = await r.json();
        for (const id of d.resueltos ?? []) this.resueltos.add(id);
        this.enviados += d.nuevos ?? 0;
        this.rechazados += d.negados ?? 0;
        for (const m of d.motivos ?? []) if (!this.motivos.includes(m)) this.motivos.push(m);
      }
    }

    const r = await fetch(
      `http://localhost:${PUERTO}/api/estado?seq=${this.seq}&revision=${this.revisionVista}`,
    );
    const d = await r.json();
    this.seq = d.seq ?? this.seq;
    if (d.estructura && this.cred?.papel !== "juez") {
      this.torneo = unir(this.torneo, d.estructura).torneo;
    }
    if (d.eventos?.length) {
      const antes = total(this.torneo);
      aplicarPaquete(this.torneo, {
        torneoId: this.torneo.id,
        revision: this.torneo.revision,
        desde: "relevo",
        partidos: d.eventos,
      });
      // Lo que viene del relevo, el relevo ya lo tiene: no hay que
      // devolvérselo en la vuelta siguiente.
      for (const x of d.eventos) for (const ev of x.eventos) this.resueltos.add(ev.id);
      this.recibidos += total(this.torneo) - antes;
    }
    if (typeof d.revision === "number") this.revisionVista = d.revision;
  }
}

const total = (t: Torneo): number => t.partidos.reduce((n, p) => n + p.eventos.length, 0);

/* ---------- generación de un partido ---------- */

let reloj = Date.now() - 3 * 60 * 60 * 1000;
let contador = 0;

const evento = (cuerpo: Record<string, unknown>, por: string): Evento =>
  ({ id: `sim-${contador++}`, ts: (reloj += 1500), por, ...cuerpo }) as unknown as Evento;

/**
 * Juega un partido entero, punto a punto, con su descanso entre sets.
 *
 * El azar decide quién gana cada punto con una ventaja fija para uno de
 * los dos, así que salen marcadores creíbles —11-6, 12-10, algún 3-11— en
 * vez de partidos siempre iguales.
 */
function jugarPartido(t: Torneo, p: Partido, quien: string, fuerza = 0.55): void {
  const setsPara = setsDe(t, p);
  p.eventos.push(evento({ t: "inicia", saque: "a", invertido: false }, quien));

  for (let set = 0; set < setsPara * 2 - 1; set++) {
    if (set > 0) p.eventos.push(evento({ t: "reanuda" }, quien));
    let a = 0;
    let b = 0;
    while (!((a >= 11 || b >= 11) && Math.abs(a - b) >= 2)) {
      const paraA = Math.random() < fuerza;
      p.eventos.push(evento({ t: "punto", j: (paraA ? "a" : "b") as Lado }, quien));
      if (paraA) a++;
      else b++;
    }
    const st = reducir(p, setsPara);
    if (st.terminado) break;
  }
  p.eventos.push(evento({ t: "cierra" }, quien));
}

/* ---------- resultado del simulacro ---------- */

interface Salida {
  juez: Tablet;
  arbitros: Tablet[];
  impostorColo: number;
  intrusoRechazado: boolean;
  fueraDeMesaRechazado: boolean;
  validacionRechazada: boolean;
  eventosTrasCorte: number;
  duplicadosColados: number;
  /** Eventos que se llegaron a mandar, contra los que existen. */
  puestosEnElCable: number;
  eventosEnJuego: number;
  rechazos: Array<{ motivo: string; detalle: string }>;
  propioTrasLiberar: boolean;
  /** Al abrir otra categoría, el relevo no arrastra la anterior. */
  cambioLimpio: boolean;
  eventosDelPrimero: number;
  eventosRecuperados: number;
  /** Al volver a una categoría guardada, el relevo la vuelve a servir. */
  volvioAlPrimero: boolean;
}

let salida: Salida;
let relevo: ChildProcess;
let carpeta: string;
const bitacoraRelevo: string[] = [];

/* ---------- puesta en marcha ---------- */

function arrancarRelevo(): Promise<string> {
  carpeta = mkdtempSync(join(tmpdir(), "cuadro-sim-"));
  relevo = spawn(
    process.execPath,
    ["servidor/relevo.mjs", "--puerto", String(PUERTO), "--datos", carpeta, "--nuevo-juez"],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );

  return new Promise((cumplir, fallar) => {
    let texto = "";
    const plazo = setTimeout(() => fallar(new Error("el relevo no arrancó a tiempo")), 15000);
    relevo.stdout?.on("data", (trozo) => {
      texto += String(trozo);
      for (const l of String(trozo).split(/\r?\n/)) if (l.includes("DIAG")) bitacoraRelevo.push(l.trim());
      const m = texto.match(/\|\s+([A-Z2-9]{6})\s+\|/);
      if (m) {
        clearTimeout(plazo);
        cumplir(m[1]);
      }
    });
    relevo.on("error", fallar);
  });
}

beforeAll(async () => {
  const codigoJuez = await arrancarRelevo();
  anotar(`Relevo levantado en el puerto ${PUERTO}.`);

  /* --- el juez monta el torneo --- */
  const jugadores: Jugador[] = Array.from({ length: CUANTOS_JUGADORES }, (_, i) => ({
    id: `j${i}`,
    nombre: `Jugador ${i + 1}`,
    club: `Club ${String.fromCharCode(65 + (i % 4))}`,
    rank: 1500 - i * 25,
  }));

  const base: Torneo = {
    id: "t-simulacro",
    revision: 1,
    nombre: "Simulacro",
    sede: "Pruebas",
    modalidad: "individual",
    mesas: CUANTOS_ARBITROS,
    formatoGrupos: 2,
    formatoFinales: 3,
    nGrupos: 4,
    clasifican: 2,
    descansoSet: 1,
    descansoJugador: 0,
    duracionTiempo: 60,
    duracionSupuesta: 20,
    validacionObligatoria: true,
    configurado: true,
    modoGuiado: false,
    pinJuez: "",
    semillaSorteo: 2026,
    actaSorteo: [],
    jugadores,
    arbitros: Array.from({ length: CUANTOS_ARBITROS }, (_, i) => ({
      id: `arb${i}`,
      nombre: `Árbitro ${i + 1}`,
      mesa: i + 1,
    })),
    grupos: [],
    partidos: [],
    relajaciones: [],
  };

  const sorteo = sortear(base.jugadores, base.nGrupos, { semilla: base.semillaSorteo });
  base.grupos = sorteo.grupos;
  base.partidos = sorteo.partidos;
  base.actaSorteo = sorteo.acta;
  base.revision = 2;

  const juez = new Tablet("Mesa de control", base);
  await juez.darDeAlta(codigoJuez);
  anotar(`Mesa de control dada de alta con el código que imprimió el relevo.`);

  /* --- alta de las tablets de árbitro --- */
  const arbitros: Tablet[] = [];
  for (let i = 0; i < CUANTOS_ARBITROS; i++) {
    const codigo = await juez.invitar(`arb${i}`, `Árbitro ${i + 1}`);
    const tab = new Tablet(`Árbitro ${i + 1}`, structuredClone(base));
    await tab.darDeAlta(codigo);
    arbitros.push(tab);
  }
  anotar(`${CUANTOS_ARBITROS} tablets de árbitro dadas de alta, cada una con su código de un solo uso.`);

  /* --- el juez reparte mesas y todos se sincronizan --- */
  const propuesta = sugerirAsignacion(juez.torneo, Date.now());
  aplicarPropuesta(juez.torneo, propuesta);
  juez.torneo.revision++;
  await juez.sincronizar();
  for (const a of arbitros) await a.sincronizar();
  anotar(`Primera ronda de mesas repartida: ${propuesta.asignaciones.length} partidos a la vez.`);

  /* --- se juega la fase de grupos, con el Wi-Fi cayéndose por medio --- */
  const RONDA_DEL_CORTE = 3;
  const idsDelCorte: string[] = [];
  let rondas = 0;
  let jugados = 0;

  while (rondas < 40) {
    rondas++;
    const hayCorte = rondas === RONDA_DEL_CORTE;
    const cortados = hayCorte ? arbitros.slice(0, 2) : [];
    for (const a of cortados) a.enRed = false;

    let algo = false;
    for (const tab of arbitros) {
      const yo = tab.cred!.quien;
      const mesa = tab.torneo.arbitros.find((x) => x.id === yo)?.mesa ?? 0;
      const mio = tab.torneo.partidos.find(
        (p) => p.mesa === mesa && p.aId && p.bId && p.etapa === "grupo" && !reducir(p, setsDe(tab.torneo, p)).terminado,
      );
      if (!mio) continue;
      const antes = mio.eventos.length;
      jugarPartido(tab.torneo, mio, yo, 0.45 + Math.random() * 0.2);
      // Lo anotado a oscuras se apunta aparte: es lo que tiene que
      // aparecer entero en la mesa de control cuando vuelva la red.
      if (!tab.enRed) for (const ev of mio.eventos.slice(antes)) idsDelCorte.push(ev.id);
      jugados++;
      algo = true;
      await tab.sincronizar();
    }
    if (!algo && !hayCorte) break;

    if (hayCorte) {
      anotar(`Ronda ${rondas}: se cae el Wi-Fi y dos árbitros anotan ${idsDelCorte.length} eventos a oscuras.`);
      for (const a of cortados) a.enRed = true;
      for (const a of cortados) await a.sincronizar();
    }

    /* El juez recoge, valida todo lo que llegó y vuelve a repartir. */
    await juez.sincronizar();
    for (const p of juez.torneo.partidos) {
      const st = reducir(p, setsDe(juez.torneo, p));
      if (st.fase === "por-validar") p.eventos.push(evento({ t: "valida" }, "juez"));
    }
    for (const p of juez.torneo.partidos) {
      const st = reducir(p, setsDe(juez.torneo, p));
      if (p.mesa && st.fase === "validado") p.mesa = 0;
    }
    const otra = sugerirAsignacion(juez.torneo, Date.now());
    aplicarPropuesta(juez.torneo, otra);
    juez.torneo.revision++;
    await juez.sincronizar();
    for (const a of arbitros) await a.sincronizar();
  }
  anotar(`Fase de grupos: ${jugados} partidos jugados punto a punto en ${rondas} rondas.`);

  /* Y una tablet se reinicia: pierde lo que llevaba pedido pero conserva
     su credencial, y tiene que ponerse al día desde cero. */
  const reiniciada = arbitros[2];
  reiniciada.seq = 0;
  reiniciada.revisionVista = -1;
  await reiniciada.sincronizar();
  anotar(`Una tablet se reinicia, vuelve a pedir el estado desde cero y se pone al día.`);

  const enElJuez = new Set(juez.torneo.partidos.flatMap((p) => p.eventos.map((e) => e.id)));
  const eventosTrasCorte = idsDelCorte.filter((id) => enElJuez.has(id)).length;

  /* --- se reenvía todo otra vez: no debe cambiar nada --- */
  const antesDeRepetir = total(juez.torneo);
  for (const a of arbitros) {
    a.seq = 0;
    await a.sincronizar();
    await a.sincronizar();
  }
  await juez.sincronizar();
  const duplicadosColados = total(juez.torneo) - antesDeRepetir;

  /* --- intentos que tienen que fallar --- */
  const victima = arbitros[0];
  const suMesa = victima.torneo.arbitros.find((x) => x.id === victima.cred!.quien)!.mesa;

  /* El escenario se monta a mano en vez de buscarlo entre lo que haya
     quedado: si dependiera de cómo cayó el sorteo, la comprobación pasaría
     unos días y otros no, que es la peor clase de prueba.

     El partido tiene que estar virgen. Uno que la víctima ya jugó se le
     permite a propósito —para que pueda terminar de subir lo suyo aunque
     le hayan liberado la mesa—, así que no serviría para comprobar esto. */
  const ajeno: Partido = {
    id: "p-ajeno",
    etapa: "grupo",
    aId: "j0",
    bId: "j1",
    mesa: suMesa === 1 ? 2 : 1,
    orden: 999,
    eventos: [],
  };
  juez.torneo.partidos.push(ajeno);
  juez.torneo.revision++;
  await juez.sincronizar();

  const rMesa = await fetchFirmado(victima, "/api/paquete", {
    torneoId: victima.torneo.id,
    partidos: [{ id: ajeno.id, eventos: [evento({ t: "punto", j: "a" }, victima.cred!.quien)] }],
  });
  const fueraDeMesaRechazado = rMesa.nuevos === 0 && rMesa.negados > 0;

  /* Y el caso contrario: un partido suyo al que el juez ya le quitó la
     mesa. Tiene que poder cerrarlo. */
  const suyo = juez.torneo.partidos.find(
    (p) => p.eventos.some((e) => e.por === victima.cred!.quien) && p.mesa === 0,
  );
  let propioTrasLiberar = true;
  if (suyo) {
    const r = await fetchFirmado(victima, "/api/paquete", {
      torneoId: victima.torneo.id,
      partidos: [{ id: suyo.id, eventos: [evento({ t: "punto", j: "a" }, victima.cred!.quien)] }],
    });
    propioTrasLiberar = r.nuevos === 1 && r.negados === 0;
  }

  const rVal = await fetchFirmado(victima, "/api/paquete", {
    torneoId: victima.torneo.id,
    partidos: [
      {
        id: victima.torneo.partidos[0].id,
        eventos: [evento({ t: "valida" }, victima.cred!.quien)],
      },
    ],
  });
  const validacionRechazada = rVal.nuevos === 0 && rVal.negados > 0;

  /* Alguien de la red sin credencial ninguna. Se marca su evento para
     poder buscarlo después por identificador: contar el total no vale,
     porque entre medias entran los legítimos de los demás. */
  const marcaIntruso = evento({ t: "punto", j: "b" }, "nadie");
  await fetch(`http://localhost:${PUERTO}/api/paquete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      torneoId: juez.torneo.id,
      partidos: [{ id: juez.torneo.partidos[0].id, eventos: [marcaIntruso] }],
    }),
  });
  const rIntruso = await fetch(`http://localhost:${PUERTO}/api/estructura`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ torneo: { ...juez.torneo, nombre: "Torneo secuestrado", revision: 9999 } }),
  });
  await juez.sincronizar();
  const impostorColo = juez.torneo.partidos.flatMap((p) => p.eventos).filter((e) => e.id === marcaIntruso.id).length;
  const intrusoRechazado = rIntruso.status === 401;
  anotar(`Intentos rechazados: sin credencial, fuera de su mesa, y validando sin ser el juez.`);

  /* --- eliminatoria --- */
  const fin = armarCuadro(
    juez.torneo.grupos,
    juez.torneo.partidos,
    juez.torneo.clasifican,
    juez.torneo.formatoGrupos,
    true,
  );
  juez.torneo.partidos = juez.torneo.partidos.filter((p) => p.etapa !== "final").concat(fin);
  juez.torneo.revision++;
  await juez.sincronizar();

  let rondasFinales = 0;
  while (rondasFinales < 10) {
    rondasFinales++;
    propagar(
      juez.torneo.partidos.filter((p) => p.etapa === "final"),
      juez.torneo.formatoFinales,
      true,
    );
    const libres = juez.torneo.partidos.filter(
      (p) => p.etapa === "final" && p.aId && p.bId && !reducir(p, juez.torneo.formatoFinales).terminado,
    );
    if (!libres.length) break;
    for (const p of libres) jugarPartido(juez.torneo, p, "juez");
    for (const p of libres) p.eventos.push(evento({ t: "valida" }, "juez"));
  }
  juez.torneo.revision++;
  await juez.sincronizar();
  anotar(`Eliminatoria completa en ${rondasFinales} rondas.`);

  const eventosEnJuego = total(juez.torneo);
  const puestosEnElCable = [juez, ...arbitros].reduce((n, t) => n + t.eventosMandados, 0);
  const kb = Math.round([juez, ...arbitros].reduce((n, t) => n + t.bytesSubidos, 0) / 1024);
  anotar(
    `Tráfico: ${puestosEnElCable} eventos puestos en el cable para ${eventosEnJuego} anotados ` +
      `(${(puestosEnElCable / eventosEnJuego).toFixed(2)} envíos por evento, ${kb} kB en total).`,
  );

  /*
   * Segunda categoría del día.
   *
   * El juez cierra el individual y abre el dobles: el relevo tiene que
   * guardar el primero entero antes de cargar el segundo, y devolverlo
   * igual cuando se vuelva a él. Es lo que separa «cambiar de categoría»
   * de «tirar la tarde de trabajo».
   */
  const eventosDelPrimero = total(juez.torneo);
  const primerTorneo = JSON.parse(JSON.stringify(juez.torneo)) as Torneo;

  // El dobles se trabaja un rato antes de volver al individual: su revisión
  // queda por encima de la que el individual tenía al guardarse.
  const dobles: Torneo = {
    ...base,
    id: "t-simulacro-dobles",
    revision: juez.torneo.revision + 20,
    nombre: "Simulacro · Dobles",
    modalidad: "dobles",
    jugadores: jugadores.slice(0, 4).map((j, i) => ({ ...j, nombre2: `Pareja ${i + 1}` })),
    grupos: [],
    partidos: [],
  };
  juez.torneo = dobles;
  juez.revisionEnviada = -1;
  await juez.firmado("/api/estructura", "POST", { torneo: dobles, reemplazar: true });

  const cuantos = (r: { eventos?: Array<{ id: string; eventos: unknown[] }> }) =>
    (r.eventos ?? []).reduce((n, x) => n + x.eventos.length, 0);

  const trasCambiar = await fetchFirmadoGet(juez, "/api/estado?seq=0&revision=-1");
  const cambioLimpio = trasCambiar.torneoId === dobles.id && cuantos(trasCambiar) === 0;

  // Y de vuelta al primero: el relevo lo tiene guardado en su carpeta. La
  // aplicación lo reabre desde su archivo con la revisión que tenía más
  // uno, que queda por debajo de la del dobles: el relevo tiene que
  // aceptarlo igual, porque cambiar de categoría lo pide el juez a
  // propósito y no es una copia vieja.
  juez.torneo = { ...primerTorneo, revision: primerTorneo.revision + 1 };
  juez.revisionEnviada = -1;
  await juez.firmado("/api/estructura", "POST", {
    torneo: { ...juez.torneo, partidos: juez.torneo.partidos.map((p) => ({ ...p, eventos: [] })) },
    reemplazar: true,
  });
  const trasVolver = await fetchFirmadoGet(juez, "/api/estado?seq=0&revision=-1");
  const eventosRecuperados = cuantos(trasVolver);
  const volvioAlPrimero = trasVolver.torneoId === primerTorneo.id && trasVolver.estructura?.id === primerTorneo.id;
  anotar(
    `Cambio de categoría: el relevo guardó los ${eventosDelPrimero} eventos del individual, ` +
      `abrió el dobles en limpio y devolvió ${eventosRecuperados} al volver.`,
  );

  const acc = await fetchFirmadoGet(juez, "/api/acceso");
  const rechazos: Array<{ motivo: string; detalle: string }> = acc.rechazos ?? [];

  salida = {
    juez,
    arbitros,
    cambioLimpio,
    eventosDelPrimero,
    eventosRecuperados,
    volvioAlPrimero,
    rechazos,
    puestosEnElCable,
    eventosEnJuego,
    impostorColo,
    intrusoRechazado,
    fueraDeMesaRechazado,
    validacionRechazada,
    eventosTrasCorte,
    duplicadosColados,
    propioTrasLiberar,
  };
}, 120_000);

/** GET firmado, para consultar el panel de accesos del relevo. */
async function fetchFirmadoGet(tab: Tablet, ruta: string) {
  tab.cred!.n += 1;
  const r = await fetch(`http://localhost:${PUERTO}${ruta}`, {
    headers: {
      "x-quien": tab.cred!.quien,
      "x-n": String(tab.cred!.n),
      "x-prueba": pruebaPeticion(tab.cred!.token, "GET", ruta, tab.cred!.n, ""),
    },
  });
  return r.json();
}

/** Petición firmada suelta, para los intentos que deben fallar. */
async function fetchFirmado(tab: Tablet, ruta: string, cuerpo: unknown) {
  const crudo = JSON.stringify(cuerpo);
  tab.cred!.n += 1;
  const r = await fetch(`http://localhost:${PUERTO}${ruta}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-quien": tab.cred!.quien,
      "x-n": String(tab.cred!.n),
      "x-prueba": pruebaPeticion(tab.cred!.token, "POST", ruta, tab.cred!.n, crudo),
    },
    body: crudo,
  });
  return r.json();
}

afterAll(() => {
  relevo?.kill();
  try {
    rmSync(carpeta, { recursive: true, force: true });
  } catch {
    /* da igual: es una carpeta temporal */
  }
  console.log("\n  ── SIMULACRO ──\n" + informe.map((l) => `  · ${l}`).join("\n") + "\n");
  if (bitacoraRelevo.length) {
    console.log("  ── DIAGNÓSTICO DEL RELEVO ──\n  " + bitacoraRelevo.slice(0, 10).join("\n  ") + "\n");
  }
});

/* ---------- lo que tiene que cumplirse ---------- */

describe("simulacro de torneo completo", () => {
  it("no se pierde ni un evento por el camino", () => {
    const { juez, arbitros } = salida;
    // Si algo se perdió, el relevo sabe por qué: se enseña antes de fallar.
    const motivos = new Map<string, number>();
    for (const r of salida.rechazos) motivos.set(r.motivo, (motivos.get(r.motivo) ?? 0) + 1);
    if (motivos.size) {
      anotar("Rechazos del relevo: " + [...motivos].map(([m, n]) => `${m} (${n})`).join("; "));
    }
    for (const tab of arbitros) {
      for (const p of tab.torneo.partidos) {
        if (!p.eventos.length) continue;
        const enElJuez = juez.torneo.partidos.find((x) => x.id === p.id);
        const suyos = new Set(p.eventos.map((e) => e.id));
        const alla = new Set((enElJuez?.eventos ?? []).map((e) => e.id));
        for (const id of suyos) expect(alla.has(id), `${tab.nombre} perdió ${id}`).toBe(true);
      }
    }
    anotar(`Ni un evento perdido: la mesa de control tiene los ${total(juez.torneo)} que se generaron.`);
  });

  it("el marcador es el mismo en la tablet del árbitro y en la mesa de control", () => {
    const { juez, arbitros } = salida;
    let comparados = 0;
    for (const tab of arbitros) {
      for (const p of tab.torneo.partidos) {
        if (!p.eventos.length) continue;
        const alla = juez.torneo.partidos.find((x) => x.id === p.id);
        if (!alla) continue;
        const aqui = reducir(p, setsDe(tab.torneo, p));
        const alli = reducir(alla, setsDe(juez.torneo, alla));
        expect(alli.sets, `${tab.nombre}, partido ${p.id}`).toEqual(aqui.sets);
        comparados++;
      }
    }
    expect(comparados).toBeGreaterThan(0);
    anotar(`Los ${comparados} marcadores comparados coinciden en las dos copias.`);
  });

  it("reenviar lo mismo no duplica nada", () => {
    expect(salida.duplicadosColados).toBe(0);
    anotar("Reenviar los paquetes enteros dos veces no añadió un solo evento.");
  });

  it("lo anotado sin red llega entero cuando vuelve", () => {
    expect(salida.eventosTrasCorte).toBeGreaterThan(0);
    anotar(`Los ${salida.eventosTrasCorte} eventos del corte de red entraron al reconectar.`);
  });

  it("un árbitro no puede escribir en un partido de la mesa de otro", () => {
    expect(salida.fueraDeMesaRechazado).toBe(true);
  });

  it("pero sí puede terminar de subir el partido que venía llevando", () => {
    // Aunque el juez ya le haya liberado la mesa al validarlo: si no, los
    // últimos puntos de un partido cerrado sin red se perderían.
    expect(salida.propioTrasLiberar).toBe(true);
  });

  it("un árbitro no puede validar resultados", () => {
    expect(salida.validacionRechazada).toBe(true);
  });

  it("sin credencial no se escribe nada, ni un punto ni el torneo entero", () => {
    expect(salida.impostorColo).toBe(0);
    expect(salida.intrusoRechazado).toBe(true);
    anotar("Ningún intento sin credencial dejó rastro en el torneo.");
  });

  it("cada evento se manda una vez y no una vez por vuelta", () => {
    const { puestosEnElCable, eventosEnJuego } = salida;
    // Con reenvío ciego esta relación crece con el número de vueltas de
    // sincronización; mandando solo lo pendiente se queda pegada a uno.
    // El margen cubre lo que se reintenta tras el corte de red.
    expect(puestosEnElCable / eventosEnJuego).toBeLessThan(1.2);
  });

  it("las tablas de grupo cuadran con los partidos validados", () => {
    const { juez } = salida;
    const t = juez.torneo;
    for (const g of t.grupos) {
      const suyos = t.partidos.filter((p) => p.grupoId === g.id);
      const validados = suyos.filter((p) => partidoListo(p, t.formatoGrupos, true)).length;
      const m = estadisticas(g.jugadores, suyos, t.formatoGrupos, true);
      const sumaPJ = g.jugadores.reduce((n, id) => n + m[id].pj, 0);
      // Cada partido validado suma un partido jugado a cada uno de los dos.
      expect(sumaPJ).toBe(validados * 2);
      expect(clasificar(g.jugadores, suyos, t.formatoGrupos, true)).toHaveLength(g.jugadores.length);
    }
    anotar(`Las ${t.grupos.length} tablas de grupo cuadran con los partidos validados.`);
  });

  it("cambiar de categoría no arrastra la anterior ni la pierde", () => {
    const { cambioLimpio, eventosDelPrimero, eventosRecuperados, volvioAlPrimero } = salida;
    // Al abrir el dobles, el relevo empieza en blanco: si arrastrara los
    // eventos del individual, aparecerían puntos en partidos que no son.
    expect(cambioLimpio).toBe(true);
    // Y al volver, están todos otra vez: cambiar de categoría es guardar,
    // no tirar.
    expect(eventosRecuperados).toBe(eventosDelPrimero);
    // Y lo que sirve es el individual otra vez, no el dobles con los
    // puntos del individual debajo.
    expect(volvioAlPrimero).toBe(true);
  });

  it("el cuadro llega a una final con un campeón", () => {
    const { juez } = salida;
    const finales = juez.torneo.partidos.filter((p) => p.etapa === "final");
    expect(finales.length).toBeGreaterThan(0);
    const ultima = Math.max(...finales.map((p) => p.ronda ?? 0));
    const final = finales.find((p) => p.ronda === ultima)!;
    const st = reducir(final, juez.torneo.formatoFinales);
    expect(st.terminado).toBe(true);
    const campeon = juez.torneo.jugadores.find((j) => j.id === (st.ganador === "a" ? final.aId : final.bId));
    expect(campeon).toBeDefined();
    anotar(`Campeón del simulacro: ${campeon?.nombre}.`);
  });

  it("la mesa de control se recupera desde la computadora del relevo y la anterior deja de valer", async () => {
    // Va al final porque deja fuera a la mesa de control del simulacro.
    const { juez } = salida;
    const salud = await (await fetch(`http://localhost:${PUERTO}/api/salud`)).json();
    // El relevo ofrece entrar sin código aunque ya haya una mesa de control.
    expect(salud.juezDadoDeAlta).toBe(true);
    expect(salud.altaLocalDisponible).toBe(true);

    const r = await fetch(`http://localhost:${PUERTO}/api/alta`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ desdeAqui: true }),
    });
    const nueva = await r.json();
    expect(r.ok).toBe(true);
    expect(nueva.papel).toBe("juez");
    expect(nueva.token).not.toBe(juez.cred!.token);

    // La credencial vieja ya no firma nada.
    const vieja = await fetchFirmadoGet(juez, "/api/acceso");
    expect(vieja.error).toBeTruthy();
    anotar("La mesa de control se recuperó sin código desde la computadora del relevo, y la anterior quedó fuera.");
  });
});
