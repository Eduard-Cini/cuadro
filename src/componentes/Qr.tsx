import { useMemo } from "react";
import { qrRuta } from "../nucleo";

interface Props {
  texto: string;
  /** Lado en píxeles. El QR es cuadrado. */
  lado?: number;
  claro?: boolean;
}

/**
 * Pinta un código QR como SVG.
 *
 * Con el margen de cuatro módulos que pide la norma: sin esa zona en
 * blanco alrededor, muchos lectores no encuentran el símbolo, y el fallo
 * aparece justo el día del torneo con seis árbitros esperando.
 */
export function CodigoQr({ texto, lado = 220, claro }: Props) {
  const { d, tam } = useMemo(() => qrRuta(texto), [texto]);
  const margen = 4;
  const total = tam + margen * 2;

  return (
    <svg
      className="qr"
      width={lado}
      height={lado}
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`Código QR de ${texto}`}
    >
      <rect width={total} height={total} fill={claro ? "#fff" : "var(--papel)"} />
      <g transform={`translate(${margen} ${margen})`} fill={claro ? "#000" : "var(--tinta)"}>
        <path d={d} />
      </g>
    </svg>
  );
}
