import { useMemo, useState } from "react";
import { contarVotos, leerVotos, nombreDe, partirEnBloques, proponerBloques, silueta, sumarVotos } from "../nucleo";
import type { Jugador, Voto } from "../nucleo";
import { TablaBloques } from "./TablaBloques";

/** Lo que la votación necesita saber del hándicap. Nulo en un torneo formal, que no lo tiene. */
export interface HandicapVotacion {
  activo: boolean;
  base: "ranking" | "lugar" | "bloque";
  tabla: number[][] | undefined;
  tope: number;
  /** Puntos por set. */
  meta: number;
}

interface Props {
  /** La lista en el orden de la siembra, como se ve en la pestaña. */
  lista: Jugador[];
  /** La tabla de votaciones. */
  votos: Voto[];
  alCambiar: (votos: Voto[]) => void;
  /** Deja la lista en el orden que dio la votación y a cada quien en su bloque. */
  alAplicar: (orden: string[], bloques: Record<string, number>) => void;
  /** Inscribe a quienes venían en los votos y no estaban; devuelve las inscripciones nuevas. */
  alInscribir: (nombres: string[]) => Jugador[];
  enParejas: boolean;
  handicap: HandicapVotacion | null;
  alTabla: (tabla: number[][]) => void;
  alActivarBloques: () => void;
}

/**
 * Ranking por votación.
 *
 * Los votos se pegan (de WhatsApp, de una hoja de cálculo o escritos a
 * mano) o se llenan en la tabla. Con ellos se arma la tabla de votaciones
 * y la de resultados; la clasificación se parte en bloques de nivel, y el
 * resultado puede quedar como el orden de la lista (la siembra) y como los
 * bloques del hándicap.
 */
export function Votacion({
  lista,
  votos,
  alCambiar,
  alAplicar,
  alInscribir,
  enParejas,
  handicap,
  alTabla,
  alActivarBloques,
}: Props) {
  const [texto, setTexto] = useState("");
  const [avisos, setAvisos] = useState<string[]>([]);
  const [hecho, setHecho] = useState("");
  /** Nombres de los votos que no están en la lista, y los que el juez desmarcó. */
  const [pendientes, setPendientes] = useState<string[]>([]);
  const [quitados, setQuitados] = useState<string[]>([]);
  const [kElegido, setK] = useState<number | null>(null);

  const n = lista.length;
  const ids = useMemo(() => new Set(lista.map((j) => j.id)), [lista]);
  const conteo = useMemo(() => contarVotos(lista, votos), [lista, votos]);
  const bloquesYa = Math.max(0, ...lista.map((j) => j.bloque ?? 0));
  const valores = useMemo(() => conteo.filas.map((f) => f.puntos), [conteo]);
  // El número de bloques es un hiperparámetro: se proponen dos y el juez elige
  const propuestas = useMemo(() => proponerBloques(valores), [valores]);
  const k = Math.max(1, Math.min(n || 1, kElegido ?? (bloquesYa >= 2 ? bloquesYa : propuestas[0].k)));
  const bloques = useMemo(() => partirEnBloques(valores, k), [valores, k]);
  const siluetaK = silueta(valores, bloques);
  const bloqueDe = new Map(conteo.filas.map((f, i) => [f.id, bloques[i]]));
  const aplicado =
    conteo.validos > 0 && conteo.filas.every((f, i) => f.id === lista[i]?.id && lista[i].bloque === bloques[i]);
  // Con empates en puntos pueden salir menos bloques de los pedidos
  const kReal = Math.max(1, ...bloques);
  const integrantes = Array.from({ length: kReal }, (_, b) =>
    conteo.filas.filter((_, i) => bloques[i] === b + 1).map((f) => nombreDe(lista.find((j) => j.id === f.id))),
  );
  const porBloques = !!handicap?.activo && handicap.base === "bloque";

  const lugares = Array.from({ length: n }, (_, i) => i);
  // Con muchos inscritos, contar cada lugar no cabe: bastan los tres primeros
  const columnas = n <= 8 ? n : 3;
  const nom = (id: string) => nombreDe(lista.find((j) => j.id === id));

  const ej = n >= 3 ? lista.slice(0, 3).map((j) => j.nombre) : ["Juan", "Carlo", "David"];
  const resto = n > 3 ? ", …" : "";
  const ejemplo = `${ej[0]}: ${ej[1]}, ${ej[0]}, ${ej[2]}${resto}\n${ej[1]}: ${ej[0]}, ${ej[1]}, ${ej[2]}${resto}\n${ej[2]}: ${ej[1]}, ${ej[0]}, ${ej[2]}${resto}`;

  /** El voto como renglón de la tabla: un lugar por columna, "" si está vacío. */
  const filaDe = (v: Voto) => lugares.map((i) => (ids.has(v.orden[i] ?? "") ? v.orden[i] : ""));

  /** Lee lo pegado contra una lista y lo pasa a la tabla. */
  function leerContra(l: Jugador[], inscritos: number) {
    const r = leerVotos(texto, l);
    const u = sumarVotos(votos, r.votos);
    alCambiar(u.votos);
    setAvisos([...r.avisos, ...u.reemplazados.map((q) => `${q} ya tenía un voto en la tabla: quedó el nuevo.`)]);
    const pasaron = r.votos.length === 1 ? "pasó 1 voto" : `pasaron ${r.votos.length} votos`;
    setHecho(
      inscritos
        ? `Se ${inscritos === 1 ? "inscribió 1" : `inscribieron ${inscritos}`} y ${pasaron} a la tabla.`
        : r.votos.length
          ? `${pasaron[0].toUpperCase()}${pasaron.slice(1)} a la tabla.`
          : "",
    );
    setPendientes([]);
    setQuitados([]);
    if (r.votos.length) setTexto("");
  }

  function pasar() {
    const r = leerVotos(texto, lista);
    // Con nombres que no están, primero se pregunta: un voto a medias no sirve
    if (r.desconocidos.length) {
      setPendientes(r.desconocidos);
      setQuitados([]);
      setHecho("");
      setAvisos(r.avisos);
      return;
    }
    leerContra(lista, 0);
  }

  function inscribir() {
    const nombres = pendientes.filter((x) => !quitados.includes(x));
    const nuevos = nombres.length ? alInscribir(nombres) : [];
    leerContra([...lista, ...nuevos], nuevos.length);
  }

  function cambiar(i: number, v: Voto) {
    alCambiar(votos.map((x, j) => (j === i ? v : x)));
    setHecho("");
  }

  /** Pone a alguien en un lugar; si ya estaba en otro del mismo voto, se intercambian. */
  function elegir(i: number, lugar: number, id: string) {
    const fila = filaDe(votos[i]);
    const antes = id ? fila.indexOf(id) : -1;
    if (antes >= 0 && antes !== lugar) fila[antes] = fila[lugar];
    fila[lugar] = id;
    cambiar(i, { ...votos[i], orden: fila });
  }

  return (
    <div className="votacion">
      <h3 className="sub-titulo">Ranking por votación</h3>
      <p className="sub">
        Cada quien da su orden, del mejor al peor. Con {n || "n"} en la lista, el primero de cada voto recibe {n || "n"}{" "}
        puntos, el segundo uno menos, y así hasta el último, que recibe 1. Va arriba quien más suma; si dos empatan,
        gana el que más votantes pusieron arriba del otro.
      </p>

      <label className="f">
        <span>
          Pega los votos: un renglón por voto («Juan: Carlo, Juan, David»), o el nombre de quien vota y debajo su
          lista, como llegan por WhatsApp. Si aún no están inscritos, se inscriben desde aquí.
        </span>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={ejemplo} />
      </label>
      <div className="fila">
        <button className="btn leve" disabled={!texto.trim()} onClick={pasar}>
          Pasar a la tabla
        </button>
      </div>

      {pendientes.length > 0 && (
        <div className="nota vot-nuevos">
          <div>
            <p>
              {pendientes.length === 1 ? "Este nombre no está" : "Estos nombres no están"} en la lista. Marca a quién
              inscribir; si alguno es el mismo escrito de otra forma, desmárcalo y corrígelo en el texto.
            </p>
            <div className="vot-chips">
              {pendientes.map((x) => (
                <label key={x} className="vot-chip">
                  <input
                    type="checkbox"
                    checked={!quitados.includes(x)}
                    onChange={(e) =>
                      setQuitados((q) => (e.target.checked ? q.filter((y) => y !== x) : [...q, x]))
                    }
                  />
                  {x}
                </label>
              ))}
            </div>
            <div className="fila">
              <button className="btn" onClick={inscribir}>
                {quitados.length === pendientes.length ? "Pasar sin inscribir a nadie" : "Inscribir y pasar a la tabla"}
              </button>
            </div>
          </div>
        </div>
      )}
      {hecho && <p className="nota bien">{hecho}</p>}
      {avisos.length > 0 && (
        <div className="nota">
          <ul className="vot-avisos">
            {avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {n > 0 && (
        <>
          <h3 className="sub-titulo vot-titulo">Tabla de votaciones</h3>
          {votos.length ? (
            <div className="vot-desliza">
              <table className="tab-pos vot-tabla">
                <thead>
                  <tr>
                    <th>Vota</th>
                    {lugares.map((i) => (
                      <th key={i}>{i + 1}.º</th>
                    ))}
                    <th aria-label="Quitar" />
                  </tr>
                </thead>
                <tbody>
                  {votos.map((v, i) => {
                    const fila = filaDe(v);
                    const quien = v.quien.trim() || `votante ${i + 1}`;
                    return (
                      <tr key={i}>
                        <td>
                          <input
                            value={v.quien}
                            placeholder={`Votante ${i + 1}`}
                            aria-label="Quién vota"
                            onChange={(e) => cambiar(i, { ...v, quien: e.target.value })}
                          />
                        </td>
                        {lugares.map((lugar) => (
                          <td key={lugar}>
                            <select
                              value={fila[lugar]}
                              aria-label={`${lugar + 1}.º lugar de ${quien}`}
                              onChange={(e) => elegir(i, lugar, e.target.value)}
                            >
                              <option value="">—</option>
                              {lista.map((j) => (
                                <option key={j.id} value={j.id}>
                                  {nombreDe(j)}
                                </option>
                              ))}
                            </select>
                          </td>
                        ))}
                        <td>
                          <button
                            className="x"
                            title={`Quitar el voto de ${quien}`}
                            onClick={() => alCambiar(votos.filter((_, j) => j !== i))}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="vacio">Todavía no hay votos. Pégalos arriba o agrega un votante.</p>
          )}
          <div className="fila">
            <button className="btn leve" onClick={() => alCambiar([...votos, { quien: "", orden: [] }])}>
              Agregar votante
            </button>
            {votos.length > 0 && (
              <button
                className="btn grave"
                onClick={() => {
                  if (!confirm("Se borran todos los votos de la tabla. ¿Seguir?")) return;
                  alCambiar([]);
                  setAvisos([]);
                  setHecho("");
                }}
              >
                Borrar los votos
              </button>
            )}
          </div>
        </>
      )}

      {conteo.validos > 0 && (
        <>
          <h3 className="sub-titulo vot-titulo">Resultados</h3>
          <p className="sub">
            {conteo.validos === 1 ? "Cuenta 1 voto." : `Cuentan ${conteo.validos} votos.`} Las columnas 1.º, 2.º… dicen
            cuántos votos lo pusieron en ese lugar. Los bloques se cortan donde hay saltos grandes de puntos, nunca entre
            dos con los mismos.
          </p>
          <div className="fila vot-propuestas">
            <span className="vot-estado">Bloques propuestos:</span>
            {propuestas.map((pr) => (
              <button
                key={pr.k}
                className={pr.k === k ? "btn" : "btn leve"}
                title={`Silueta ${pr.silueta.toFixed(2)}`}
                onClick={() => setK(pr.k)}
              >
                {pr.k} bloques ·{" "}
                {pr.motivo === "silueta" ? "mejor separados" : pr.motivo === "regla" ? "unos tres por bloque" : "segunda mejor separación"}
              </button>
            ))}
          </div>
          <p className="sub">
            Puedes poner otro número: por ejemplo 2 en un torneo de intermedios contra principiantes. Con {k}{" "}
            {k === 1 ? "bloque" : "bloques"}, la silueta es {siluetaK.toFixed(2)} (más cerca de 1, bloques más claros).
          </p>
          <div className="campos vot-k">
            <label className="f">
              <span>Bloques de nivel</span>
              <input
                type="number"
                min={1}
                max={n}
                value={k}
                onChange={(e) => setK(Math.max(1, Math.min(n, Math.floor(Number(e.target.value) || 1))))}
              />
            </label>
          </div>
          <div className="vot-desliza">
            <table className="tab-pos vot-res">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{enParejas ? "Pareja" : "Jugador"}</th>
                  <th>Puntos</th>
                  {lugares.slice(0, columnas).map((i) => (
                    <th key={i} title={`Votos que lo pusieron en ${i + 1}.º lugar`}>
                      {i + 1}.º
                    </th>
                  ))}
                  <th title="Lugar promedio en los votos">Prom.</th>
                  <th>Bloque</th>
                  <th className="izq">Desempate</th>
                </tr>
              </thead>
              <tbody>
                {conteo.filas.map((f, i) => (
                  <tr key={f.id} className={i > 0 && bloques[i] !== bloques[i - 1] ? "corte" : undefined}>
                    <td>{f.lugar}</td>
                    <td className="j">{nom(f.id)}</td>
                    <td className="p">{f.puntos}</td>
                    {f.veces.slice(0, columnas).map((c, j) => (
                      <td key={j}>{c || "·"}</td>
                    ))}
                    <td>{f.promedio === null ? "—" : f.promedio.toFixed(1)}</td>
                    <td className="p">{bloqueDe.get(f.id)}</td>
                    <td className={f.empate ? "izq des empate" : "izq des"}>{f.desempate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="fila">
            <button
              className="btn"
              disabled={aplicado}
              onClick={() => {
                alAplicar(
                  conteo.filas.map((f) => f.id),
                  Object.fromEntries(bloqueDe),
                );
                setAvisos([]);
                setHecho("");
              }}
            >
              Usar este orden y estos bloques
            </button>
          </div>
          {aplicado && (
            <p className="nota bien">
              La lista ya está en el orden de la votación, que es la siembra, y cada quien tiene su bloque.
            </p>
          )}

          {handicap && kReal >= 2 && (
            <>
              <h3 className="sub-titulo vot-titulo">Hándicap entre bloques</h3>
              <p className="sub">
                Los del mismo bloque juegan sin ventaja. Entre bloques, el de abajo empieza cada set con los puntos de
                esta tabla. Lo sugerido sube cada vez menos con la distancia y empieza bajo, porque la votación es una
                primera estimación: ajústalo antes de empezar si conoces a los jugadores.
              </p>
              <TablaBloques
                k={kReal}
                tabla={handicap.tabla}
                meta={handicap.meta}
                tope={handicap.tope}
                integrantes={integrantes}
                alCambiar={alTabla}
              />
              {!porBloques && (
                <div className="fila">
                  <button className="btn" onClick={alActivarBloques}>
                    Jugar con hándicap por bloques
                  </button>
                  <span className="vot-estado">
                    {handicap.activo
                      ? `Hoy el hándicap sale ${handicap.base === "lugar" ? "del lugar en la lista" : "del ranking"}.`
                      : "Hoy el torneo no tiene hándicap."}
                  </span>
                </div>
              )}
              {porBloques && !aplicado && (
                <p className="nota">
                  El hándicap ya va por bloques, pero los bloques de la lista no son estos todavía: usa el botón de
                  arriba.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
