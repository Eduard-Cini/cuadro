@echo off
rem  La ventana del torneo. La abre "Iniciar torneo.bat" en una consola
rem  clasica para que el relevo le pueda quitar el boton de cerrar.
rem  Sin acentos a proposito: ver el comentario de "Iniciar torneo.bat".
chcp 65001 > nul
title TTorneo - NO CERRAR - torneo en marcha
cd /d "%~dp0.."

node servidor\relevo.mjs --puerto 8080 --proteger-ventana --abrir

echo.
echo   El torneo se ha detenido. Lo jugado quedo guardado en la carpeta datos.
echo   Para seguir, vuelve a abrir "Iniciar torneo.bat".
echo.
pause
