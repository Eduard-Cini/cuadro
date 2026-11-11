import { useState } from "react";
import { avance, nombreDe, pasos, podio, reducir, setsDe, siguientePaso } from "../nucleo";
import type { Torneo, Vista } from "../nucleo";

interface Props {
  t: Torneo;
  enRed: boolean;
  dispositivos: number;
  alIr: (v: Vista) => void;
  alCambiarModo: (guiado: boolean) => void;
  alInforme: () => void;
}

/**
 * La guía que dice qué toca ahora.
 *
 * Ocho pestañas abiertas no le dicen a nadie por dónde empezar. Esto sí:
 * mira el estado del torneo, saca el primer paso que falta y lleva a la
 * pestaña donde se hace.
 *
 * El interruptor de modo guiado no cambia de programa ni de flujo: añade
 * el porqué de cada paso y deja ver la lista entera. Quien ya ha dirigido
 * torneos lo apaga y le queda una línea; quien dirige el primero lo deja
 * puesto y le explican por qué se siembra, por qué el resultado pasa por
 * él y por qué el cuadro cruza primeros contra segundos.
 */
export function Guia({ t, enRed, dispositivos, alIr, alCambiarModo, alInforme }: Props) {
  const [abierta, setAbierta] = useState(false);
  const paso = siguientePaso(t, enRed, dispositivos);
  const { hechos, total } = avance(t, enRed, dispositivos);
  const todos = pasos(t, enRed, dispositivos);
  const guiado = t.modoGuiado;

  const campeones = podio(t);
  const porJugar = t.partidos.filter((p) => p.aId && p.bId && !reducir(p, setsDe(t, p)).terminado).length;

  /* Se acabó: la guía deja de dirigir y pasa a cerrar la jornada. Lo que
     queda por hacer no es jugar nada, es dejar constancia de lo jugado. */
  if (campeones && porJugar === 0) {
    return (
      <div className="guia lista fin">
        <div className="guia-cab">
          <span className="guia-num">Torneo terminado</span>
          <span className="sp" />
          <label className="interruptor">
            <input type="checkbox" checked={guiado} onChange={(e) => alCambiarModo(e.target.checked)} />
            <span>Modo guiado</span>
          </label>
        </div>
        <h2 className="guia-titulo">
          Campeón: {nombreDe(t.jugadores.find((j) => j.id === campeones.campeon))}
        </h2>
        <p className="guia-que">
          Subcampeón: {nombreDe(t.jugadores.find((j) => j.id === campeones.subcampeon))}
          {campeones.terceros.length > 0 &&
            ` · Tercer lugar: ${campeones.terceros
              .map((x) => nombreDe(t.jugadores.find((j) => j.id === x)))
              .join(" y ")}`}
        </p>
        {guiado && (
          <div className="guia-porque">
            <b>Por qué</b>
            <p>
              Los dos que perdieron en semifinales comparten el tercer lugar: el reglamento no obliga a jugar un
              partido para separarlos, y en un torneo de un día ese partido nunca se juega. Antes de apagar todo,
              descarga el acta y el archivo del torneo: una vez cerrado el navegador de la mesa de control, lo único
              que queda de la jornada es lo que hayas guardado.
            </p>
          </div>
        )}
        <div className="fila">
          <button className="btn" onClick={alInforme}>
            Ver el acta e imprimirla
          </button>
          <button className="btn leve" onClick={() => alIr("cuadro")}>
            Ver la llave
          </button>
          <button className="btn leve" onClick={() => alIr("torneo")}>
            Descargar el archivo
          </button>
        </div>
      </div>
    );
  }

  /* Sin pasos pendientes el torneo está en marcha y la guía estorba. */
  if (!paso) {
    return (
      <div className="guia lista">
        <div className="guia-cab">
          <span className="guia-num">Todo listo</span>
          <span className="sp" />
          <label className="interruptor">
            <input type="checkbox" checked={guiado} onChange={(e) => alCambiarModo(e.target.checked)} />
            <span>Modo guiado</span>
          </label>
        </div>
        <p className="guia-que">
          El torneo está en marcha. Ve a <b>Mesas</b> cuando se libere una, y a <b>Resultados</b> cuando los árbitros
          vayan cerrando partidos.
        </p>
        <div className="fila">
          <button className="btn" onClick={() => alIr("mesas")}>
            Ir a Mesas
          </button>
          <button className="btn leve" onClick={() => alIr("resultados")}>
            Ir a Resultados
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={guiado ? "guia guiada" : "guia"}>
      <div className="guia-cab">
        <span className="guia-num">
          Paso {hechos + 1} de {total}
        </span>
        <span className="guia-puntos" aria-hidden="true">
          {todos.map((x) => (
            <i key={x.id} className={x.listo ? "on" : x.id === paso.id ? "aqui" : ""} />
          ))}
        </span>
        <span className="sp" />
        <label className="interruptor" title="Añade la explicación de cada paso">
          <input type="checkbox" checked={guiado} onChange={(e) => alCambiarModo(e.target.checked)} />
          <span>Modo guiado</span>
        </label>
      </div>

      <h2 className="guia-titulo">{paso.titulo}</h2>
      <p className="guia-que">{paso.queHacer}</p>
      {paso.detalle && <p className="guia-detalle">{paso.detalle}</p>}

      {guiado && (
        <div className="guia-porque">
          <b>Por qué</b>
          <p>{paso.porQue}</p>
        </div>
      )}

      <div className="fila">
        <button className="btn" onClick={() => alIr(paso.vista)}>
          {paso.titulo}
        </button>
        {guiado && (
          <button className="btn leve" onClick={() => setAbierta((v) => !v)}>
            {abierta ? "Ocultar los pasos" : "Ver todos los pasos"}
          </button>
        )}
      </div>

      {guiado && abierta && (
        <ol className="guia-todos">
          {todos.map((x) => (
            <li key={x.id} className={x.listo ? "hecho" : x.id === paso.id ? "actual" : x.bloqueado ? "espera" : ""}>
              <button className="enlace-paso" onClick={() => !x.bloqueado && alIr(x.vista)} disabled={x.bloqueado}>
                <b>{x.titulo}</b>
                <span>{x.listo ? "hecho" : x.bloqueado ? "todavía no" : x.id === paso.id ? "ahora" : "pendiente"}</span>
              </button>
              {x.id === paso.id && <p className="guia-mini">{x.porQue}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
