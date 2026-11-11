/*
 * Fabrica una jornada completa y la escupe como JSON.
 *
 * No forma parte de la aplicación: sirve para tener un torneo terminado
 * con el que mirar el acta, el podio y la llave sin jugar cien partidos a
 * mano. Se corre con `npx vite-node src/jornada-demo.mts`.
 */
import { armarCuadro, azar, propagar, reducir, setsDe, sortear } from "../src/nucleo";
import type { Evento, Jugador, Partido, Torneo } from "../src/nucleo";

const NOMBRES = [
  ["Aguilar", "Diana"], ["Bautista", "Iván"], ["Carrillo", "Sofía"], ["Delgado", "Mateo"],
  ["Escobar", "Renata"], ["Fuentes", "Emilio"], ["Galván", "Ximena"], ["Herrera", "Bruno"],
  ["Ibarra", "Camila"], ["Juárez", "Leonel"], ["Lozano", "Paulina"], ["Medina", "Ángel"],
  ["Nájera", "Fernanda"], ["Olvera", "Santiago"], ["Peña", "Valeria"], ["Quiroz", "Tomás"],
];
const CLUBES = ["Zacatenco", "Casco de Santo Tomás", "Ticomán", "Milpa Alta"];

const SEGUNDOS = [
  ["Ávila", "Karla"], ["Beltrán", "Raúl"], ["Cordero", "Itzel"], ["Duarte", "Hugo"],
  ["Espinosa", "Mariana"], ["Franco", "Julián"], ["Guzmán", "Alondra"], ["Hinojosa", "Óscar"],
  ["Iglesias", "Marisol"], ["Jasso", "Rodrigo"], ["Ledezma", "Citlali"], ["Márquez", "Efraín"],
  ["Noriega", "Andrea"], ["Ochoa", "Gerardo"], ["Prieto", "Lorena"], ["Rentería", "Aldo"],
];

const modalidad = (process.argv[2] as Torneo["modalidad"]) || "individual";
const enParejas = modalidad !== "individual";

const rnd = azar(20260901);
const jugadores: Jugador[] = NOMBRES.map(([ap, n], i) => ({
  id: `j${i}`,
  nombre: `${n} ${ap}`,
  nombre2: enParejas ? `${SEGUNDOS[i][1]} ${SEGUNDOS[i][0]}` : "",
  club: CLUBES[i % CLUBES.length],
  rank: 2000 - i * 37,
}));

let reloj = new Date("2026-09-01T09:00:00").getTime();
let seq = 0;
/** Omit repartido sobre la unión: si no, se pierden los campos propios. */
type SinMeta<T> = T extends unknown ? Omit<T, "id" | "ts"> : never;
const ev = (e: SinMeta<Evento>): Evento => ({ id: `e${seq++}`, ts: reloj, ...e }) as Evento;

/** Juega el partido entero: gana el de mejor ranking siete de cada diez. */
function jugar(p: Partido, setsPara: number, arbitro: string) {
  const ra = jugadores.find((j) => j.id === p.aId)!.rank;
  const rb = jugadores.find((j) => j.id === p.bId)!.rank;
  const favor = ra >= rb ? 0.68 : 0.32;
  p.eventos.push(ev({ t: "inicia", saque: rnd() < 0.5 ? "a" : "b", invertido: false, por: arbitro }));
  let sa = 0;
  let sb = 0;
  while (sa < setsPara && sb < setsPara) {
    let a = 0;
    let b = 0;
    while (!((a >= 11 || b >= 11) && Math.abs(a - b) >= 2)) {
      const gana = rnd() < favor;
      if (gana) a++;
      else b++;
      reloj += 22000 + Math.floor(rnd() * 30000);
      p.eventos.push(ev({ t: "punto", j: gana ? "a" : "b", por: arbitro }));
    }
    if (a > b) sa++;
    else sb++;
    if (sa < setsPara && sb < setsPara) {
      reloj += 60000;
      p.eventos.push(ev({ t: "reanuda", por: arbitro }));
    }
  }
  reloj += 30000;
  p.eventos.push(ev({ t: "cierra", por: arbitro }));
  p.eventos.push(ev({ t: "valida", por: "juez" }));
}

const t: Torneo = {
  id: "demo-" + Date.now().toString(36),
  revision: 12,
  nombre:
    "Torneo Interpolitécnico de Tenis de Mesa" +
    (modalidad === "dobles" ? " · Dobles" : modalidad === "mixtos" ? " · Mixtos" : ""),
  sede: "Gimnasio de la ESFM, Zacatenco",
  modalidad,
  mesas: 4,
  formatoGrupos: 2,
  formatoFinales: 3,
  nGrupos: 4,
  clasifican: 2,
  descansoSet: 1,
  descansoJugador: 10,
  duracionTiempo: 60,
  duracionSupuesta: 20,
  validacionObligatoria: true,
  configurado: true,
  modoGuiado: true,
  pinJuez: "",
  semillaSorteo: 20260901,
  actaSorteo: [],
  jugadores,
  arbitros: [
    { id: "a1", nombre: "Lucía Ramos", mesa: 1 },
    { id: "a2", nombre: "Jorge Nieto", mesa: 2 },
    { id: "a3", nombre: "Ana Villalobos", mesa: 3 },
    { id: "a4", nombre: "Pedro Salas", mesa: 4 },
  ],
  grupos: [],
  partidos: [],
  relajaciones: [],
};

const s = sortear(jugadores, t.nGrupos, { semilla: t.semillaSorteo, sembrados: t.nGrupos });
t.grupos = s.grupos;
t.partidos = s.partidos;
t.actaSorteo = s.acta;
t.relajaciones = s.relajaciones;

t.partidos.forEach((p, i) => {
  p.mesa = (i % t.mesas) + 1;
  const arb = t.arbitros[p.mesa - 1];
  p.arbitroId = arb.id;
  jugar(p, t.formatoGrupos, arb.nombre);
});

/*
 * Un tiempo muerto y dos tarjetas, para que el acta las enseñe.
 *
 * El reloj del evento se toma del punto anterior, no del reloj global:
 * los eventos se ordenan por hora, y uno con hora del final del día se
 * iría al final del partido, donde la penalización ya no tendría dónde
 * caer. Es la misma razón por la que en la mesa se anotan en el momento.
 */
function meterEn(p: Partido, tras: number, e: SinMeta<Evento>): void {
  const antes = p.eventos[tras];
  const despues = p.eventos[tras + 1];
  const cuando = antes && despues ? Math.round((antes.ts + despues.ts) / 2) : (antes?.ts ?? 0) + 1;
  p.eventos.splice(tras + 1, 0, { ...ev(e), ts: cuando });
}

meterEn(t.partidos[2], 4, { t: "tiempo", lado: "b", por: t.arbitros[2].nombre });
meterEn(t.partidos[8], 6, {
  t: "tarjeta",
  lado: "a",
  color: "amarilla",
  puntos: 0,
  motivo: "retrasar el juego entre puntos",
  por: t.arbitros[0].nombre,
});
meterEn(t.partidos[14], 10, {
  t: "tarjeta",
  lado: "b",
  color: "amarilla",
  puntos: 1,
  motivo: "golpear la mesa con la raqueta",
  por: t.arbitros[2].nombre,
});

/* Una corrección de la mesa de control, para que el acta la enseñe. */
const corregido = t.partidos[5];
const estado = reducir(corregido, setsDe(t, corregido));
corregido.eventos.push(
  ev({
    t: "corrige",
    sets: [...estado.historial].reverse(),
    nota: "El árbitro capturó los sets al revés; se rehace con la hoja firmada.",
    por: "juez",
  }),
);

const finales = armarCuadro(t.grupos, t.partidos, t.clasifican, t.formatoGrupos, true);
t.partidos.push(...finales);

const rondas = Math.max(...finales.map((p) => p.ronda ?? 0)) + 1;
for (let r = 0; r < rondas; r++) {
  propagar(
    t.partidos.filter((p) => p.etapa === "final"),
    t.formatoFinales,
    true,
  );
  const dePrimera = t.partidos.filter((p) => p.etapa === "final" && p.ronda === r);
  dePrimera.forEach((p, i) => {
    if (!p.aId || !p.bId) return;
    p.mesa = (i % t.mesas) + 1;
    const arb = t.arbitros[p.mesa - 1];
    p.arbitroId = arb.id;
    jugar(p, t.formatoFinales, arb.nombre);
  });
}
propagar(t.partidos.filter((p) => p.etapa === "final"), t.formatoFinales, true);

/* Las mesas quedan vacías cuando el torneo acaba. */
for (const p of t.partidos) if (reducir(p, setsDe(t, p)).terminado) p.mesa = 0;

process.stdout.write(JSON.stringify(t));
