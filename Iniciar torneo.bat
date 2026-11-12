@echo off
rem  UTF-8 en la consola, para que los acentos del servidor no salgan rotos.
chcp 65001 > nul
title TTorneo - iniciando
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
  echo   TTorneo lo necesita para servir la aplicacion a las tablets.
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

rem  El relevo se abre en una consola clasica de Windows y no en Windows
rem  Terminal: en la clasica se le puede quitar el boton de cerrar, para que
rem  nadie la cierre sin querer a media jornada. El propio relevo abre el
rem  navegador cuando ya esta escuchando.
if exist "%SystemRoot%\System32\conhost.exe" (
  start "" "%SystemRoot%\System32\conhost.exe" cmd.exe /c ""%~dp0servidor\relevo.bat""
  echo   El torneo se abrio en una ventana aparte, titulada
  echo   "TTorneo - NO CERRAR". Esa ventana es el torneo: dejala abierta.
  echo.
  echo   Esta ventana se cierra sola en unos segundos.
  timeout /t 8 > nul
  exit /b 0
)

rem  Sin consola clasica (no deberia pasar en Windows 10 u 11), aqui mismo.
call "%~dp0servidor\relevo.bat"
