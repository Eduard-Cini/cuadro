import { useState } from "react";
import type { Credencial, Torneo } from "../nucleo";
import { huella } from "../nucleo";
import { darDeAlta, probar } from "../red";
import type { Conexion } from "../red";

interface Props {
  conexion: Conexion;
  relevo: { url: string };
  alGuardar: (url: string) => void;
  credencial: Credencial | null;
  alCredencial: (c: Credencial | null) => void;
  /** Torneo del relevo que no casa con el de este dispositivo. */
  choque?: Torneo | null;
  alAdoptar?: () => void;
  /** El juez ve la explicación larga; el árbitro, la corta. */
  detallado?: boolean;
}

const ESTADOS: Record<string, string> = {
  apagado: "Trabajando sola, sin red",
  conectando: "Conectando…",
  conectado: "En red con el relevo",
  caido: "El relevo no responde",
  "sin-credencial": "Conectada, pero sin darse de alta",
};

/**
 * Conexión con el relevo de la red local, y alta del dispositivo.
 *
 * Estar conectado y estar dado de alta son dos cosas distintas a
 * propósito. Cualquiera en la red puede *leer* el torneo —está proyectado
 * en la pared del gimnasio— pero para *escribir* hace falta un código que
 * solo reparte el juez, y que ata este aparato a una persona y a una mesa.
 *
 * Todo esto es opcional: sin dirección, el dispositivo funciona igual y
 * guarda en su propia memoria. Un torneo entero se puede llevar con la red
 * apagada y pasar los resultados al final con un archivo.
 */
export function Conectar({
  conexion,
  relevo,
  alGuardar,
  credencial,
  alCredencial,
  choque,
  alAdoptar,
  detallado,
}: Props) {
  const [url, setUrl] = useState(relevo.url);
  const [codigo, setCodigo] = useState("");
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const alta = async () => {
    setOcupado(true);
    setNota("Dando de alta…");
    const destino = url || relevo.url;
    const r = await darDeAlta(destino, codigo);
    setNota(r.detalle);
    if (r.ok && r.credencial) {
      alGuardar(destino);
      alCredencial(r.credencial);
      setCodigo("");
    }
    setOcupado(false);
  };

  return (
    <div className="sec">
      <h2>Conexión</h2>
      <p className="sub">
        {detallado
          ? "La computadora que está en la pantalla del gimnasio corre el relevo. Las tablets se conectan a su dirección por el Wi-Fi local: no hace falta internet."
          : "Escribe la dirección y el código que te dio el juez. Si no los tienes, puedes trabajar sin red y entregar los resultados al final."}
      </p>

      <div className={`estado-red ${conexion.estado}`}>
        <i />
        <b>{ESTADOS[conexion.estado] ?? conexion.estado}</b>
        {conexion.estado === "conectado" && (
          <span>
            {conexion.recibidos} recibidos · {conexion.enviados} enviados
            {conexion.negados > 0 && <b className="mal"> · {conexion.negados} rechazados</b>}
          </span>
        )}
        {conexion.error && <span className="mal">{conexion.error}</span>}
      </div>

      {/* ---------- identidad ---------- */}
      {credencial ? (
        <div className="credencial">
          <div>
            <span className="eti">Dado de alta como</span>
            <b>{credencial.nombre}</b>
            <span className="met">
              {credencial.papel} · huella {huella(credencial.token)}
            </span>
          </div>
          <button
            className="btn leve"
            onClick={() => {
              if (!confirm("Este aparato dejará de poder mandar resultados. ¿Seguir?")) return;
              alCredencial(null);
              setNota("Credencial borrada. Pide otro código al juez para volver a entrar.");
            }}
          >
            Salir de la red
          </button>
        </div>
      ) : (
        <div className="alta">
          <p className="sub">
            {detallado
              ? "El relevo imprime un código al arrancar. Escríbelo aquí una sola vez y esta tablet queda como mesa de control."
              : "El juez te da un código de seis letras. Sirve una sola vez y te identifica: lo que anotes quedará a tu nombre."}
          </p>
          <div className="campos">
            <label className="f">
              <span>Dirección del relevo</span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://192.168.1.50:8080"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
              />
            </label>
            <label className="f">
              <span>Código de alta</span>
              <input
                className="codigo"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && void alta()}
                placeholder="K7M2QX"
                maxLength={8}
                autoCapitalize="characters"
                autoCorrect="off"
              />
            </label>
          </div>
          <div className="fila">
            <button className="btn" disabled={ocupado || !codigo.trim()} onClick={() => void alta()}>
              Darme de alta
            </button>
            <button
              className="btn leve"
              disabled={ocupado}
              onClick={async () => {
                setOcupado(true);
                const r = await probar(url);
                setNota(r.detalle);
                if (r.ok) alGuardar(url);
                setOcupado(false);
              }}
            >
              Solo probar la dirección
            </button>
          </div>
        </div>
      )}

      {choque && (
        <div className="nota mal">
          <div>
            <b>El relevo lleva otro torneo: «{choque.nombre || "sin nombre"}».</b>
            <div>
              El del relevo tiene {choque.jugadores.length} jugadores y {choque.partidos.length} partidos. Este
              dispositivo trabaja con otro distinto, y dos torneos no se mezclan solos. Si el bueno es el del relevo,
              cámbiate; si el bueno es el de aquí, desconéctate y avisa al juez antes de seguir anotando.
            </div>
            {alAdoptar && (
              <div className="fila">
                <button className="btn grave" onClick={alAdoptar}>
                  Usar el torneo del relevo
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="fila">
        {relevo.url && (
          <button
            className="btn leve"
            onClick={() => {
              setUrl("");
              alGuardar("");
              setNota("Desconectado. El dispositivo sigue funcionando solo.");
            }}
          >
            Trabajar sin red
          </button>
        )}
        {conexion.estado !== "apagado" && (
          <button className="btn leve" onClick={conexion.sincronizar}>
            Sincronizar ahora
          </button>
        )}
      </div>

      {nota && <p className="nota">{nota}</p>}

      {detallado && (
        <details className="ayuda">
          <summary>Cómo se levanta la red en el gimnasio</summary>
          <ol>
            <li>Conecta la computadora y las tablets al mismo Wi-Fi. Sirve un router sin internet o el punto de acceso de un teléfono.</li>
            <li>
              En la computadora, dentro de la carpeta del proyecto: <code>npm run torneo</code>.
            </li>
            <li>El relevo imprime la dirección y el código de la mesa de control. Escríbelos aquí.</li>
            <li>
              Abre <code>/entrar</code> en la pantalla del gimnasio: los árbitros escanean el código de ahí en vez de
              teclear la dirección.
            </li>
            <li>Da de alta a cada árbitro desde «Árbitros», con su propio código.</li>
            <li>Si el Wi-Fi se cae, nadie se detiene: cada tablet sigue anotando y todo se pone al día al volver.</li>
          </ol>
        </details>
      )}
    </div>
  );
}
