# Cuadro

Gestor de torneos de tenis de mesa que funciona sin conexión. Se instala en la
tablet o el teléfono y opera un torneo completo: inscripciones, sorteo, fase de
grupos, tabla con desempates, cuadro eliminatorio, rol de mesas y marcador.

Proyecto de Práctica Profesional, Licenciatura en Matemática Algorítmica,
Escuela Superior de Física y Matemáticas, Instituto Politécnico Nacional.

## Dos aplicaciones, un mismo torneo

**Mesa de control** — el juez principal configura el torneo, carga jugadores,
hace el sorteo, arma el cuadro y sigue todas las mesas.

**Tablero** — el árbitro elige su mesa y solo lleva el marcador. Dos zonas
grandes que se tocan para anotar, deshacer, sets, y quién saca.

En esta versión ambos roles comparten el almacenamiento del mismo dispositivo.
La operación en red local, con cada árbitro en su propia tablet, está prevista
como fase 2.

## El núcleo algorítmico

La lógica vive en `src/nucleo/`, sin ninguna dependencia de la interfaz, y está
cubierta por pruebas. Son cuatro problemas:

| Módulo | Problema |
|---|---|
| `reglas.ts` | El estado del partido como recorrido sobre una lista de eventos |
| `clasificacion.ts` | Cascada de desempates, aplicada solo entre los empatados |
| `sorteo.ts` | Asignación con restricciones: siembra y separación por club |
| `cuadro.ts` | Construcción y avance de la eliminatoria |

El marcador nunca se guarda como número: se guarda la lista de puntos y el
estado se deduce recorriéndola. Por eso deshacer es quitar el último evento, y
por eso sincronizar entre dispositivos será juntar dos listas.

Cuando una restricción del sorteo es infactible —cinco jugadores del mismo club
en cuatro grupos— el sistema cede y **reporta qué restricción cedió**, en vez de
fallar en silencio.

## Reglas

Siguen el reglamento de la ITTF: sets a 11 con dos de diferencia, cambio de
saque cada dos puntos y cada punto desde 10-10, dos puntos por partido ganado y
uno por perdido, desempates por resultado directo y luego por cociente de sets y
de puntos.

**Están pendientes de revisión por un árbitro en activo.** El documento de
especificación con el que se revisan vive fuera de este repositorio.

## Desarrollo

```bash
npm install
npm run dev
npm test
npm run build
```

## Licencia

MIT
