@echo off
REM Simulador Contact ID (UDP). Terminal 2 — rode DEPOIS do receptor.
REM Uso: run_simulador.bat [--host 127.0.0.1 --conta 1234 --loop]
py -3.11 "%~dp0simulador.py" %*
pause
