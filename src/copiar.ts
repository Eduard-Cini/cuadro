/**
 * Copia un texto al portapapeles. Devuelve si lo logró.
 *
 * `navigator.clipboard` solo existe en páginas seguras (https o
 * localhost). Servida por el relevo en la red del gimnasio no lo está,
 * así que se intenta también el método viejo; si los dos fallan, quien
 * llama tiene que enseñar el texto para copiarlo a mano.
 */
export async function copiar(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* sin permiso: se intenta el otro camino */
  }
  try {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** Enlace que abre WhatsApp con el texto ya escrito; se elige el chat allá. */
export const enlaceWhatsApp = (texto: string): string => `https://wa.me/?text=${encodeURIComponent(texto)}`;
