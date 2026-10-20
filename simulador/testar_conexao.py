"""Diagnostico: prova onde o receptor esta gravando.
Uso: python testar_conexao.py [--chave ./chave.json]
Ele imprime o project_id da chave, lista centrais e grava um evento de teste em `events`.
"""
import sys
import json
import datetime
from pathlib import Path

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError:
    print("ERRO: firebase-admin nao instalado. Rode: pip install firebase-admin")
    sys.exit(1)

chave = Path(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[1] == "--chave" else Path(__file__).parent / "chave.json"
if len(sys.argv) == 3 and sys.argv[1] == "--chave":
    chave = Path(sys.argv[2])
if not chave.is_file():
    # procura em lugares comuns
    for c in [Path(__file__).parent / "chave.json", Path(__file__).parent.parent / "chave.json", Path.cwd() / "chave.json"]:
        if c.is_file():
            chave = c
            break

print(f"Procurando chave em: {chave} -> existe={chave.is_file()}")
if not chave.is_file():
    print("ERRO: chave.json NAO encontrada. O receptor novo nem sobe sem ela.")
    print("Se o simulador recebeu ACK mesmo assim, quem respondeu foi OUTRO programa/receptor antigo,")
    print("provavelmente gravando em outro projeto ou so na colecao legada `eventos`.")
    print("Baixe a chave (Firebase Console > Config do projeto > Contas de servico > Gerar nova chave)")
    print("e salve como simulador/chave.json do projeto fireguard-monitor.")
    sys.exit(1)

data = json.loads(chave.read_text())
print(f"project_id da chave: {data.get('project_id')}")
print(f"client_email: {data.get('client_email')}")
if data.get("project_id") != "fireguard-monitor":
    print("AVISO: a chave NAO e do projeto fireguard-monitor! O front olha fireguard-monitor,")
    print("entao o documento vai para outro projeto e nunca aparece na tela. Troque a chave.")

if not firebase_admin._apps:
    firebase_admin.initialize_app(credentials.Certificate(str(chave)))
db = firestore.client()

print("\n--- Centrais cadastradas (panels) ---")
try:
    panels = list(db.collection("panels").limit(20).stream())
    print(f"total (amostra): {len(panels)}")
    for d in panels:
        p = d.to_dict() or {}
        print(f" - id={d.id} asset_code={p.get('asset_code')} ip_data={p.get('ip_data')} tenant={p.get('tenant_id')} {p.get('manufacturer')} {p.get('model')}")
    if not panels:
        print("NENHUMA central cadastrada! O receptor vai gravar com tenant_id=null (sem vinculo).")
except Exception as e:
    print("Erro ao listar panels:", e)

print("\n--- Gravando evento de TESTE em `events` ---")
ts = datetime.datetime.now(datetime.timezone.utc).isoformat()
doc = {"tenant_id": None, "building_id": None, "gateway_id": None, "panel_id": None,
       "input_number": 5, "input_ref": "Z005", "event_type": "alarm", "severity": "critical",
       "state": "active", "occurred_at": ts, "received_at": ts,
       "external_event_id": f"teste-diagnostico-{ts}", "sequence": None,
       "acknowledged": False, "acknowledged_by": None, "acknowledged_at": None,
       "origem_ip": "127.0.0.1-teste", "conta": "1234", "descricao": "Evento de diagnostico",
       "bruto": "1234181130010055"}
try:
    ref = db.collection("events").add(doc)
    print(f"OK gravado id={ref[1].id}. Confira no console: Firestore > events > {ref[1].id}")
    print("Se nao aparecer no console, voce esta olhando o projeto errado ou sem refresh/filtro.")
except Exception as e:
    print("FALHOU ao gravar:", e)
