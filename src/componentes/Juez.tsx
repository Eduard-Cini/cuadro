import { useRef, useState } from "react";
import {
  armarCuadro,
  asignarMesas,
  clasificar,
  estadisticas,
  ganadorDe,
  nombreRonda,
  partidoListo,
  pendientesDeGrupo,
  reducir,
  sortear,
} from "../nucleo";
import type { Formato, Torneo } from "../nucleo";
import { leerJugadores, nuevoId } from "../almacen";
import { Ic } from "./Iconos";
import { TarjetaPartido } from "./TarjetaPartido";

type Vista = "torneo" | "jugadores" | "arbitros" | "grupos" | "cuadro" | "rol";

const VISTAS: Array<[Vista, string]> = [
  ["torneo", "Torneo"],
  ["jugadores", "Jugadores"],
  ["arbitros", "Árbitros"],
  ["grupos", "Grupos"],
  ["cuadro", "Cuadro"],
  ["rol", "Rol de mesas"],
];

interface Props {
  t: Torneo;
  actualizar: (fn: (t: Torneo) => void) => void;
  alAbrir: (id: string) => void;
}

export function Juez({ t, actualizar, alAbrir }: Props) {
  const [vista, setVista] = useState<Vista>("torneo");
  const [nuevo, setNuevo] = useState({ nombre: "", club: "", rank: "" });
  const [arb, setArb] = useState({ nombre: "", mesa: "1" });
  const [bulk, setBulk] = useState(false);
  const [texto, setTexto] = useState("");
  const [nota, setNota] = useState("");
  const archivo = useRef<HTMLInputElement>(null);

  const nom = (id: string | null) => t.jugadores.find((j) => j.id === id)?.nombre ?? "—";

  /* ---------- jugadores ---------- */
  function agregarJugador() {
    const nombre = nuevo.nombre.trim();
    if (!nombre) return;
    actualizar((d) => {
      d.jugadores.push({ id: nuevoId(), nombre, club: nuevo.club.trim(), rank: Number(nuevo.rank) || 0 });
    });
    setNuevo({ nombre: "", club: "", rank: "" });
  }

  function importar(txt: string) {
    const filas = leerJugadores(txt);
    if (!filas.length) {
      setNota("No se encontró ningún jugador en el texto.");
      return;
    }
    actualizar((d) => {
      for (const f of filas) d.jugadores.push({ id: nuevoId(), ...f });
    });
    setNota(`Se importaron ${filas.length} jugadores.`);
  }

  function alSubirCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => importar(String(fr.result));
    fr.onerror = () => setNota("No se pudo leer el archivo.");
    fr.readAsText(f, "utf-8");
    e.target.value = "";
  }

  /* ---------- sorteo y cuadro ---------- */
  function hacerSorteo() {
    if (t.jugadores.length < 2) {
      setNota("Hacen falta al menos dos jugadores.");
      return;
    }
    if (t.partidos.some((p) => p.eventos.length) && !confirm("Ya hay marcadores capturados. El sorteo los borra. ¿Seguir?"))
      return;
    actualizar((d) => {
      const r = sortear(d.jugadores, d.nGrupos);
      d.grupos = r.grupos;
      d.partidos = r.partidos;
      d.relajaciones = r.relajaciones;
      asignarMesas(d.partidos, d.mesas);
    });
    setVista("grupos");
  }

  function hacerCuadro() {
    if (!t.grupos.length) {
      setNota("Primero hay que sortear los grupos.");
      return;
    }
    actualizar((d) => {
      const fin = armarCuadro(d.grupos, d.partidos, d.clasifican, d.formatoGrupos);
      d.partidos = d.partidos.filter((p) => p.etapa !== "final").concat(fin);
      asignarMesas(
        d.partidos.filter((p) => p.etapa === "final" && p.aId && p.bId && !partidoListo(p, d.formatoFinales)),
        d.mesas,
      );
    });
    setVista("cuadro");
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

  const finales = t.partidos.filter((p) => p.etapa === "final");
  const rondas = finales.length ? Math.max(...finales.map((p) => p.ronda ?? 0)) + 1 : 0;
  const pendientes = pendientesDeGrupo(t.partidos, t.formatoGrupos);

  return (
    <div>
      <nav className="tabs" role="tablist">
        {VISTAS.map(([v, etiqueta]) => (
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
            {etiqueta}
          </button>
        ))}
      </nav>

      {nota && <div className="aviso-relaj" style={{ marginBottom: "1rem" }}><Ic n="raq" /><div>{nota}</div></div>}

      {/* ---------------- torneo ---------------- */}
      {vista === "torneo" && (
        <div className="vin t1" data-n="01">
          <h2><Ic n="mesa" />El torneo</h2>
          <p className="sub">El formato puede ser distinto en grupos y en la eliminatoria, que es lo normal.</p>
          <div className="campos">
            {campo("Nombre", t.nombre, (v) => actualizar((d) => void (d.nombre = v)), { placeholder: "Copa de barrio" })}
            {campo("Mesas", t.mesas, (v) => actualizar((d) => void (d.mesas = Math.max(1, Number(v) || 1))), { type: "number", min: 1, max: 24 })}
            <label className="f">
              <span>Formato en grupos</span>
              <select value={t.formatoGrupos} onChange={(e) => actualizar((d) => void (d.formatoGrupos = Number(e.target.value) as Formato))}>
                <option value={2}>Al mejor de 3</option>
                <option value={3}>Al mejor de 5</option>
                <option value={4}>Al mejor de 7</option>
              </select>
            </label>
            <label className="f">
              <span>Formato en eliminatoria</span>
              <select value={t.formatoFinales} onChange={(e) => actualizar((d) => void (d.formatoFinales = Number(e.target.value) as Formato))}>
                <option value={2}>Al mejor de 3</option>
                <option value={3}>Al mejor de 5</option>
                <option value={4}>Al mejor de 7</option>
              </select>
            </label>
            {campo("Grupos", t.nGrupos, (v) => actualizar((d) => void (d.nGrupos = Math.max(1, Number(v) || 1))), { type: "number", min: 1, max: 16 })}
            {campo("Avanzan por grupo", t.clasifican, (v) => actualizar((d) => void (d.clasifican = Math.max(1, Number(v) || 1))), { type: "number", min: 1, max: 8 })}
          </div>
          <p className="sub" style={{ margin: ".9rem 0 0" }}>Los sets se juegan a 11 puntos con dos de diferencia.</p>
        </div>
      )}

      {/* ---------------- jugadores ---------------- */}
      {vista === "jugadores" && (
        <div className="vin t2" data-n="02">
          <h2><Ic n="raq" />Jugadores</h2>
          <p className="sub">El ranking se usa para sembrar. Sin ranking, el sorteo es al azar.</p>
          <div className="campos">
            {campo("Nombre", nuevo.nombre, (v) => setNuevo({ ...nuevo, nombre: v }), {
              placeholder: "Apellido Nombre",
              onKeyDown: (e) => e.key === "Enter" && agregarJugador(),
            })}
            {campo("Club", nuevo.club, (v) => setNuevo({ ...nuevo, club: v }), { placeholder: "Club o escuela" })}
            {campo("Ranking", nuevo.rank, (v) => setNuevo({ ...nuevo, rank: v }), { type: "number", min: 0, placeholder: "opcional" })}
          </div>
          <div className="fila">
            <button className="btn" onClick={agregarJugador}>Agregar</button>
            <button className="btn sec chico" onClick={() => setBulk((b) => !b)}>Pegar lista o cargar CSV</button>
            <button
              className="btn sec chico"
              onClick={() => {
                if (!t.jugadores.length || !confirm("Se borran los jugadores, los grupos y los partidos. ¿Seguir?")) return;
                actualizar((d) => {
                  d.jugadores = [];
                  d.grupos = [];
                  d.partidos = [];
                  d.relajaciones = [];
                });
              }}
            >
              Vaciar
            </button>
          </div>

          {bulk && (
            <div style={{ marginTop: ".95rem" }}>
              <label className="f">
                <span>Archivo CSV — columnas nombre, club, ranking</span>
                <input ref={archivo} type="file" accept=".csv,.txt,text/csv,text/plain" onChange={alSubirCsv} />
              </label>
              <label className="f" style={{ marginTop: ".7rem" }}>
                <span>O pega la lista, un jugador por línea</span>
                <textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder={"Ramírez Luis, Deportivo Norte, 1420\nOrtega Ana, Club Centro, 1385\nSalas Pedro"}
                />
              </label>
              <div className="fila">
                <button className="btn verde chico" onClick={() => { importar(texto); setTexto(""); }}>
                  Importar lo pegado
                </button>
              </div>
            </div>
          )}

          <ul className="lista">
            {[...t.jugadores]
              .sort((a, b) => b.rank - a.rank)
              .map((j, i) => (
                <li key={j.id} className="item">
                  <span className="idx">{i + 1}</span>
                  <span className="nom">{j.nombre}</span>
                  <span className="met">{[j.club, j.rank ? `rk ${j.rank}` : ""].filter(Boolean).join(" · ")}</span>
                  <button
                    className="x"
                    title="Quitar"
                    onClick={() =>
                      actualizar((d) => {
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
          {!t.jugadores.length && <p className="vacio"><Ic n="raq" />Todavía no hay jugadores.</p>}
        </div>
      )}

      {/* ---------------- árbitros ---------------- */}
      {vista === "arbitros" && (
        <div className="vin t1" data-n="03">
          <h2><Ic n="mesa" />Árbitros</h2>
          <p className="sub">Cada uno queda en una mesa. Su nombre sale en el tablero.</p>
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
                actualizar((d) => d.arbitros.push({ id: nuevoId(), nombre, mesa: Math.max(1, Number(arb.mesa) || 1) }));
                setArb({ nombre: "", mesa: arb.mesa });
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
                  <span className="met">mesa {a.mesa}</span>
                  <button className="x" title="Quitar" onClick={() => actualizar((d) => void (d.arbitros = d.arbitros.filter((x) => x.id !== a.id)))}>
                    ✕
                  </button>
                </li>
              ))}
          </ul>
          {!t.arbitros.length && <p className="vacio"><Ic n="raq" />Todavía no hay árbitros.</p>}
        </div>
      )}

      {/* ---------------- grupos ---------------- */}
      {vista === "grupos" && (
        <>
          <div className="vin t2" data-n="04">
            <h2><Ic n="raq" />Sorteo</h2>
            <p className="sub">Reparte por siembra y trata de que no coincidan compañeros de club. Si no alcanza, lo dice.</p>
            <div className="fila">
              <button className="btn" onClick={hacerSorteo}>Sortear grupos</button>
              <button
                className="btn sec"
                onClick={() => {
                  if (!t.grupos.length || !confirm("Se borran los grupos y todos los partidos. ¿Seguir?")) return;
                  actualizar((d) => {
                    d.grupos = [];
                    d.partidos = [];
                    d.relajaciones = [];
                  });
                }}
              >
                Deshacer sorteo
              </button>
            </div>
            {t.grupos.length > 0 &&
              (t.relajaciones.length ? (
                <div className="aviso-relaj">
                  <Ic n="raq" />
                  <div>
                    <b>No se pudo separar a todos.</b>
                    {t.relajaciones.map((r, i) => (
                      <div key={i}>{r}</div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="aviso-relaj" style={{ background: "rgba(28,106,96,.16)", borderColor: "var(--verde)" }}>
                  <Ic n="raq" />
                  <div>Se respetaron todas las restricciones: sembrados repartidos y clubes separados.</div>
                </div>
              ))}
          </div>

          <div className="gr">
            {t.grupos.map((gr) => {
              const suyos = t.partidos.filter((p) => p.grupoId === gr.id);
              const ord = clasificar(gr.jugadores, suyos, t.formatoGrupos);
              const m = estadisticas(gr.jugadores, suyos, t.formatoGrupos);
              return (
                <div key={gr.id} className="vin" data-n={gr.nombre.slice(-1)}>
                  <h2><Ic n="raq" />{gr.nombre}</h2>
                  <table className="tab-pos">
                    <thead>
                      <tr><th /><th>Jugador</th><th>PJ</th><th>Sets</th><th>Pts</th></tr>
                    </thead>
                    <tbody>
                      {ord.map((id, i) => (
                        <tr key={id} className={i < t.clasifican ? "clasifica" : undefined}>
                          <td className="pos">{i + 1}</td>
                          <td className="j">{nom(id)}</td>
                          <td>{m[id].pj}</td>
                          <td>{m[id].sg}–{m[id].sp}</td>
                          <td className="p">{m[id].pts}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
          {!t.grupos.length && <p className="vacio"><Ic n="raq" />Sin grupos. Sortea desde arriba.</p>}
        </>
      )}

      {/* ---------------- cuadro ---------------- */}
      {vista === "cuadro" && (
        <>
          <div className="vin t1" data-n="05">
            <h2><Ic n="mesa" />Eliminatoria</h2>
            <p className="sub">Toma a los que avanzan de cada grupo y cruza primeros contra segundos.</p>
            <div className="fila">
              <button className="btn" onClick={hacerCuadro}>Armar cuadro</button>
              <button className="btn sec" onClick={() => actualizar((d) => void (d.partidos = d.partidos.filter((p) => p.etapa !== "final")))}>
                Borrar cuadro
              </button>
            </div>
            <p className="sub" style={{ margin: ".85rem 0 0" }}>
              {!t.grupos.length
                ? "Primero hay que sortear los grupos."
                : pendientes
                  ? `Faltan ${pendientes} partidos de grupo. Puedes armarlo igual, pero con la tabla incompleta.`
                  : ""}
            </p>
          </div>

          <div className="rondas">
            {Array.from({ length: rondas }, (_, r) => (
              <div className="ronda" key={r}>
                <h3>{nombreRonda(r, rondas)}</h3>
                {finales
                  .filter((p) => p.ronda === r)
                  .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
                  .map((p) => {
                    const st = reducir(p, t.formatoFinales);
                    const g = ganadorDe(p, t.formatoFinales);
                    const linea = (id: string | null, lado: "a" | "b") => (
                      <div className={g === id ? "gana" : id ? "" : "bye"}>
                        <span>{id ? nom(id) : p.aId || p.bId ? "descansa" : "por definir"}</span>
                        <b>{id ? st.sets[lado] : ""}</b>
                      </div>
                    );
                    return (
                      <div key={p.id} className="llave" onClick={() => p.aId && p.bId && alAbrir(p.id)}>
                        {linea(p.aId, "a")}
                        {linea(p.bId, "b")}
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>
          {!finales.length && <p className="vacio"><Ic n="raq" />Sin cuadro todavía.</p>}
        </>
      )}

      {/* ---------------- rol de mesas ---------------- */}
      {vista === "rol" && (
        <>
          <div className="vin t2" data-n="06">
            <h2><Ic n="mesa" />Rol de mesas</h2>
            <p className="sub">Orden de juego. Se evita que alguien juegue dos partidos seguidos.</p>
          </div>
          {t.partidos.filter((p) => p.aId && p.bId).map((p) => (
            <TarjetaPartido key={p.id} t={t} p={p} alAbrir={alAbrir} />
          ))}
          {!t.partidos.some((p) => p.aId && p.bId) && <p className="vacio"><Ic n="raq" />Sin partidos.</p>}
        </>
      )}
    </div>
  );
}
