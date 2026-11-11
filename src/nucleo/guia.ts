import { setsDe } from "./asignacion";
import { pendientesDeGrupo } from "./cuadro";
import { reducir } from "./reglas";
import { sugerirAsignacion } from "./asignacion";
import type { Torneo } from "./tipos";

/**
 * Qué toca hacer ahora.
 *
 * Un torneo tiene un orden: no se sortea sin jugadores, no se arma el
 * cuadro sin grupos cerrados, no se llama a una mesa sin árbitro. Ese
 * orden lo sabe quien ha dirigido veinte torneos, y no lo sabe quien
 * dirige el primero. En vez de dejar ocho pestañas abiertas para que cada
 * cual adivine por dónde empezar, el sistema mira el estado del torneo y
 * dice el siguiente paso.
 *
 * Cada paso lleva dos textos. `queHacer` es la instrucción, y basta para
 * quien ya sabe. `porQue` explica la razón —de reglamento o de operación—
 * y es lo que se muestra a quien está aprendiendo. Son dos niveles de
 * detalle sobre la misma guía, no dos programas distintos: un juez con
 * experiencia y uno novato hacen lo mismo, solo que al segundo hay que
 * decirle por qué.
 */

export type Vista =
  | "torneo"
  | "jugadores"
  | "arbitros"
  | "grupos"
  | "cuadro"
  | "mesas"
  | "resultados"
  | "distancia"
  | "red";

export interface Paso {
  id: string;
  /** Título corto del paso. */
  titulo: string;
  /** La instrucción. Lo mínimo que hay que leer para actuar. */
  queHacer: string;
  /** La razón. Se muestra completa en modo guiado. */
  porQue: string;
  /** Pestaña donde se hace. */
  vista: Vista;
  /** Ya está hecho. */
  listo: boolean;
  /** No se puede hacer todavía porque falta un paso anterior. */
  bloqueado: boolean;
  /** Detalle del estado actual, cuando aporta algo. */
  detalle?: string;
}

/** Cuántos partidos esperan el visto bueno del juez. */
const porValidar = (t: Torneo): number =>
  t.partidos.filter((p) => p.aId && p.bId && reducir(p, setsDe(t, p)).fase === "por-validar").length;

/** Partidos de grupo que ya se pueden jugar y todavía no tienen mesa. */
const sinMesa = (t: Torneo): number =>
  t.partidos.filter((p) => p.aId && p.bId && !p.mesa && !reducir(p, setsDe(t, p)).terminado).length;

/**
 * Los pasos del torneo, en orden, con su estado.
 *
 * Se recalculan enteros en cada llamada a partir del torneo: no hay un
 * contador de «paso actual» que pueda quedar desincronizado si el juez
 * rehace el sorteo o borra a un jugador.
 */
export function pasos(t: Torneo, enRed: boolean, dispositivosDados: number): Paso[] {
  const hayJugadores = t.jugadores.length >= 2;
  const enParejas = t.modalidad !== "individual";
  const suficientes = t.jugadores.length >= t.nGrupos * 2;
  const hayArbitros = t.arbitros.length > 0;
  const hayGrupos = t.grupos.length > 0;
  const finales = t.partidos.filter((p) => p.etapa === "final");
  const faltanDeGrupo = pendientesDeGrupo(t.partidos, t.formatoGrupos, t.validacionObligatoria);
  const esperando = porValidar(t);
  const libres = sinMesa(t);
  const propuesta = hayGrupos ? sugerirAsignacion(t).asignaciones.length : 0;
  const todos = t.sistema === "todos";

  const lista: Paso[] = [
    {
      id: "torneo",
      titulo: "Configura el torneo",
      queHacer:
        "Elige la categoría —individual, dobles o mixtos— y el sistema —grupos con eliminatoria, o todos contra todos—, ponle nombre, di cuántas mesas hay y elige el formato de los partidos. Cuando esté, guarda la configuración.",
      porQue:
        "La categoría va primero porque decide cómo se lee todo lo demás: en dobles y en mixtos cada inscripción son dos personas con un solo lugar en el cuadro. Cada categoría de la jornada es un torneo aparte; se hace una y luego se abre la siguiente desde el archivo, con las mismas mesas y los mismos árbitros. El formato decide a cuántos sets se juega: al mejor de 3 es lo habitual en fase de grupos y al mejor de 5 en la eliminatoria, porque los partidos decisivos se juegan más largos. El número de mesas es el que tienes disponibles de verdad: de ahí sale cuántos partidos pueden correr a la vez. Todo esto se puede cambiar después, pero cambiarlo con el torneo empezado obliga a rehacer cuentas.",
      vista: "torneo",
      listo: t.configurado && t.mesas >= 1,
      bloqueado: false,
      detalle: t.nombre
        ? `${t.nombre} · ${t.modalidad === "dobles" ? "dobles" : t.modalidad === "mixtos" ? "mixtos" : "individual"} · ${t.mesas} mesas`
        : undefined,
    },
    {
      id: "jugadores",
      titulo: enParejas ? "Carga a las parejas" : "Carga a los jugadores",
      queHacer: enParejas
        ? "Mete cada pareja con sus dos nombres, o pega la lista completa con los dos separados por una barra. Si tienes ranking, ponlo: se usa para sembrar."
        : "Escríbelos uno a uno o pega la lista completa. Si tienes ranking, ponlo: se usa para sembrar.",
      porQue:
        "Sembrar significa repartir a los mejores en grupos distintos, para que no se eliminen entre ellos en la primera ronda. Sin ranking el reparto es al azar, que también vale, pero entonces puede tocar que los dos favoritos caigan juntos. El club sirve para lo contrario: el sorteo intenta que dos del mismo club no coincidan en el mismo grupo.",
      vista: "jugadores",
      listo: hayJugadores,
      bloqueado: false,
      detalle: t.jugadores.length
        ? `${t.jugadores.length} ${enParejas ? "parejas" : "jugadores"}${
            !suficientes && t.nGrupos > 1 ? ` · pocos para ${t.nGrupos} grupos` : ""
          }${
            enParejas && t.jugadores.some((j) => !j.nombre2?.trim())
              ? " · hay inscripciones con un solo nombre"
              : ""
          }`
        : undefined,
    },
    {
      id: "arbitros",
      titulo: "Registra a tus árbitros",
      queHacer:
        "Añade a quien vaya a llevar cada mesa. Si vas a estar tú solo, añádete a ti mismo en la mesa 1.",
      porQue:
        "Cada mesa necesita alguien que anote. El sistema usa esta lista para dos cosas: poner el nombre del árbitro en el tablero, y saber a qué mesa pertenece cada quien, de modo que un árbitro solo pueda escribir en los partidos de la suya. Si eres tú solo, no pasa nada: registras una mesa y vas anotando los resultados conforme te los reporten.",
      vista: "arbitros",
      listo: hayArbitros,
      bloqueado: !hayJugadores,
      detalle: hayArbitros ? `${t.arbitros.length} para ${t.mesas} mesas` : undefined,
    },
    {
      id: "alta",
      titulo: "Reparte la aplicación",
      queHacer:
        "Genera el código de cada árbitro y pásaselo, o enséñale el QR para que lo escanee desde su propio aparato.",
      porQue:
        "Cada árbitro entra con un código de un solo uso que lo identifica y lo ata a su mesa. Así el sistema sabe de quién viene cada resultado, y ni un árbitro puede anotar en la mesa de otro ni validar sus propios partidos: eso queda solo para ti. Si vas a llevar todo desde un aparato, sáltate este paso.",
      vista: "red",
      listo: dispositivosDados > 1,
      bloqueado: !hayArbitros || !enRed,
      detalle: enRed
        ? dispositivosDados > 1
          ? `${dispositivosDados - 1} tablets dadas de alta`
          : undefined
        : "necesita estar en red; si trabajas en un solo aparato, sáltalo",
    },
    {
      id: "sorteo",
      titulo: todos ? "Arma el calendario" : "Haz el sorteo",
      queHacer: todos
        ? "Genera el calendario: todos juegan contra todos una vez, repartidos en jornadas."
        : "Sortea en la computadora, o reparte por ranking si ya lo hiciste con bolitas y solo vas a capturarlo.",
      porQue: todos
        ? "En cada jornada cada jugador juega una sola vez, así que una jornada puede ser un día del torneo. Con un número impar de jugadores, en cada jornada descansa uno. Al final no hay eliminatoria: gana quien quede primero en la tabla, con los mismos desempates de siempre."
        : "El sorteo reparte a los jugadores en grupos separando a los sembrados y evitando, cuando puede, que coincidan compañeros de club. Si haces el sorteo en la computadora queda una semilla anotada en el acta: con ella el sorteo se repite idéntico, que es lo que te permite demostrar cómo se hizo si alguien reclama. Cuando una separación es imposible —cinco del mismo club en cuatro grupos— el sistema lo dice en vez de callárselo.",
      vista: "grupos",
      listo: hayGrupos,
      bloqueado: !hayJugadores,
      detalle: hayGrupos ? `${t.grupos.length} grupos, ${t.partidos.filter((p) => p.etapa === "grupo").length} partidos` : undefined,
    },
    {
      id: "mesas",
      titulo: "Reparte los partidos por mesa",
      queHacer:
        "Mira la propuesta y acéptala, o cámbiala. Vuelve aquí cada vez que se libere una mesa.",
      porQue:
        "El sistema propone qué partido va a cada mesa libre mirando quién acaba de jugar, quién está descansando y qué cruces quedaron definidos. Cada renglón te dice por qué lo propone. La decisión sigue siendo tuya: el programa no sabe que a ese jugador se le rompió la raqueta ni que el de la mesa tres pidió diez minutos.",
      vista: "mesas",
      listo: hayGrupos && libres === 0,
      bloqueado: !hayGrupos,
      detalle: hayGrupos
        ? propuesta > 0
          ? `${propuesta} partidos listos para entrar`
          : libres > 0
            ? `${libres} esperando a que se libere una mesa`
            : "todo repartido"
        : undefined,
    },
    {
      id: "resultados",
      titulo: "Valida los resultados",
      queHacer: "Acepta lo que van cerrando los árbitros, o corrígelo si viene mal.",
      porQue:
        "Un resultado no cuenta para la tabla hasta que tú lo aceptas. Esa separación es a propósito: el árbitro sabe lo que pasó en su mesa, pero quien responde del torneo eres tú. Si un marcador viene equivocado puedes rehacerlo; la corrección queda firmada con tu nombre y el motivo, y el registro original se conserva debajo por si hay que revisarlo.",
      vista: "resultados",
      listo: hayGrupos && faltanDeGrupo === 0,
      bloqueado: !hayGrupos,
      detalle: esperando ? `${esperando} esperando tu visto bueno` : hayGrupos ? `faltan ${faltanDeGrupo} partidos de grupo` : undefined,
    },
    {
      id: "cuadro",
      titulo: "Arma la eliminatoria",
      queHacer: "Cuando los grupos estén cerrados, arma el cuadro con los que avanzan.",
      porQue:
        "El cuadro cruza a los primeros de grupo contra los segundos de otro grupo, de modo que dos que ya se enfrentaron en la fase de grupos no vuelvan a verse hasta lo más tarde posible. Si el número de clasificados no es potencia de dos, los mejores descansan la primera ronda. A partir de ahí, cada resultado que validas hace avanzar al ganador solo.",
      vista: "cuadro",
      listo: finales.length > 0,
      bloqueado: !hayGrupos,
      detalle: finales.length
        ? `${finales.length} cruces`
        : faltanDeGrupo > 0
          ? `faltan ${faltanDeGrupo} partidos de grupo`
          : undefined,
    },
  ];

  return todos ? lista.filter((x) => x.id !== "cuadro") : lista;
}

/**
 * El primer paso que falta.
 *
 * Devuelve null cuando no queda nada por hacer, que es la señal de que el
 * torneo está en marcha y la guía puede quitarse de en medio.
 */
export function siguientePaso(t: Torneo, enRed: boolean, dispositivos: number): Paso | null {
  const todos = pasos(t, enRed, dispositivos);
  return todos.find((x) => !x.listo && !x.bloqueado) ?? null;
}

/** Cuánto del camino está recorrido, para la barra de progreso. */
export function avance(t: Torneo, enRed: boolean, dispositivos: number): { hechos: number; total: number } {
  const todos = pasos(t, enRed, dispositivos).filter((x) => !(x.id === "alta" && !enRed));
  return { hechos: todos.filter((x) => x.listo).length, total: todos.length };
}
