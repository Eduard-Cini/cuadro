import { useEffect, useRef, useState } from "react";

/**
 * Una sola pestaña trabaja a la vez.
 *
 * Dos pestañas del mismo navegador comparten el almacenamiento pero no la
 * memoria: cada una lleva su copia del torneo y cada una la guarda encima
 * de la otra. Con la mesa de control abierta dos veces —y el lanzador abre
 * una pestaña nueva cada vez que se arranca— el sorteo hecho en una
 * desaparece cuando la otra guarda, y las dos le mandan al relevo
 * versiones distintas del mismo torneo.
 *
 * La regla es la más simple que funciona: manda la última que se abrió, y
 * las anteriores se quedan en pausa hasta que alguien las recarga. No se
 * pregunta nada, porque quien acaba de abrir una pestaña es la que está
 * mirando.
 *
 * Usa BroadcastChannel y no Web Locks a propósito: los candados solo
 * existen en contextos seguros, y en las tablets la aplicación llega por
 * HTTP desde una dirección de red local.
 */
export function usePestanaUnica(activa: boolean): boolean {
  const [enPausa, setEnPausa] = useState(false);
  const yo = useRef({ id: Math.random().toString(36).slice(2), nacida: Date.now() + Math.random() });

  useEffect(() => {
    if (!activa || typeof BroadcastChannel === "undefined") return;
    const canal = new BroadcastChannel("ttorneo-pestana");
    canal.onmessage = (e: MessageEvent) => {
      const m = e.data as { id?: string; nacida?: number } | null;
      if (!m || m.id === yo.current.id || typeof m.nacida !== "number") return;
      if (m.nacida > yo.current.nacida) setEnPausa(true);
      // Una más vieja que se anuncia tarde: se le contesta para que ceda.
      else canal.postMessage(yo.current);
    };
    canal.postMessage(yo.current);
    return () => canal.close();
  }, [activa]);

  return activa && enPausa;
}
