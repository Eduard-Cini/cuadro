/** Los iconos viven en un sprite SVG que se pinta una sola vez. */
export function Sprite() {
  return (
    <svg style={{ position: "absolute", width: 0, height: 0 }} aria-hidden="true">
      <symbol id="raq" viewBox="0 0 40 40">
        <ellipse cx="16.5" cy="15" rx="13.5" ry="14.5" />
        <rect x="22" y="24" width="6.6" height="15.5" rx="3.1" transform="rotate(-45 25.3 31.7)" />
      </symbol>
      <symbol id="bola" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="6.6" />
      </symbol>
      {/* Tinta rugosa: desplaza el trazo con ruido para que las líneas
          tengan el temblor de una plumilla, no el filo de un rectángulo
          de CSS. Se aplica solo a los marcos, nunca al texto. */}
      <filter id="rugoso" x="-6%" y="-6%" width="112%" height="112%">
        <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" seed="7" result="ruido" />
        <feDisplacementMap in="SourceGraphic" in2="ruido" scale="3" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <symbol id="mesa" viewBox="0 0 40 40">
        <rect x="2" y="12" width="36" height="4" />
        <rect x="19" y="6" width="2" height="8" />
        <rect x="4" y="16" width="3" height="18" />
        <rect x="33" y="16" width="3" height="18" />
      </symbol>
    </svg>
  );
}

export function Ic({ n, className }: { n: "raq" | "bola" | "mesa"; className?: string }) {
  return (
    <svg className={className ? `ic ${className}` : "ic"} aria-hidden="true">
      <use href={`#${n}`} />
    </svg>
  );
}
