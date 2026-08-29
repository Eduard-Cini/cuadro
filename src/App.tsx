import { useCallback, useEffect, useState } from "react";
import { asignarMesas, partidoListo, propagar } from "./nucleo";
import type { Lado, Torneo } from "./nucleo";
import { LLAVE_MESA, LLAVE_ROL, cargar, escribir, guardar, leer, torneoVacio } from "./almacen";
import { Arbitro } from "./componentes/Arbitro";
import { Ic, Sprite } from "./componentes/Iconos";
import { Juez } from "./componentes/Juez";
import { Tablero } from "./componentes/Tablero";

type Rol = "juez" | "arbitro";

export default function App() {
  const [t, setT] = useState<Torneo>(() => cargar() ?? torneoVacio());
  const [rol, setRol] = useState<Rol | null>(() => (leer(LLAVE_ROL) as Rol | null) ?? null);
  const [mesa, setMesa] = useState<number | null>(() => {
    const m = leer(LLAVE_MESA);
    return m ? Number(m) : null;
  });
  const [abierto, setAbierto] = useState<string | null>(null);

  useEffect(() => {
    guardar(t);
  }, [t]);

  /**
   * Toda modificación pasa por aquí.
   *
   * La copia es profunda a propósito. Con una copia superficial, `fn`
   * mutaría los partidos del estado anterior, y como React puede invocar
   * el actualizador más de una vez con el mismo `prev`, un punto se
   * contaba dos veces. El actualizador tiene que ser puro: clonar
   * primero y mutar solo el clon.
   */
  const actualizar = useCallback((fn: (d: Torneo) => void) => {
    setT((prev) => {
      const d = structuredClone(prev) as Torneo;
      fn(d);
      return d;
    });
  }, []);

  const partido = t.partidos.find((p) => p.id === abierto) ?? null;

  const anotar = (j: Lado) => {
    if (!partido) return;
    actualizar((d) => {
      const p = d.partidos.find((x) => x.id === abierto);
      p?.eventos.push({ t: "punto", j, ts: Date.now() });
    });
  };

  const deshacer = () => {
    actualizar((d) => {
      const p = d.partidos.find((x) => x.id === abierto);
      p?.eventos.pop();
    });
  };

  /** Al cerrar el tablero suben los ganadores del cuadro y se reparten mesas. */
  const cerrar = () => {
    actualizar((d) => {
      const finales = d.partidos.filter((p) => p.etapa === "final");
      propagar(finales, d.formatoFinales);
      asignarMesas(
        finales.filter((p) => p.aId && p.bId && !partidoListo(p, d.formatoFinales)),
        d.mesas,
      );
    });
    setAbierto(null);
  };

  const elegirRol = (r: Rol) => {
    setRol(r);
    escribir(LLAVE_ROL, r);
  };

  const elegirMesa = (m: number) => {
    setMesa(m);
    escribir(LLAVE_MESA, String(m));
  };

  if (partido) {
    return (
      <>
        <Sprite />
        <Tablero t={t} p={partido} alPunto={anotar} alDeshacer={deshacer} alSalir={cerrar} />
      </>
    );
  }

  if (!rol) {
    return (
      <>
        <Sprite />
        <div id="splash" className="on">
          <div className="sp-top">
            <h1 className="marca">
              CUA<em>DRO</em>
            </h1>
            <p>¿Quién eres en este torneo?</p>
          </div>
          <div className="sp-roles">
            <button className="rol j" onClick={() => elegirRol("juez")}>
              <i className="capa trama-clara" />
              <Ic n="mesa" />
              <h3>Mesa de control</h3>
              <p>Configuras el torneo, cargas jugadores, haces el sorteo y sigues todas las mesas.</p>
            </button>
            <button className="rol t" onClick={() => elegirRol("arbitro")}>
              <i className="capa trama-clara" />
              <Ic n="raq" />
              <h3>Tablero</h3>
              <p>Eliges tu mesa y llevas el marcador. Nada más: sin configuración ni sorteos.</p>
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Sprite />
      <header className="banda">
        <div className="banda-int">
          <div>
            <h1 className="marca">
              CUA<em>DRO</em>
            </h1>
            <p className="lema">
              {rol === "juez" ? "Juez principal" : `Árbitro de mesa${mesa ? ` · mesa ${mesa}` : ""}`}
              {t.nombre ? ` · ${t.nombre}` : ""}
            </p>
          </div>
          <span className="sp" />
          <button className="rolchip" onClick={() => setRol(null)}>
            <Ic n="raq" />
            <span>{rol === "juez" ? "Mesa de control" : "Tablero"}</span>
          </button>
        </div>
      </header>
      <div id="app">

        {rol === "juez" ? (
          <Juez t={t} actualizar={actualizar} alAbrir={setAbierto} />
        ) : (
          <Arbitro t={t} mesa={mesa} alElegirMesa={elegirMesa} alAbrir={setAbierto} />
        )}
      </div>
    </>
  );
}
