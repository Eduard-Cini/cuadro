/** Tipos del dominio. El núcleo no conoce React ni el navegador. */

export type Lado = "a" | "b";
export type Etapa = "grupo" | "final";

export interface Jugador {
  id: string;
  nombre: string;
  club: string;
  /** Mayor es mejor. 0 significa sin ranking. */
  rank: number;
}

export interface Arbitro {
  id: string;
  nombre: string;
  mesa: number;
}

export interface Grupo {
  id: string;
  nombre: string;
  jugadores: string[];
}

/** Un punto ganado. El marcador nunca se guarda: se deduce de estos. */
export interface Evento {
  t: "punto";
  j: Lado;
  ts: number;
}

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
  mesa: number;
  eventos: Evento[];
  /** Quién saca en el primer juego. Lo decide el sorteo del árbitro. */
  primeroSaque?: Lado;
  /** Los lados aparecen cambiados para coincidir con la mesa real. */
  invertido?: boolean;
}

/** Sets necesarios para ganar: 2 es al mejor de 3, 3 al mejor de 5. */
export type Formato = 2 | 3 | 4;

export interface Torneo {
  nombre: string;
  mesas: number;
  formatoGrupos: Formato;
  formatoFinales: Formato;
  nGrupos: number;
  clasifican: number;
  jugadores: Jugador[];
  arbitros: Arbitro[];
  grupos: Grupo[];
  partidos: Partido[];
  /** Restricciones del sorteo que no se pudieron cumplir. */
  relajaciones: string[];
}

export interface EstadoPartido {
  sets: { a: number; b: number };
  pa: number;
  pb: number;
  juego: number;
  saca: Lado;
  historial: Array<{ a: number; b: number }>;
  terminado: boolean;
  ganador: Lado | null;
  finDeSet: boolean;
  deuce: boolean;
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
