@echo off
REM Receptor Contact ID -> Firestore (colecao events). Terminal 1.
REM Uso: run_receptor.bat [--port 9000]
py -3.11 "%~dp0receptor.py" %*
pause
