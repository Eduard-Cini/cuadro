/** Tipos del dominio. El núcleo no conoce React ni el navegador. */

export type Lado = "a" | "b";
export type Etapa = "grupo" | "final";

/**
 * Qué se juega.
 *
 * El reglamento de juego es el mismo en las tres: sets a 11, saque cada
 * dos puntos, misma forma de contar. Lo que cambia es quién ocupa un lado
 * de la mesa —una persona o una pareja— y, en mixtos, que la pareja tiene
 * que ser un hombre y una mujer. Por eso la modalidad no toca el marcador
 * ni el sorteo: solo dice cuántos nombres lleva cada inscripción.
 */
export type Modalidad = "individual" | "dobles" | "mixtos";

/**
 * Cómo se organiza la competencia.
 *
 *  - `grupos`  fase de grupos y después eliminatoria con los que avanzan
 *  - `todos`   todos contra todos (round robin): un solo grupo, el
 *              calendario repartido en jornadas y la tabla final decide;
 *              no hay eliminatoria
 */
export type Sistema = "grupos" | "todos";

/**
 * Hándicap: el de menor ranking empieza cada set con puntos de ventaja.
 *
 * Se da un punto por cada `escalon` puntos de diferencia de ranking, sin
 * pasar de `tope`. A quien no tiene ranking no se le calcula ventaja.
 */
export interface Handicap {
  activo: boolean;
  /**
   * De dónde sale la diferencia entre dos jugadores.
   *
   *  - `ranking`  de sus puntos de ranking: un punto por cada `escalon`
   *  - `lugar`    de su lugar en la lista, del 1 al n: `porLugar` puntos
   *               por cada lugar de diferencia. No necesita ranking: basta
   *               con que el juez ordene la lista de mejor a peor.
   *
   * Sin él vale `ranking`, que es como funcionaba antes de existir.
   */
  base?: "ranking" | "lugar";
  escalon: number;
  /** Puntos de ventaja por cada lugar de diferencia, con base `lugar`. */
  porLugar?: number;
  tope: number;
}

/**
 * Con qué reglas se juega.
 *
 *  - `formal`         el reglamento de la ITTF, fijo: sets a 11, un minuto
 *                     entre sets, tiempo muerto de un minuto, resultados
 *                     validados por la mesa de control y sin hándicap
 *  - `personalizado`  torneo amateur: quien organiza decide a cuántos
 *                     puntos se juega, los descansos, el hándicap y si los
 *                     resultados pasan por él
 */
export type Reglamento = "formal" | "personalizado";

/**
 * Una inscripción: la persona o la pareja que ocupa un lado de la mesa.
 *
 * En dobles y mixtos son dos personas con una sola inscripción, un solo
 * ranking y un solo lugar en el cuadro. Modelarlo así —y no como dos
 * jugadores atados— es lo que deja intactos el sorteo, la clasificación,
 * el cuadro y el reparto de mesas: para todos ellos sigue habiendo un
 * competidor por lado.
 */
export interface Jugador {
  id: string;
  nombre: string;
  /** Segundo integrante. Vacío en individual. */
  nombre2?: string;
  club: string;
  /** Mayor es mejor. 0 significa sin ranking. */
  rank: number;
}

/** Cómo se lee una inscripción: un nombre, o los dos de la pareja. */
export const nombreDe = (j: Jugador | null | undefined, vacio = "—"): string =>
  !j ? vacio : j.nombre2?.trim() ? `${j.nombre} / ${j.nombre2}` : j.nombre;

/** Colores de tarjeta que el árbitro puede sacar en la mesa. */
export type Tarjeta = "amarilla" | "roja";

export interface Arbitro {
  id: string;
  nombre: string;
  /** Mesa que le asignó el juez. 0 mientras no tenga ninguna. */
  mesa: number;
}

export interface Grupo {
  id: string;
  nombre: string;
  jugadores: string[];
}

/**
 * Un hecho del partido.
 *
 * El registro es *solo-añadir*: nada se borra ni se reescribe. Deshacer no
 * quita el punto, agrega un evento que lo anula. Esa es la condición que
 * hace que sincronizar dos dispositivos sea unir dos conjuntos: la unión no
 * depende del orden en que lleguen los eventos ni de cuántas veces lleguen.
 *
 *  - `inicia`   el árbitro fija el saque del sorteo y de qué lado está cada
 *               quien; si se equivoca, emite otro y vale el último
 *  - `punto`    un punto para un lado
 *  - `anula`    deshacer: apunta al evento que deja sin efecto
 *  - `reanuda`  se acabó el descanso entre sets y vuelve a correr el juego
 *  - `cierra`   el árbitro da el partido por terminado y lo manda a la mesa
 *               de control
 *  - `valida`   el juez acepta el resultado y ya cuenta para la tabla
 *  - `corrige`  el juez rehace el marcador por sets; manda sobre lo que
 *               digan los puntos, y por eso queda escrito quién lo hizo
 *  - `tiempo`   uno de los dos lados pide su tiempo muerto; el reglamento
 *               da uno por partido y de un minuto, así que gastarlo es un
 *               hecho del partido y no un botón de la pantalla
 *  - `tarjeta`  el árbitro amonesta; si la falta lleva penalización, los
 *               puntos van al contrario y cuentan como cualquier otro
 *  - `resultado` quien anota sin llevar el marcador punto a punto (una
 *               mesa autogestionada, por ejemplo) escribe los parciales;
 *               cierra el partido y espera al juez como cualquier otro
 */
export type Evento =
  | { id: string; t: "inicia"; saque: Lado; invertido: boolean; ts: number; por: string }
  | { id: string; t: "punto"; j: Lado; ts: number; por: string }
  | { id: string; t: "anula"; ref: string; ts: number; por: string }
  | { id: string; t: "reanuda"; ts: number; por: string }
  | { id: string; t: "cierra"; ts: number; por: string }
  | { id: string; t: "valida"; ts: number; por: string }
  | { id: string; t: "corrige"; sets: Array<{ a: number; b: number }>; nota: string; ts: number; por: string }
  | { id: string; t: "tiempo"; lado: Lado; ts: number; por: string }
  | { id: string; t: "resultado"; sets: Array<{ a: number; b: number }>; nota: string; ts: number; por: string }
  | {
      id: string;
      t: "tarjeta";
      lado: Lado;
      color: Tarjeta;
      /** Puntos de penalización que se le dan al contrario. */
      puntos: 0 | 1 | 2;
      motivo: string;
      ts: number;
      por: string;
    };

export type TipoEvento = Evento["t"];

export interface Partido {
  id: string;
  etapa: Etapa;
  /** Solo en fase de grupos. */
  grupoId?: string;
  /** Solo en eliminatoria. */
  ronda?: number;
  slot?: number;
  aId: string | null;
  bId: string | null;
  /** 0 mientras el juez no le haya aprobado mesa. */
  mesa: number;
  /** Árbitro asignado. Sin esto, el tablero de nadie lo muestra. */
  arbitroId?: string;
  /** Lugar en el rol de juego. Sirve para ordenar la cola de cada mesa. */
  orden: number;
  /** Jornada del calendario en todos contra todos, contando desde 1. */
  jornada?: number;
  /** Puntos a los que se juega cada set cuando no son 11. Se fija antes
      del primer punto, igual que la ventaja: cambiar la regla a media
      jornada no altera un partido que ya empezó. */
  meta?: number;
  /** Puntos con que empieza cada set un lado, en torneos con hándicap. Se
      fija antes del primer punto y ya no cambia aunque cambie el ranking. */
  ventaja?: { lado: Lado; puntos: number };
  eventos: Evento[];
}

/** Sets necesarios para ganar: 2 es al mejor de 3, 3 al mejor de 5. */
export type Formato = 2 | 3 | 4;

/**
 * En qué punto de su vida está el partido.
 *
 * `descanso` es un estado de verdad, no un adorno: entre sets el juego se
 * detiene, el tablero no debe mostrar 0–0 como si ya hubiera empezado el
 * siguiente, y hace falta un acto explícito del árbitro para reanudar.
 */
export type Fase = "sin-iniciar" | "en-juego" | "descanso" | "por-validar" | "validado";

export interface EstadoPartido {
  sets: { a: number; b: number };
  pa: number;
  pb: number;
  juego: number;
  saca: Lado;
  historial: Array<{ a: number; b: number }>;
  terminado: boolean;
  ganador: Lado | null;
  deuce: boolean;
  fase: Fase;
  /** Los lados aparecen cambiados para coincidir con la mesa real. */
  invertido: boolean;
  /** Momento en que cerró el set anterior: es el cero del cronómetro. */
  descansoDesde: number | null;
  /** El marcador lo escribió el juez a mano. */
  corregido: boolean;
  /** Quién corrigió y por qué, para que quede rastro. */
  correccion: { por: string; nota: string; ts: number } | null;
  /** El resultado se escribió por sets, sin marcador punto a punto. */
  porSets: { por: string; nota: string; ts: number } | null;
  /** Ventaja de hándicap con que empieza cada set. */
  ventaja: { a: number; b: number };
  /** Primer y último evento con juego. Con esto se miden duraciones. */
  desde: number | null;
  hasta: number | null;
  /** Puntos que siguen en pie, ya descontadas las anulaciones. */
  jugados: number;
  /**
   * Los puntos del set que se está jugando, en orden.
   *
   * La tira del tablero enseña esto y no el partido entero: al cerrar un
   * set el marcador vuelve a cero, y dejar ahí las marcas del set anterior
   * hace que el árbitro cuente mal de un vistazo.
   */
  puntosDelSet: Lado[];
  /** Quién ya gastó su tiempo muerto. El reglamento da uno por lado. */
  tiempoGastado: { a: boolean; b: boolean };
  /** Tiempo muerto corriendo ahora mismo: quién lo pidió y desde cuándo. */
  tiempoDesde: number | null;
  tiempoLado: Lado | null;
  /** Todas las tarjetas del partido, en orden, para el acta. */
  tarjetas: Array<{ lado: Lado; color: Tarjeta; puntos: 0 | 1 | 2; motivo: string; ts: number; por: string }>;
  /** Lado descalificado por tarjeta roja. El partido se le da al otro. */
  descalificado: Lado | null;
}

export interface Fila {
  id: string;
  pj: number;
  pg: number;
  pp: number;
  /** Puntos de partido: 2 por ganado, 1 por perdido. */
  pts: number;
  sg: number;
  sp: number;
  /** Puntos de set ganados y perdidos. */
  tg: number;
  tp: number;
}

export interface Torneo {
  /** Identifica al torneo cuando dos dispositivos se encuentran. */
  id: string;
  /**
   * Sube cada vez que el juez cambia la estructura: configuración, listas,
   * sorteo, cuadro, asignación de mesas. Al sincronizar, la estructura del
   * de revisión más alta manda. Los eventos de partido no pasan por aquí:
   * esos se unen siempre.
   */
  revision: number;
  nombre: string;
  sede: string;
  /** Individual, dobles o mixtos. Decide cuántos nombres lleva cada
      inscripción; el resto del reglamento no cambia. */
  modalidad: Modalidad;
  /*
   * Los tres campos que siguen son opcionales porque un torneo de una
   * versión anterior, o el que llega por el relevo desde una tablet sin
   * actualizar, no los trae. Sin ellos: grupos, sin hándicap y siembra
   * por ranking, que es como funcionaba todo antes.
   */
  /** Formal (ITTF) o personalizado. Sin él, personalizado. */
  reglamento?: Reglamento;
  /** Puntos por set. Sin él, 11. En formal siempre son 11. */
  puntosSet?: number;
  /** Grupos y eliminatoria, o todos contra todos. */
  sistema?: Sistema;
  handicap?: Handicap;
  /**
   * La siembra sale del orden de la lista y no del ranking.
   *
   * Para cuando no hay ranking pero quien organiza sí sabe quién juega
   * mejor: acomoda la lista y los de arriba se reparten como cabezas.
   */
  siembraManual?: boolean;
  mesas: number;
  formatoGrupos: Formato;
  formatoFinales: Formato;
  nGrupos: number;
  clasifican: number;
  /** Minutos de descanso entre sets. El reglamento ITTF da uno. */
  descansoSet: number;
  /** Minutos que descansa un jugador entre dos partidos suyos. */
  descansoJugador: number;
  /** Segundos que dura un tiempo muerto. El reglamento ITTF da 60. */
  duracionTiempo: number;
  /** Minutos que se supone que dura un partido mientras no haya medidos. */
  duracionSupuesta: number;
  /** Si está activo, el resultado del árbitro no cuenta hasta que el juez
      lo acepta. En torneos informales se puede apagar. */
  validacionObligatoria: boolean;
  /**
   * El juez ya dio por buena la configuración inicial.
   *
   * Sirve para quitar de en medio lo que ya está decidido: una vez fijados
   * mesas y formato, esos campos solo estorban, y dejarlos abiertos invita
   * a tocarlos por error a media jornada.
   */
  configurado: boolean;
  /** Explicaciones largas para quien nunca ha dirigido un torneo. */
  modoGuiado: boolean;
  /** Separa roles en dispositivos compartidos. No es seguridad: es un
      seguro contra entrar por equivocación a la mesa de control. */
  pinJuez: string;
  /** Semilla del último sorteo por computadora. Permite repetirlo igual. */
  semillaSorteo: number;
  /** Qué hizo el sorteo, paso a paso, para el acta. */
  actaSorteo: string[];
  jugadores: Jugador[];
  arbitros: Arbitro[];
  grupos: Grupo[];
  partidos: Partido[];
  /** Restricciones del sorteo que no se pudieron cumplir. */
  relajaciones: string[];
}
