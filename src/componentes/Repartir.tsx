import { useEffect, useMemo, useState } from "react";
import type { Conexion } from "../red";
import { pedirInvitacion } from "../red";
import type { Arbitro, Credencial } from "../nucleo";
import { CodigoQr } from "./Qr";

interface Props {
  /** Dirección desde la que se sirve la aplicación. */
  origen: string;
  arbitros: Arbitro[];
  conexion: Conexion;
  credencial: Credencial | null;
  /** En la pantalla del gimnasio no se enseñan códigos de alta. */
  publico?: boolean;
  alSalir?: () => void;
}

/**
 * La página que se deja puesta mientras llegan los árbitros.
 *
 * Repartir la aplicación es el primer cuello de botella real de la
 * jornada: teclear `http://192.168.1.108:8099` en seis tablets con teclado
 * en pantalla son seis oportunidades de equivocarse, y cada dígito mal
 * puesto acaba en el juez levantándose de la mesa.
 *
 * Con la cámara, el árbitro apunta y entra. Y si el código lleva dentro su
 * alta, entra ya identificado y con su mesa asignada, sin elegir nada de
 * una lista.
 */
export function Repartir({ origen, arbitros, conexion, credencial, publico, alSalir }: Props) {
  const [codigos, setCodigos] = useState<Record<string, string>>({});
  const [nota, setNota] = useState("");

  const propia = useMemo(() => origen.replace(/\/+$/, ""), [origen]);
  const [base, setBase] = useState(propia);
  const [aviso, setAviso] = useState("");

  /*
   * La dirección del código QR no puede ser la que ve esta pantalla.
   *
   * La página de reparto se abre en la computadora del juez, que se ve a sí
   * misma como «localhost». Un QR que diga localhost manda al teléfono a su
   * propio aparato, donde no hay nada: reconoce el código y no lleva a
   * ninguna parte. Hay que preguntarle al relevo por qué dirección se le
   * alcanza desde fuera.
   */
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await fetch(`${propia}/api/salud`);
        const d = await r.json();
        if (!vivo) return;
        const ip = (d.direcciones ?? [])[0];
        if (ip) setBase(`http://${ip}:${d.puerto ?? 8080}`);
        else if (/localhost|127\.0\.0\.1/.test(propia))
          setAviso("Esta computadora no aparece en ninguna red. Conéctala al Wi-Fi para poder repartir la aplicación.");
      } catch {
        if (vivo && /localhost|127\.0\.0\.1/.test(propia))
          setAviso("No se pudo consultar la dirección de red del relevo. El código de abajo solo sirve en esta misma computadora.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [propia]);

  const enRed = conexion.estado === "conectado" && credencial?.papel === "juez";

  async function invitar(a: Arbitro) {
    const r = await pedirInvitacion(conexion.pedir, a.id, a.nombre);
    if (r.ok && r.codigo) setCodigos((c) => ({ ...c, [a.id]: r.codigo! }));
    else setNota(r.detalle);
  }

  /* De uno en uno: las peticiones firmadas llevan un contador que no puede
     repetirse, y mandarlas a la vez las desordena. */
  async function invitarATodos() {
    for (const a of arbitros) if (!codigos[a.id]) await invitar(a);
  }

  return (
    <div className="repartir">
      <header className="rp-top">
        <div>
          <h1 className="marca">
            TT<em>orneo</em>
          </h1>
          <p className="lema">Apunta la cámara y entra</p>
        </div>
        {alSalir && (
          <button className="btn leve" onClick={alSalir}>
            Volver
          </button>
        )}
      </header>

      <section className="rp-principal">
        <CodigoQr texto={base} lado={280} claro />
        <div className="rp-texto">
          <h2>1 · Abre la aplicación</h2>
          <p>
            Escanea este código con la cámara del teléfono o de la tablet. Si no tienes cámara, escribe la dirección a
            mano:
          </p>
          <p className="rp-url">{base}</p>
          {aviso && <p className="nota mal">{aviso}</p>}
          <p className="sub">
            No hace falta internet: la aplicación la sirve esta misma computadora por el Wi-Fi del gimnasio. Si la
            cámara reconoce el código pero no abre nada, escribe la dirección a mano en el navegador: hay teléfonos que
            se niegan a seguir enlaces que no empiezan por «https».
          </p>
        </div>
      </section>

      {publico ? (
        <section className="rp-nota">
          <h2>2 · Pide tu código al juez</h2>
          <p>
            Para poder anotar resultados hace falta un código de seis letras que da la mesa de control. Identifica tu
            tablet y la deja atada a tu mesa.
          </p>
        </section>
      ) : (
        <section>
          <h2 className="sub-titulo">2 · Da de alta a cada árbitro</h2>
          <p className="sub">
            Cada código sirve una vez y caduca en un cuarto de hora. El QR lleva dentro la dirección y el código: quien
            lo escanea entra ya identificado, con su mesa puesta.
          </p>
          {enRed && arbitros.length > 1 && arbitros.some((a) => !codigos[a.id]) && (
            <div className="fila">
              <button className="btn" onClick={() => void invitarATodos()}>
                Generar los códigos de todos
              </button>
            </div>
          )}
          {!enRed && (
            <p className="nota mal">
              Esta tablet tiene que estar dada de alta como mesa de control para poder repartir códigos.
            </p>
          )}

          <div className="rp-arbitros">
            {arbitros.map((a) => {
              const codigo = codigos[a.id];
              return (
                <div key={a.id} className="rp-arb">
                  <div className="rp-quien">
                    <b>{a.nombre}</b>
                    <span>mesa {a.mesa}</span>
                  </div>
                  {codigo ? (
                    <>
                      <CodigoQr texto={`${base}/#alta=${codigo}`} lado={150} claro />
                      <div className="rp-codigo">{codigo}</div>
                    </>
                  ) : (
                    <button className="btn" disabled={!enRed} onClick={() => void invitar(a)}>
                      Generar código
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {!arbitros.length && <p className="vacio">Todavía no hay árbitros cargados en el torneo.</p>}
          {nota && <p className="nota">{nota}</p>}
        </section>
      )}
    </div>
  );
}
