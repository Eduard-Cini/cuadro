# TTorneo

Gestor de torneos de tenis de mesa que funciona sin conexión. Se instala en las
tablets y opera un torneo completo: inscripciones, sorteo, fase de grupos, tabla
con desempates, cuadro eliminatorio, asignación de mesas, marcador y pantalla
para el público.

Proyecto de Práctica Profesional, Licenciatura en Matemática Algorítmica,
Escuela Superior de Física y Matemáticas, Instituto Politécnico Nacional.

## Tres papeles

**Mesa de control** — el juez principal configura el torneo, carga jugadores y
árbitros, hace el sorteo, arma el cuadro, aprueba a qué mesa va cada partido y
valida los resultados que mandan los árbitros.

**Tablero** — el árbitro escanea su código y ve *solo* los partidos de su mesa.
Dos zonas grandes que se tocan para anotar, deshacer, y una pantalla de descanso
entre sets. Ni configuración, ni sorteos, ni las otras mesas.

**Pantalla** — para el proyector o la televisión del gimnasio. Lo que se juega
ahora en cada mesa, la fila de los siguientes partidos con el tiempo aproximado,
y los resultados de los que ya terminaron.

## El núcleo algorítmico

La lógica vive en `src/nucleo/`, sin ninguna dependencia de la interfaz, y está
cubierta por pruebas. Son diez problemas:

| Módulo | Problema |
|---|---|
| `reglas.ts` | El estado del partido como recorrido sobre un registro de eventos |
| `clasificacion.ts` | Cascada de desempates, aplicada solo entre los empatados |
| `sorteo.ts` | Asignación con restricciones: siembra y separación por club; calendario de todos contra todos por el método del círculo |
| `handicap.ts` | Ventaja por set a partir de la diferencia de ranking |
| `cuadro.ts` | Construcción y avance de la eliminatoria |
| `asignacion.ts` | Reparto de partidos a mesas con descansos y explicación |
| `agenda.ts` | Proyección de tiempos: cada mesa como un servidor con cola |
| `sincronizacion.ts` | Unión de dos copias del torneo sin coordinación |
| `firma.ts` | SHA-256 y HMAC: identidad de cada mensaje |
| `qr.ts` | Reed–Solomon sobre GF(256) y construcción del símbolo QR |

### El registro es solo-añadir

El marcador nunca se guarda como número: se guarda la lista de eventos y el
estado se deduce recorriéndola. Nada se borra ni se reescribe —deshacer un punto
agrega un evento que lo anula— y cada evento lleva un identificador único.

De esa decisión salen tres cosas de golpe:

- **Deshacer** es agregar un evento, no quitar uno.
- **Sincronizar** es unir dos conjuntos. La unión es conmutativa, asociativa e
  idempotente, así que da igual el orden en que lleguen los eventos y da igual
  que lleguen repetidos. Sin esa propiedad habría que decidir quién manda, y en
  un gimnasio sin red eso no se puede decidir.
- **Recargar** una tablet a media final no pierde nada, ni siquiera el descanso
  entre sets.

### Lo que el sistema no decide solo

Cuando una restricción del sorteo es infactible —cinco jugadores del mismo club
en cuatro grupos— el sistema cede y **reporta qué restricción cedió**, en vez de
fallar en silencio. El sorteo por computadora usa una semilla que queda escrita
en el acta: con la misma semilla el sorteo se repite idéntico, que es lo que hace
que el acta valga algo si alguien reclama.

La asignación de mesas **propone** y el juez dispone. Cada renglón lleva su
motivo al lado. Un sistema que reparte mesas por su cuenta le quita al juez lo
único que no se puede automatizar: saber que a ese jugador se le rompió la
raqueta, o que el de la mesa tres necesita diez minutos.

## La red del gimnasio

El problema real no es el marcador: es que seis tablets se pongan de acuerdo
donde no hay internet.

```
              ┌─────────────────────────────────┐
              │  Computadora de la pantalla     │
              │  · sirve la aplicación          │
              │  · relevo de eventos            │
              │  · controla quién escribe qué   │
              └───────────────┬─────────────────┘
                              │   Wi-Fi local, sin internet
        ┌──────────┬──────────┴──────┬──────────────┐
   tablet juez   árbitro 1      árbitro 2      árbitro 3
```

El relevo (`servidor/relevo.mjs`, un archivo, sin dependencias) sirve la
aplicación a las tablets y hace de buzón entre ellas. De tenis de mesa **no sabe
nada**: guarda una estructura con su número de revisión y un conjunto de eventos
con identificador. Toda la lógica del juego vive en el núcleo, que está probado.

El reparto de autoridad no es simétrico, porque el torneo tampoco lo es:

- La **estructura** —configuración, listas, sorteo, cuadro, qué partido va en qué
  mesa— la fija el juez y viaja con un número de revisión. Gana la más alta.
- Los **eventos** de cada partido los produce el árbitro de esa mesa y se unen
  siempre, sin que nadie gane: son hechos, no opiniones.

La aplicación no pide **nada** a internet: las tipografías van dentro del
paquete, no en un servidor de fuentes. Es lo que permite que una tablet
recién sacada de la caja, que nunca ha tenido conexión, la descargue del
propio relevo y funcione con el diseño completo. Todo el paquete pesa unos
420 kB.

Si el relevo se cae, nadie se detiene: cada tablet sigue anotando contra su copia
local y al volver la red se ponen al día solas. El relevo respalda a disco, así
que puede reiniciarse sin perder la jornada. Y si no hay red de ninguna clase, el
torneo se lleva igual y los resultados se pasan al final con un archivo.

## Quién puede hacer qué

Dos reglas, y las dos las comprueba el relevo y no los clientes: un permiso que
verifica quien lo pide no es un permiso.

- Un **árbitro** solo escribe en los partidos de **su** mesa, y solo eventos de
  juego: punto, deshacer, reanudar, cerrar.
- **Aceptar, registrar y corregir** resultados es del **juez principal**. Nadie
  más puede emitir esos eventos.

Leer, en cambio, está abierto: el torneo está proyectado en la pared del
gimnasio, y pedir credenciales para consultarlo obligaría a dar de alta también
la pantalla y cualquier teléfono que quiera mirar los horarios.

### Cómo se comprueba la identidad

Sin internet no hay HTTPS ni autoridad de certificados, así que la identidad va
por **token probado con HMAC**:

1. El relevo imprime al arrancar un código de un solo uso. Quien lo escribe queda
   como mesa de control y recibe un token.
2. Desde ahí, el juez genera un código por árbitro. Cada código sirve una vez,
   caduca en un cuarto de hora y ata ese aparato a esa persona y a su mesa.
3. En cada petición viaja `HMAC(token, método + ruta + contador + resumen del
   cuerpo)`. **El token no viaja nunca**: viaja la prueba de que se conoce.

Con eso, quien escuche el Wi-Fi del gimnasio no se lleva la credencial, no puede
cambiar el cuerpo por el camino, y no puede repetir una petición capturada —el
contador tiene que crecer siempre—. El juez ve en «Red» quién está dado de alta y
qué se ha rechazado, con el motivo.

SHA-256 y HMAC van implementados en `src/nucleo/firma.ts` en vez de con
`crypto.subtle` por una razón concreta: la API criptográfica del navegador solo
existe en contextos seguros, y el relevo sirve por HTTP en una dirección de red
local. Están comprobados contra los vectores de FIPS 180-4 y del RFC 4231.

### Lo que esto no protege

Conviene tenerlo claro y dicho:

- **No cifra.** El contenido viaja en claro y quien escuche la red puede leer los
  marcadores. Es información que además está proyectada en la pared.
- **No protege la tablet.** El token se guarda sin cifrar; quien tenga el aparato
  desbloqueado en la mano puede anotar como su dueño. Contra eso vale el bloqueo
  de pantalla, no la criptografía.
- **No impide que un árbitro anote mal su propio partido.** Tiene autoridad
  legítima ahí. Contra eso hay un juez mirando y un botón de corregir, y toda
  corrección queda firmada con quién la hizo y por qué.
- **No hay caducidad de sesión ni revocación fina.** Para quitarle el acceso a un
  aparato hay que reiniciar el relevo con `--nuevo-juez`.

## Repartir la aplicación

Teclear `http://192.168.1.108:8099` en seis tablets con teclado en pantalla son
seis oportunidades de equivocarse. En la pantalla del gimnasio se deja puesta la
página `/entrar`, con un código QR de la dirección: el árbitro apunta la cámara y
la aplicación se abre.

Y desde «Red → Abrir la página de reparto», el juez genera un QR por árbitro que
lleva dentro la dirección **y** su código de alta. Quien lo escanea entra ya
identificado, con su mesa puesta, sin elegir nada de ninguna lista.

El generador de QR es propio (`src/nucleo/qr.ts`): modo byte, corrección L,
versiones 1 a 6. Se comprueba de cuatro maneras —Reed–Solomon por su definición,
la información de formato contra el valor de la norma, el símbolo entero
leyéndolo de vuelta, y módulo por módulo contra rejillas hechas por una
biblioteca ajena— porque un QR mal construido sigue pareciendo un QR. La cuarta
se agregó porque las otras tres dejaron pasar un error real: la información de
formato iba transpuesta, el lector propio la leía transpuesta también, y ningún
teléfono reconocía el código.

## Lo que salió de la simulación guiada

Probado con un árbitro real en un teléfono (noviembre de 2026), y corregido:

- **La mesa de control se conecta sola** en la computadora del relevo, sin
  buscar ningún botón. Si el relevo ya tiene otra (porque se borraron los
  datos del navegador o se pulsó «Salir de la red»), la aplicación lo dice
  arriba, en grande, y ofrece «Recuperar la mesa de control aquí»; la
  anterior deja de valer. Antes la única salida era reiniciar el relevo con
  `--nuevo-juez` desde una terminal.
- **Una sola pestaña trabaja a la vez.** Si TTorneo se abre en otra pestaña
  del mismo navegador, la anterior queda en pausa con «Seguir en esta
  pestaña». Dos pestañas guardaban cada una su copia encima de la otra y se
  peleaban el contador de las firmas.
- **La pantalla del gimnasio** se abre con `#pantalla` en la dirección. No
  guarda papel ni cuenta como pestaña de trabajo, así que puede ser otra
  ventana del mismo navegador de la mesa de control.
- **Aviso de revisión atrasada.** Si el relevo tiene una versión más nueva del
  mismo torneo, la mesa de control lo dice y deja elegir cuál vale. Antes el
  relevo ignoraba sus cambios en silencio.
- **Mover partidos entre mesas** desde la tarjeta de cada mesa: a una libre, o
  intercambiándolo con uno sin empezar. El árbitro pasa a ser el de la mesa
  nueva.
- El QR, la dirección que reparte el relevo y el cambio de categoría (detalles
  más arriba y en el historial).

## El servidor: arrancarlo, verlo y pararlo

**Doble clic en `Iniciar torneo.bat`.** Comprueba que Node esté, compila la
aplicación la primera vez, arranca el relevo y abre el navegador. Ahí sale
un botón, **«Abrir la mesa de control aquí»**, y con eso ya se está dentro.

Son dos gestos en total: un doble clic y un botón. Sin terminal, sin
escribir órdenes y sin teclear ningún código. La ventana negra que queda es
el torneo; al cerrarla, se acaba. Si falta Node, el lanzador lo dice con la
dirección de descarga en vez de cerrarse sin más.

El botón solo aparece **en la computadora que sirve el torneo** y solo
mientras no haya una mesa de control dada de alta. Es deliberado: quien está
sentado delante de esa máquina es quien arrancó el relevo y ya tiene el
código impreso en la ventana, así que pedírselo no protege de nada. Los
árbitros, que entran desde otro aparato por la red, sí necesitan su código.

Desde la terminal, para desarrollo:

```bash
npm run torneo          # compila la aplicación y arranca el relevo
npm run relevo          # solo arranca el relevo, sin recompilar
```

Para ver si hay alguno corriendo y en qué puerto, en PowerShell:

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Select-Object ProcessId, CommandLine
```

Y para parar uno concreto:

```powershell
Stop-Process -Id <el número que salió> -Force
```

Mientras corre, escribe en `datos/`: `torneo.json` con la jornada y
`accesos.json` con los aparatos dados de alta. Esa carpeta es el respaldo,
y por eso el relevo puede reiniciarse a media tarde sin que nadie tenga que
volver a darse de alta. Está fuera del control de versiones.

`--nuevo-juez` descarta las altas anteriores y genera un código nuevo de
mesa de control. Es lo que hay que usar si una tablet se pierde o si se
quiere empezar de cero.

## Repartir la aplicación a otras personas

Hay tres formas, según a quién y para qué.

**Durante el torneo, a los árbitros.** No hace falta nada más que el
relevo: cada quien escanea el código de la página `/entrar` y la aplicación
llega por el Wi-Fi local. No se instala, no pasa por ninguna tienda.

**A alguien que quiera probarla sin montar nada.** El repositorio incluye un
flujo de publicación en GitHub Pages (`.github/workflows/deploy.yml`): al
empujar a `main`, corre las pruebas, compila y publica. Queda una dirección
pública que se abre desde cualquier navegador. Sirve para enseñarla, no para
operar un torneo con varias tablets, porque ahí no hay relevo.

**A otra organización, para que la use por su cuenta: `TTorneo.zip`.** El
relevo arma un ZIP con todo lo necesario —la aplicación compilada, el propio
relevo, el lanzador y un `LEEME.txt`— y se descarga desde la mesa de control,
en Red → «Descargar TTorneo.zip», o en `http://<relevo>/descargar/TTorneo.zip`.
Del otro lado se descomprime, se instala Node.js (gratis, versión LTS) y se
hace doble clic en «Iniciar torneo.bat»: no hay que compilar ni instalar
dependencias. Para generarlo sin relevo corriendo:

```bash
npm run paquete      # deja entrega/TTorneo.zip
```

El ZIP lo escribe el relevo a mano (deflate y un índice al final) para seguir
siendo un solo archivo sin dependencias.

## Levantar un torneo

En la computadora que va conectada a la pantalla:

```bash
npm install
npm run torneo
```

Eso compila la aplicación y arranca el relevo, que imprime la dirección de las
tablets y el código de la mesa de control. Después:

1. En la tablet del juez: abrir la dirección, elegir «Mesa de control», y en
   «Red» escribir el código que imprimió el relevo.
2. Cargar jugadores y árbitros, y sortear.
3. En «Red → Abrir la página de reparto», generar el código de cada árbitro.
4. Dejar `/entrar` puesta en la pantalla mientras llegan.

## Categorías: individual, dobles y mixtos

Una jornada suele tener varias categorías. Cada una es un torneo aparte, con su
sorteo, su cuadro y su campeón, y se elige al principio de la configuración:
elegirla es lo primero que se hace, porque decide cómo se lee todo lo demás.

En dobles y en mixtos, la pareja es **una sola inscripción**: dos nombres, un
ranking, un lugar en el sorteo y un lugar en el cuadro. Esa decisión es la que
deja intactos el reparto de grupos, la clasificación, la eliminatoria y la
propuesta de mesas —para todos ellos sigue habiendo un competidor por lado— y
es también la razón de que el reglamento de juego no cambie: sets a 11, saque
cada dos puntos, mismos desempates. Al pegar una lista, los dos nombres van en
la primera columna separados por una barra:

```
Ramírez Luis / Ortega Ana, Deportivo Norte, 1420
Salas Pedro / Nava Iris, Club Centro
```

Las categorías se guardan en **Torneo → Torneos de esta computadora**. Solo hay
una abierta a la vez: es la que ven las tablets y la pantalla. Al abrir otra, la
anterior se guarda entera —con todos sus puntos— y vuelve igual cuando se la
abre de nuevo; el relevo hace lo mismo en su carpeta `datos/`, así que cambiar
de categoría no pierde nada aunque se reinicie todo por el camino.

Que solo haya una abierta no es una limitación del almacenamiento sino una
decisión: los árbitros tienen una mesa y una pantalla, y hacerles elegir entre
dos torneos a media tarde es la clase de cosa que acaba con puntos anotados en
el partido equivocado. Si hiciera falta correr dos categorías a la vez en mesas
distintas, el relevo tendría que llevar las dos y cada tablet decir en cuál
está: es un cambio de fondo, no un ajuste.

## Sistemas de juego

Al configurar se elige cómo se organiza la competencia:

- **Grupos y eliminatoria.** Fase de grupos y, con los que avanzan, un cuadro
  hasta la final. Es lo de siempre.
- **Todos contra todos (round robin).** Un solo grupo y una vuelta. El
  calendario sale por el método del círculo: en cada jornada cada quien juega
  una vez (con número impar, descansa uno distinto en cada jornada), y en n − 1
  jornadas todos se enfrentan con todos exactamente una vez. No hay
  eliminatoria: cuando el último partido cuenta, la tabla da campeón,
  subcampeón y tercer lugar, con los mismos desempates de la fase de grupos.
  Una jornada puede ser un día, que es lo que hace falta en una liga de varias
  semanas.

## Torneo formal o amateur

Al configurar se elige con qué reglas se juega:

- **Formal (reglamento ITTF).** Sets a 11, un minuto entre sets, tiempo muerto
  de un minuto, resultados validados por la mesa de control y sin hándicap.
  Esos campos no se pueden tocar, y la regla se impone en el núcleo
  (`aplicarReglas`), no solo en la pantalla: un archivo cargado de otro aparato
  tampoco puede traer un «formal» con sets a 21.
- **Amateur o personalizado.** Quien organiza decide los puntos por set (de 5 a
  99, siempre con dos de diferencia), los descansos, el tiempo muerto, el
  hándicap y si los resultados pasan por la mesa de control. El descanso entre
  sets viene en 0.

Los puntos por set se escriben en cada partido antes de su primer punto, como
la ventaja del hándicap: cambiar la regla a media jornada no altera un partido
que ya empezó.

## Hándicap

Con el hándicap encendido (solo en torneos amateur), el de menor nivel empieza
cada set con puntos de ventaja, sin pasar del tope (nunca tantos que el set se
gane sin jugarlo). La diferencia sale de una de dos partes:

- **Del ranking:** un punto por cada cierto número de puntos de ranking. A quien
  no tiene ranking no se le calcula ventaja.
- **Del lugar en la lista, del 1 al n:** tantos puntos por cada lugar de
  diferencia. No hace falta ranking: basta con ordenar la lista de jugadores de
  mejor a peor con las flechas. La ventaja se fija en cada partido
antes del primer punto; si después cambia un ranking, el partido en juego
conserva la suya. El saque se cuenta con los puntos jugados, no con los de
ventaja. La ventaja sale en el tablero, en las tarjetas de partido y en el
acta.

## Siembra sin ranking

El orden de la lista de jugadores es la siembra. Con ranking, la lista va
por ranking; sin él, o para ajustarlo, se acomoda con las flechas de mejor a
peor, y el sorteo toma a los de arriba como cabezas de grupo. El acta dice
que la siembra la fijó el juez. «Volver al orden por ranking» deshace el
ajuste.

## Mesa autogestionada: los días sin juez

En un torneo de varios días no siempre hay quien dirija. Para eso está el
cuarto papel, **Mesa autogestionada**, que funciona sin red y sin hablar con
la mesa de control:

1. El juez descarga el archivo del torneo (Red → Descargar el archivo) y se lo
   pasa a quien vaya a anotar.
2. En el teléfono de esa persona: TTorneo → Mesa autogestionada → abrir el
   archivo. Ve todos los partidos por jugar, por jornada, y en cada uno puede
   llevar el marcador punto a punto o **escribir cómo quedó cada set**. Lo
   escrito se revisa en el momento (un 11-10 o un set de más no se aceptan).
3. Al terminar: «Mandar los resultados al juez». Sale un archivo pequeño con
   solo lo anotado en ese aparato, que se comparte por WhatsApp o correo.
4. El juez lo abre en Red → Recibir resultados. Lo recibido se suma a lo que
   ya tiene, sin reemplazar nada, y un archivo mandado dos veces no duplica
   nada. Los partidos llegan por validar: se aceptan de un golpe o uno por
   uno. Si el juez está conectado al relevo, los reenvía y las tablets y la
   pantalla se ponen al día.

Lo anotado lleva el nombre de quien anotó, y el acta lo dice. El juez sigue
siendo el único que valida y corrige.

## Tiempo muerto y tarjetas

El tablero tiene dos botones además del marcador:

- **Tiempo.** Pregunta quién lo pide y arranca la cuenta atrás; el reglamento da
  uno por lado y por partido, así que el lado que ya lo gastó aparece
  deshabilitado. Se acaba al reanudar o en cuanto se anota el punto siguiente.
- **Tarjeta.** Pregunta primero a quién se amonesta —preguntar el lado antes que
  la falta evita la equivocación cara: sancionar al que no era— y después ofrece
  los cuatro grados del reglamento: amarilla de advertencia, amarilla con un
  punto para el contrario, amarilla con dos, y roja. Los puntos de penalización
  son puntos normales: pueden cerrar el set o el partido. La roja descalifica, y
  entonces al contrario se le completan los sets que le faltaban, que es como se
  anota un partido perdido en la hoja.

Las dos cosas son eventos del registro, no estados de la pantalla: se deshacen
como un punto, viajan por la red como un punto, y salen en el acta con la hora,
el motivo y el nombre del árbitro que las sacó.

## Cerrar el torneo

Cuando la final queda validada, la mesa de control y la pantalla del gimnasio
cambian solas: dejan de dirigir la jornada y muestran el podio —campeón,
subcampeón y los dos semifinalistas, que comparten el tercer lugar porque el
reglamento no juega un partido para separarlos—.

De ahí salen dos documentos, y conviene no confundirlos:

- **El acta** (`Torneo → Ver el acta e imprimirla`) es el documento de la
  jornada, para leer y para archivar: jugadores inscritos, acta del sorteo con
  su semilla, tablas de cada grupo con los clasificados marcados, la llave
  ronda por ronda, el orden de juego con todos los resultados y sus parciales,
  las correcciones que hizo la mesa de control —con quién y por qué— y los
  partidos que dirigió cada árbitro. El PDF lo hace el propio navegador desde
  «Guardar como PDF» en el diálogo de impresión; no hay biblioteca de por
  medio, para que un acta se pueda reimprimir dentro de cinco años sin
  depender de nada.
- **El archivo** (`Torneo → Descargar el archivo`) es el respaldo: lleva el
  registro completo, punto por punto y con su hora, y permite reconstruir
  cualquier partido del acta. Es también la forma de pasar el torneo a otro
  dispositivo cuando no hay ninguna red.

Cerrado el navegador de la mesa de control, lo único que queda de la jornada es
lo que se haya descargado.

## Ensayar antes del torneo

```bash
npm run simulacro
```

Levanta un relevo de verdad, da de alta una mesa de control y cuatro tablets, y
juega un torneo entero contra él: sorteo, fase de grupos punto a punto,
validaciones, reasignación de mesas y cuadro eliminatorio. Por el camino provoca
lo que va a pasar en el gimnasio —se cae el Wi-Fi a media ronda, se reinicia una
tablet, se reenvían paquetes repetidos— y lo que ojalá no pase: alguien
intentando meter resultados que no le tocan.

Al terminar comprueba que no se perdió ningún evento, que el marcador es idéntico
en la tablet del árbitro y en la mesa de control, que reenviar no duplica nada,
que lo anotado sin red llega entero, que las tablas cuadran, y que ningún intento
sin permiso dejó rastro. Deja un informe de lo que ocurrió.

Es mucho más barato descubrir aquí que un marcador no converge que descubrirlo
con doce jugadores esperando.

## Desarrollo

```bash
npm install
npm run dev          # aplicación en desarrollo
npm test             # pruebas del núcleo
npm run simulacro    # ensayo completo contra un relevo real
npm run test:todo    # las dos cosas
npm run build        # publicar en /cuadro/ (GitHub Pages)
npm run build:relevo # servir desde la raíz, que es lo que usa el relevo
```

En `herramientas/` hay dos guiones que no forman parte de la aplicación y
sirven para revisar cómo queda lo que sale impreso:

```bash
npx vite-node herramientas/jornada-demo.mts dobles > jornada.json   # torneo terminado de mentira
npx vite-node herramientas/acta-demo.mts jornada.json acta.html
```

## Reglas

Siguen el reglamento de la ITTF: sets a 11 con dos de diferencia, cambio de saque
cada dos puntos y cada punto desde 10-10, un minuto de descanso entre sets, un
tiempo muerto de un minuto por lado y por partido, tarjetas con penalización de
uno o dos puntos para el contrario, dos puntos por partido ganado y uno por
perdido, desempates por resultado directo y luego por cociente de sets y de
puntos.

Los tiempos de descanso y el formato son parametrizables, y la validación
obligatoria de resultados se puede apagar para torneos informales.

**Están pendientes de revisión por un árbitro en activo.** El documento de
especificación con el que se revisan vive fuera de este repositorio.

## Licencia

MIT
