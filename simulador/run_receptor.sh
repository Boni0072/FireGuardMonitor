#!/bin/bash
# Receptor Contact ID -> Firestore (colecao events). Terminal 1.
# Uso (Git Bash): ./run_receptor.sh --port 9000
cd "$(dirname "$0")"
py -3.11 receptor.py "$@"
