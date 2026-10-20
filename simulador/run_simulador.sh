#!/bin/bash
# Simulador Contact ID (UDP). Terminal 2 — rode DEPOIS do receptor.
# Uso (Git Bash): ./run_simulador.sh --host 127.0.0.1 --conta 1234 --loop
# Uso (PowerShell): py -3.11 simulador.py --host 127.0.0.1 --conta 1234
cd "$(dirname "$0")"
py -3.11 simulador.py "$@"
