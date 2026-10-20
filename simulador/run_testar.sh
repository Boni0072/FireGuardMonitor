#!/bin/bash
# Diagnostico: testa chave + grava evento teste em `events`.
# Uso (Git Bash): ./run_testar.sh
cd "$(dirname "$0")"
py -3.11 testar_conexao.py "$@"
