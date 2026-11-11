@echo off
rem  UTF-8 en la consola, para que los acentos del servidor no salgan rotos.
chcp 65001 > nul
title TTorneo - torneo en marcha
cd /d "%~dp0"

rem  Este archivo va sin acentos ni caracteres de caja a proposito: cmd.exe
rem  lee el guion con la codificacion del sistema antes de que nada pueda
rem  cambiarla, y un solo acento basta para que deje de reconocer las
rem  lineas. Un lanzador que se rompe en la computadora del gimnasio no
rem  sirve de nada, y ahi no habra quien lo arregle.

echo.
echo   ==============================================
echo     TTORNEO - iniciando el torneo
echo   ==============================================
echo.

rem  Sin Node no hay nada que hacer, y conviene decirlo claro en vez de
rem  dejar una ventana negra que se cierra sola.
where node >nul 2>nul
if errorlevel 1 (
  echo   No se encuentra Node.js en esta computadora.
  echo.
  echo   Cuadro lo necesita para servir la aplicacion a las tablets.
  echo   Se descarga gratis de https://nodejs.org  ^(elige la version LTS^)
  echo   Cuando lo hayas instalado, vuelve a hacer doble clic aqui.
  echo.
  pause
  exit /b 1
)

rem  La primera vez hay que compilar. Despues ya no.
if not exist "dist\index.html" (
  echo   Preparando la aplicacion por primera vez.
  echo   Esto tarda un minuto y solo pasa una vez.
  echo.
  call npm install --silent
  call npm run build:relevo
  if errorlevel 1 (
    echo.
    echo   No se pudo preparar la aplicacion. Mira el mensaje de arriba.
    pause
    exit /b 1
  )
  echo.
)

rem  Abrir el navegador un poco despues de arrancar el servidor: si se abre
rem  antes, encuentra la puerta cerrada y muestra un error que no lo es.
start "" /b cmd /c "timeout /t 4 > nul & start "" http://localhost:8080/"

echo   Se abrira el navegador. Pulsa "Abrir la mesa de control aqui".
echo.
echo   DEJA ESTA VENTANA ABIERTA mientras se juega.
echo   Al cerrarla se termina el torneo.
echo.

node servidor\relevo.mjs --puerto 8080

echo.
echo   El torneo se ha detenido.
pause
