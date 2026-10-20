@echo off
REM Usa sempre o Python 3.11 estavel (o 3.15 alfa quebra o firebase-admin)
py -3.11 "%~dp0testar_conexao.py" %*
pause
