#!/bin/bash
# Atalhos de teste por tipo de evento (Git Bash).
# Uso: ./teste.sh alarme | ./teste.sh restaura | ./teste.sh armado | ./teste.sh falta-ac | ./teste.sh retorno-ac | ./teste.sh todos
# Receptor precisa estar rodando: ./run_receptor.sh --port 9000
cd "$(dirname "$0")"
TIPO="${1:-todos}"
case "$TIPO" in
  todos) py -3.11 simulador.py --host 127.0.0.1 --conta 1234 ;;
  *)     py -3.11 simulador.py --host 127.0.0.1 --conta 1234 --tipo "$TIPO" ;;
esac
