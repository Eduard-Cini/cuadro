import { useCallback, useEffect, useState } from "react";
import type { Conexion, Dispositivo, Rechazo } from "../red";
import { verAccesos } from "../red";

interface Props {
  conexion: Conexion;
}

const cuando = (ms: number): string => {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  return `hace ${Math.floor(min / 60)} h`;
};

/**
 * Quién está dado de alta y qué se ha rechazado.
 *
 * La lista de rechazos no es decoración: es lo que convierte un fallo
 * silencioso en algo que el juez puede ver. Si un árbitro se queja de que
 * su marcador no llega, aquí sale si es que está mandando a una mesa que
 * no es la suya, o si nunca llegó a darse de alta. Y si alguien de la red
 * intenta colar resultados, también sale.
 */
export function Accesos({ conexion }: Props) {
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [rechazos, setRechazos] = useState<Rechazo[]>([]);
  const [nota, setNota] = useState("");

  const cargar = useCallback(async () => {
    const r = await verAccesos(conexion.pedir);
    setDispositivos(r.dispositivos);
    setRechazos(r.rechazos);
    setNota(r.ok ? "" : r.detalle);
  }, [conexion.pedir]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="sec">
      <h2>Quién está en la red</h2>
      <p className="sub">
        Los aparatos dados de alta y lo que el relevo ha devuelto. Un árbitro solo puede escribir en los partidos de su
        mesa; aceptar y corregir es cosa de esta mesa de control.
      </p>
      <div className="fila">
        <button className="btn leve" onClick={() => void cargar()}>
          Actualizar
        </button>
      </div>

      {nota && <p className="nota">{nota}</p>}

      <ul className="lista">
        {dispositivos.map((d) => (
          <li key={d.quien} className="item">
            <span className={`idx papel ${d.papel}`}>{d.papel === "juez" ? "J" : d.papel === "arbitro" ? "A" : "P"}</span>
            <span className="nom">{d.nombre}</span>
            <span className="met">
              {d.peticiones} envíos · visto {cuando(d.visto)}
            </span>
          </li>
        ))}
      </ul>
      {!dispositivos.length && !nota && <p className="vacio">Todavía no se ha dado de alta nadie.</p>}

      {rechazos.length > 0 && (
        <details className="ayuda" open>
          <summary>Rechazados ({rechazos.length})</summary>
          <ul className="espera">
            {rechazos.map((r, i) => (
              <li key={i}>
                <b>{r.motivo}</b>
                <em>
                  {r.detalle} · {cuando(r.ts)}
                </em>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
