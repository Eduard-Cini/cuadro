import { tablaSugerida, ventajaEntreBloques } from "../nucleo";

interface Props {
  /** Cuántos bloques hay. */
  k: number;
  /** La tabla que fijó el juez; lo que falte se toma de lo sugerido. */
  tabla: number[][] | undefined;
  /** Puntos por set: lo sugerido se escala con ellos. */
  meta: number;
  /** Ventaja máxima por set. */
  tope: number;
  /** Quiénes están en cada bloque, para leer la tabla sin ir a la lista. */
  integrantes?: string[][];
  alCambiar: (tabla: number[][]) => void;
}

/**
 * Cuántos puntos da cada bloque a cada uno de los de abajo.
 *
 * Es una tabla triangular: la fila es el bloque que da la ventaja y la
 * columna el que la recibe. La diagonal no aparece porque entre los del
 * mismo bloque no hay ventaja. El juez la ajusta antes de empezar; lo que
 * no toque queda como lo sugerido.
 */
export function TablaBloques({ k, tabla, meta, tope, integrantes, alCambiar }: Props) {
  if (k < 2) return <p className="vacio">Con un solo bloque nadie da ventaja.</p>;

  const filas = Array.from({ length: k - 1 }, (_, i) => i + 1);
  const columnas = Array.from({ length: k - 1 }, (_, j) => j + 2);
  const valor = (i: number, j: number) => ventajaEntreBloques(tabla, i, j, meta);
  const completa = () =>
    Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (j > i ? valor(i + 1, j + 1) : 0)));
  const sugerida = tablaSugerida(k, meta);
  const esLaSugerida = completa().every((f, i) => f.every((v, j) => v === sugerida[i][j]));

  function poner(i: number, j: number, v: string) {
    const t = completa();
    t[i - 1][j - 1] = Math.max(0, Math.min(9, Math.floor(Number(v) || 0)));
    alCambiar(t);
  }

  return (
    <div className="tabla-bloques">
      <div className="vot-desliza">
        <table className="tab-pos tb-bloques">
          <thead>
            <tr>
              <th>Da ventaja</th>
              {columnas.map((j) => (
                <th key={j}>Recibe el bloque {j}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((i) => (
              <tr key={i}>
                <th scope="row">
                  Bloque {i}
                  {integrantes?.[i - 1]?.length ? <small>{integrantes[i - 1].join(", ")}</small> : null}
                </th>
                {columnas.map((j) => (
                  <td key={j}>
                    {j > i ? (
                      <>
                        <input
                          type="number"
                          min={0}
                          max={9}
                          value={valor(i, j)}
                          aria-label={`Puntos que da el bloque ${i} al bloque ${j}`}
                          onChange={(e) => poner(i, j, e.target.value)}
                        />
                        {valor(i, j) > tope && <small>se queda en {tope}, el máximo</small>}
                      </>
                    ) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {integrantes?.[k - 1]?.length ? (
        <p className="sub tb-ultimo">
          Bloque {k}: {integrantes[k - 1].join(", ")}
        </p>
      ) : null}
      <p className="sub">
        Cada número es con cuántos puntos empieza cada set el del bloque de la columna cuando juega contra el de la
        fila. Entre los del mismo bloque no hay ventaja.
      </p>
      {!esLaSugerida && (
        <div className="fila">
          <button className="btn leve" onClick={() => alCambiar(sugerida)}>
            Volver a lo sugerido
          </button>
        </div>
      )}
    </div>
  );
}
