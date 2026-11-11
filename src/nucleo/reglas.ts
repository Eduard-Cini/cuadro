import type { EstadoPartido, Evento, Fase, Lado, Partido } from "./tipos";

/** Todos los sets se juegan a 11 con dos de diferencia. */
export const PUNTOS_SET = 11;

/**
 * Orden canónico del registro de eventos.
 *
 * Dos dispositivos que unan los mismos eventos tienen que leerlos en el
 * mismo orden, o llegarían a marcadores distintos. El reloj de pared
 * ordena bien dentro de un partido —los puntos los captura un solo
 * árbitro, en una sola tablet— y el identificador rompe los empates de
 * forma estable cuando dos relojes distintos coinciden al milisegundo.
 */
export const ordenar = (eventos: Evento[]): Evento[] =>
  [...eventos].sort((x, y) => x.ts - y.ts || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

/** Identificadores de eventos anulados por un deshacer. */
function anulados(eventos: Evento[]): Set<string> {
  const s = new Set<string>();
  for (const ev of eventos) if (ev.t === "anula") s.add(ev.ref);
  return s;
}

/**
 * Recorre los eventos del partido y devuelve el estado.
 *
 * Es una función pura: mismos eventos, mismo resultado, sin importar en
 * qué dispositivo se ejecute. De ahí salen tres cosas de golpe: deshacer
 * es agregar un evento de anulación, sincronizar es unir dos listas, y el
 * tablero se puede recargar a media final sin perder nada.
 *
 * Reglas implementadas, pendientes de confirmación del árbitro (A2, A6):
 *  - El set se gana con 11 puntos y dos de ventaja. En un torneo
 *    personalizado la meta puede ser otra y viene escrita en el partido.
 *  - El saque cambia cada dos puntos; desde 10-10, cada punto.
 *  - En cada juego posterior saca primero quien recibió en el anterior.
 *  - Al cerrar un set el partido queda en descanso hasta que el árbitro
 *    reanuda: el siguiente set no ha empezado, y 0–0 sería mentira.
 *  - Cada lado tiene un tiempo muerto por partido.
 *  - Los puntos de penalización de una tarjeta son puntos normales: se
 *    los apunta el contrario y pueden cerrar el set o el partido.
 *  - La tarjeta roja descalifica: el partido se le da al otro lado,
 *    completándole los sets que le faltaban, que es como se anota un
 *    partido perdido en la mesa.
 */
export function reducir(p: Partido, setsPara: number, meta = p.meta ?? PUNTOS_SET): EstadoPartido {
  const eventos = ordenar(p.eventos);
  const muertos = anulados(eventos);

  // Hándicap: el lado con ventaja arranca cada set con esos puntos. Nunca
  // tantos que el set se gane sin jugar.
  const extra = Math.max(0, Math.min(meta - 2, Math.floor(p.ventaja?.puntos ?? 0)));
  const va = p.ventaja?.lado === "a" ? extra : 0;
  const vb = p.ventaja?.lado === "b" ? extra : 0;

  const sets = { a: 0, b: 0 };
  let pa = va;
  let pb = vb;
  let juego = 1;
  let primero: Lado = "a";
  let invertido = false;
  let iniciado = false;
  let historial: Array<{ a: number; b: number }> = [];
  let enDescanso = false;
  let descansoDesde: number | null = null;
  let cerrado = false;
  let validado = false;
  let correccion: EstadoPartido["correccion"] = null;
  let porSets: EstadoPartido["porSets"] = null;
  let setsEscritos: Array<{ a: number; b: number }> = [];
  let desde: number | null = null;
  let hasta: number | null = null;
  let jugados = 0;
  let puntosDelSet: Lado[] = [];
  const tiempoGastado = { a: false, b: false };
  let tiempoDesde: number | null = null;
  let tiempoLado: Lado | null = null;
  const tarjetas: EstadoPartido["tarjetas"] = [];
  let descalificado: Lado | null = null;

  const gana = (x: number, y: number) => x >= meta && x - y >= 2;
  const completo = () => sets.a >= setsPara || sets.b >= setsPara;

  /**
   * Apunta un punto para un lado y cierra el set si toca.
   *
   * Lo usan tanto los puntos jugados como los de penalización de una
   * tarjeta: un punto de castigo cuenta igual que uno ganado en la mesa,
   * y puede cerrar el set o el partido.
   */
  const sumar = (j: Lado, ts: number) => {
    if (j === "a") pa++;
    else pb++;
    puntosDelSet.push(j);

    if (gana(pa, pb) || gana(pb, pa)) {
      sets[pa > pb ? "a" : "b"]++;
      historial.push({ a: pa, b: pb });
      pa = va;
      pb = vb;
      puntosDelSet = [];
      juego++;
      primero = primero === "a" ? "b" : "a";
      if (!completo()) {
        enDescanso = true;
        descansoDesde = ts;
      }
    }
  };

  for (const ev of eventos) {
    if (muertos.has(ev.id)) continue;

    switch (ev.t) {
      case "inicia":
        // Vale el último: el árbitro puede corregir el sorteo del saque
        // o girar la pantalla antes de que empiece a contar.
        primero = ev.saque;
        invertido = ev.invertido;
        iniciado = true;
        if (desde === null) desde = ev.ts;
        break;

      case "reanuda":
        enDescanso = false;
        tiempoDesde = null;
        tiempoLado = null;
        hasta = ev.ts;
        break;

      case "cierra":
        cerrado = true;
        hasta = ev.ts;
        break;

      case "valida":
        validado = true;
        break;

      case "corrige":
        correccion = { por: ev.por, nota: ev.nota, ts: ev.ts };
        historial = ev.sets.map((s) => ({ ...s }));
        break;

      case "resultado":
        // Vale el último que se escribió. Si el juez corrige, manda él.
        porSets = { por: ev.por, nota: ev.nota, ts: ev.ts };
        setsEscritos = ev.sets.map((s) => ({ ...s }));
        hasta = ev.ts;
        break;

      case "punto": {
        // Anotar implica que el descanso se acabó, aunque el árbitro no
        // haya tocado «Reanudar»: manda lo que pasa en la mesa.
        enDescanso = false;
        descansoDesde = null;
        // Y también que el tiempo muerto terminó: se volvió a jugar.
        tiempoDesde = null;
        tiempoLado = null;
        jugados++;
        if (desde === null) desde = ev.ts;
        hasta = ev.ts;
        sumar(ev.j, ev.ts);
        break;
      }

      case "tiempo":
        // El reglamento da uno por lado. Pedirlo dos veces no lo devuelve.
        tiempoGastado[ev.lado] = true;
        tiempoDesde = ev.ts;
        tiempoLado = ev.lado;
        hasta = ev.ts;
        break;

      case "tarjeta": {
        tarjetas.push({
          lado: ev.lado,
          color: ev.color,
          puntos: ev.puntos,
          motivo: ev.motivo,
          ts: ev.ts,
          por: ev.por,
        });
        hasta = ev.ts;
        const contrario: Lado = ev.lado === "a" ? "b" : "a";
        for (let i = 0; i < ev.puntos && !completo(); i++) sumar(contrario, ev.ts);
        if (ev.color === "roja") descalificado = ev.lado;
        break;
      }

      case "anula":
        hasta = ev.ts;
        break;
    }
  }

  /*
   * La roja se lleva el partido.
   *
   * Al descalificado se le da por perdido, y al otro se le completan los
   * sets que le faltaban: así el resultado se lee y se suma como
   * cualquier otro, sin inventar un caso especial en la tabla del grupo
   * ni en el cuadro. Lo que pasó queda escrito en la tarjeta.
   */
  if (descalificado && !completo()) {
    const gana2: Lado = descalificado === "a" ? "b" : "a";
    if (pa + pb > va + vb) historial.push({ a: pa, b: pb });
    while (sets[gana2] < setsPara) {
      sets[gana2]++;
      historial.push(gana2 === "a" ? { a: meta, b: 0 } : { a: 0, b: meta });
    }
    pa = 0;
    pb = 0;
    puntosDelSet = [];
    enDescanso = false;
    descansoDesde = null;
    tiempoDesde = null;
    tiempoLado = null;
  }

  // Los parciales escritos a mano mandan sobre los puntos y cierran el
  // partido: quien los escribe da el resultado por terminado.
  if (porSets && !correccion) {
    historial = setsEscritos;
    cerrado = true;
  }

  // La corrección del juez manda sobre lo que digan los puntos. El
  // registro de puntos no se toca: queda debajo, para poder auditar.
  if (correccion || porSets) {
    sets.a = historial.filter((s) => s.a > s.b).length;
    sets.b = historial.filter((s) => s.b > s.a).length;
    pa = 0;
    pb = 0;
    puntosDelSet = [];
    juego = historial.length + 1;
    enDescanso = false;
    descansoDesde = null;
  }

  const terminado = sets.a >= setsPara || sets.b >= setsPara;
  const ganador: Lado | null = sets.a >= setsPara ? "a" : sets.b >= setsPara ? "b" : null;

  // El saque se cuenta con los puntos jugados, no con los de ventaja.
  const total = pa + pb - va - vb;
  const deuce = pa >= meta - 1 && pb >= meta - 1;
  const base = (meta - 1) * 2 - va - vb;
  const turnos = deuce ? Math.floor(base / 2) + (total - base) : Math.floor(total / 2);
  const saca: Lado = turnos % 2 === 0 ? primero : primero === "a" ? "b" : "a";

  const fase: Fase =
    (terminado || cerrado) && validado
      ? "validado"
      : terminado || cerrado
        ? "por-validar"
        : enDescanso
          ? "descanso"
          : iniciado || jugados
            ? "en-juego"
            : "sin-iniciar";

  return {
    sets,
    pa,
    pb,
    juego,
    saca,
    historial,
    terminado,
    ganador,
    deuce,
    fase,
    invertido,
    descansoDesde: enDescanso ? descansoDesde : null,
    corregido: correccion !== null,
    correccion,
    porSets: correccion ? null : porSets,
    ventaja: { a: va, b: vb },
    desde,
    hasta,
    jugados,
    puntosDelSet,
    tiempoGastado,
    tiempoDesde,
    tiempoLado,
    tarjetas,
    descalificado,
  };
}

/**
 * ¿Este resultado ya puede entrar en la tabla?
 *
 * Con validación obligatoria, el partido cuenta cuando el juez lo acepta,
 * no cuando el árbitro termina de anotarlo. Es la diferencia entre lo que
 * pasó en la mesa y lo que el torneo da por oficial.
 */
export function partidoListo(p: Partido, setsPara: number, exigirValidacion = false): boolean {
  if (!p.aId || !p.bId) return false;
  const st = reducir(p, setsPara);
  if (!st.terminado) return false;
  return exigirValidacion ? st.fase === "validado" : true;
}

export function ganadorDe(p: Partido, setsPara: number, exigirValidacion = false): string | null {
  if (!partidoListo(p, setsPara, exigirValidacion)) return null;
  const st = reducir(p, setsPara);
  return st.ganador === "a" ? p.aId : p.bId;
}

/**
 * ¿Estos parciales son un partido terminado y posible?
 *
 * Devuelve el motivo si no lo son. Quien escribe un resultado a mano se
 * equivoca de las maneras de siempre —un 11-10, un set de más, un partido
 * al que le falta uno—, y es mejor decírselo en la mesa que dejar que lo
 * descubra el juez días después.
 */
export function revisarParciales(sets: Array<{ a: number; b: number }>, setsPara: number, meta = PUNTOS_SET): string | null {
  if (!sets.length) return "Falta escribir los sets.";
  const ganados = { a: 0, b: 0 };
  for (let i = 0; i < sets.length; i++) {
    const { a, b } = sets[i];
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return `El set ${i + 1} tiene un número que no vale.`;
    if (ganados.a >= setsPara || ganados.b >= setsPara) return `El partido ya estaba decidido antes del set ${i + 1}.`;
    const alto = Math.max(a, b);
    const dif = Math.abs(a - b);
    if (alto < meta || dif < 2) return `El set ${i + 1} no está terminado: alguien tiene que llegar a ${meta} con dos de ventaja.`;
    if (alto > meta && dif !== 2) return `El set ${i + 1} no puede quedar ${a}-${b}: después de ${meta - 1} iguales se gana por dos exactos.`;
    ganados[a > b ? "a" : "b"]++;
  }
  if (ganados.a < setsPara && ganados.b < setsPara)
    return `Faltan sets: al mejor de ${setsPara * 2 - 1}, alguien tiene que ganar ${setsPara}.`;
  return null;
}

/** Sets que faltan para que el partido acabe, en el peor caso. */
export function setsRestantes(p: Partido, setsPara: number): number {
  const st = reducir(p, setsPara);
  if (st.terminado) return 0;
  const faltanA = setsPara - st.sets.a;
  const faltanB = setsPara - st.sets.b;
  return Math.max(1, faltanA + faltanB - 1);
}
