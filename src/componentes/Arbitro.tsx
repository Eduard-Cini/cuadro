import { useState } from "react";
import { reducir, setsDe } from "../nucleo";
import type { Credencial, Partido, Torneo } from "../nucleo";
import type { Conexion } from "../red";
import { Conectar } from "./Conectar";
import { TarjetaPartido } from "./TarjetaPartido";

interface Props {
  t: Torneo;
  arbitroId: string | null;
  mesa: number | null;
  alIdentificarse: (arbitroId: string | null, mesa: number | null) => void;
  alAbrir: (id: string) => void;
  conexion: Conexion;
  relevo: { url: string };
  alGuardarRelevo: (url: string) => void;
  choque: Torneo | null;
  alAdoptar: () => void;
  credencial: Credencial | null;
  alCredencial: (c: Credencial | null) => void;
}

/** El orden en que un árbitro quiere ver su cola. */
const PESO: Record<string, number> = {
  "en-juego": 0,
  descanso: 1,
  "sin-iniciar": 2,
  "por-validar": 3,
  validado: 4,
};

/**
 * Vista del árbitro de mesa.
 *
 * A propósito no tiene configuración, ni sorteo, ni tablas, ni los
 * partidos de las demás mesas: solo lo suyo y el marcador. Un árbitro
 * dirigiendo un partido no debería poder tocar el torneo por accidente, y
 * tampoco debería tener que buscar su partido entre los ochenta que hay.
 */
export function Arbitro({
  t,
  arbitroId,
  mesa,
  alIdentificarse,
  alAbrir,
  conexion,
  relevo,
  alGuardarRelevo,
  choque,
  alAdoptar,
  credencial,
  alCredencial,
}: Props) {
  const [ajustes, setAjustes] = useState(false);
  const yo = t.arbitros.find((a) => a.id === arbitroId) ?? null;
  const miMesa = yo?.mesa ?? mesa;

  const setsPara = (p: Partido) => setsDe(t, p);
  const mios =
    miMesa == null
      ? []
      : t.partidos
          .filter((p) => p.mesa === miMesa && p.aId && p.bId)
          .sort((x, y) => {
            const fx = PESO[reducir(x, setsPara(x)).fase] ?? 9;
            const fy = PESO[reducir(y, setsPara(y)).fase] ?? 9;
            return fx - fy || x.orden - y.orden;
          });

  const porJugar = mios.filter((p) => !reducir(p, setsPara(p)).terminado);
  const cerrados = mios.filter((p) => reducir(p, setsPara(p)).terminado);

  /* Sin identificarse no se ve nada: es lo primero que pide la pantalla. */
  if (!yo && miMesa == null) {
    return (
      <div>
        <div className="sec">
          <h2>¿Quién eres?</h2>
          <p className="sub">
            Elige tu nombre y verás solo los partidos de tu mesa. La lista la carga el juez desde la mesa de control.
          </p>
          {t.arbitros.length > 0 ? (
            <ul className="lista elegible">
              {[...t.arbitros]
                .sort((a, b) => a.mesa - b.mesa)
                .map((a) => (
                  <li key={a.id}>
                    <button className="item boton" onClick={() => alIdentificarse(a.id, a.mesa)}>
                      <span className="idx">{a.mesa}</span>
                      <span className="nom">{a.nombre}</span>
                      <span className="met">mesa {a.mesa}</span>
                    </button>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="vacio">
              Todavía no hay árbitros cargados. Conéctate al relevo para recibir la lista, o elige tu mesa a mano aquí
              abajo.
            </p>
          )}

          <h3 className="sub-titulo">O elige tu mesa</h3>
          <div className="mesabtns">
            {Array.from({ length: Math.max(1, t.mesas) }, (_, i) => i + 1).map((m) => (
              <button key={m} className="mesabtn" onClick={() => alIdentificarse(null, m)}>
                {m}
              </button>
            ))}
          </div>
        </div>

        <Conectar
            conexion={conexion}
            relevo={relevo}
            alGuardar={alGuardarRelevo}
            choque={choque}
            alAdoptar={alAdoptar}
            credencial={credencial}
            alCredencial={alCredencial}
          />
      </div>
    );
  }

  return (
    <div>
      <div className="sec compacta">
        <div className="fila entre">
          <div>
            <h2>Mesa {miMesa}</h2>
            <p className="sub">
              {yo ? yo.nombre : "Sin identificar"} ·{" "}
              {porJugar.length ? `${porJugar.length} por jugar` : "nada pendiente ahora mismo"}
            </p>
          </div>
          <div className="fila">
            {/* Quien eligió su mesa a mano puede corregirse aquí mismo. A
                quien entró con un código se la asignó el juez, y cambiarla
                por su cuenta rompería la correspondencia que el relevo
                usa para aceptarle los resultados. */}
            {!credencial && (
              <button className="btn leve" onClick={() => alIdentificarse(null, null)}>
                Cambiar de mesa
              </button>
            )}
            <button className="btn leve" onClick={() => setAjustes((v) => !v)}>
              {ajustes ? "Ocultar" : "Ajustes"}
            </button>
          </div>
        </div>
      </div>

      {ajustes && (
        <>
          <div className="sec">
            <h2>Identidad</h2>
            {credencial ? (
              <>
                <p className="sub">
                  Entraste con un código como <b>{credencial.nombre}</b>, y tu mesa la asigna la mesa de control. Si te
                  cambian de mesa, el juez la cambia allí y aquí se actualiza solo.
                </p>
                <p className="sub">
                  Si este aparato ya no es tuyo, sal de la red desde abajo y pide un código nuevo cuando vuelvas.
                </p>
              </>
            ) : (
              <>
                <p className="sub">
                  Elegiste la mesa {miMesa} a mano. Puedes cambiarla cuando quieras.
                </p>
                <div className="fila">
                  <button className="btn leve" onClick={() => alIdentificarse(null, null)}>
                    No soy {yo ? yo.nombre : `el de la mesa ${miMesa}`}
                  </button>
                </div>
              </>
            )}
          </div>
          <Conectar
            conexion={conexion}
            relevo={relevo}
            alGuardar={alGuardarRelevo}
            choque={choque}
            alAdoptar={alAdoptar}
            credencial={credencial}
            alCredencial={alCredencial}
          />
        </>
      )}

      <div className="sec compacta">
        <h3 className="sub-titulo">Por jugar</h3>
      </div>
      {porJugar.map((p, i) => (
        <TarjetaPartido key={p.id} t={t} p={p} alAbrir={alAbrir} numero={i + 1} />
      ))}
      {!porJugar.length && (
        <p className="vacio">
          {t.partidos.length
            ? "El juez todavía no te ha asignado partidos. En cuanto lo haga aparecerán aquí."
            : "El torneo todavía no tiene partidos."}
        </p>
      )}

      {cerrados.length > 0 && (
        <>
          <div className="sec compacta">
            <h3 className="sub-titulo">Ya terminados</h3>
            <p className="sub">
              {t.validacionObligatoria
                ? "Los que dicen «por validar» están esperando a la mesa de control."
                : "Estos ya cuentan para la tabla."}
            </p>
          </div>
          {cerrados.map((p) => (
            <TarjetaPartido key={p.id} t={t} p={p} alAbrir={alAbrir} />
          ))}
        </>
      )}
    </div>
  );
}
