"""Migracao unica: copia `eventos` (legado) -> `events` (monitor) com vinculo."""
import datetime
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

import receptor

CHAVE = Path(__file__).parent / "chave.json"
if not firebase_admin._apps:
    firebase_admin.initialize_app(credentials.Certificate(str(CHAVE)))
db = firestore.client()

panels = {d.id: (d.to_dict() or {}) for d in db.collection("panels").stream()}

def norm(v):
    return "" if v is None else str(v).strip()

migrados = 0
pulados = 0
for d in db.collection("eventos").stream():
    leg = d.to_dict() or {}
    bruto = norm(leg.get("bruto"))
    # evita duplicar: confere external_event_id
    dup = list(db.collection("events").where("external_event_id", "==", f"contactid-{bruto}").limit(1).stream())
    if dup:
        pulados += 1
        continue
    ev = receptor.decodificar(bruto)
    if ev is None:
        print(f"PULADO {d.id}: bruto invalido {bruto}")
        pulados += 1
        continue
    event_type, severity, state, rotulo = receptor.mapear_evento(ev["codigo"], ev["qualificador"])
    origem_ip = norm(leg.get("origem_ip"))
    panel_id, panel = receptor.resolver_painel(db, ev["conta"], origem_ip)
    recebido = leg.get("recebido_em")
    try:
        ts = recebido.to_datetime().isoformat() if hasattr(recebido, "to_datetime") else datetime.datetime.now(datetime.timezone.utc).isoformat()
    except Exception:
        ts = datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        zona_num = int(ev["zona"])
    except ValueError:
        zona_num = None
    doc = {
        "tenant_id": (panel.get("tenant_id") or None) if panel else None,
        "building_id": (panel.get("building_id") or None) if panel else None,
        "gateway_id": None,
        "panel_id": panel_id,
        "input_number": zona_num,
        "input_ref": f"Z{ev['zona']}",
        "event_type": event_type,
        "severity": severity,
        "state": state,
        "occurred_at": ts,
        "received_at": ts,
        "external_event_id": f"contactid-{bruto}",
        "sequence": None,
        "acknowledged": False,
        "acknowledged_by": None,
        "acknowledged_at": None,
        "origem_ip": origem_ip or None,
        "conta": ev["conta"],
        "codigo_contato": ev["codigo"],
        "qualificador": ev["qualificador"],
        "particao": ev["particao"],
        "zona": ev["zona"],
        "descricao": receptor.montar_descricao(rotulo, ev["descricao"]),
        "bruto": bruto,
    }
    db.collection("events").add(doc)
    db.collection("eventos").document(d.id).update({
        "panel_id": panel_id,
        "tenant_id": doc["tenant_id"],
        "building_id": doc["building_id"],
        "event_type": event_type,
    })
    migrados += 1
    print(f"MIGRADO {bruto} -> panel={panel_id} tipo={event_type}")

def norm_panel(v):
    return None if v is None or (isinstance(v, str) and v.strip() == "") else v

# normaliza "" -> null em panels/buildings para o filtro de tenant funcionar
for pid, p in panels.items():
    fix = {}
    if p.get("tenant_id") == "":
        fix["tenant_id"] = None
    if p.get("building_id") == "":
        fix["building_id"] = None
    if fix:
        db.collection("panels").document(pid).update(fix)
        print(f"panel {pid} normalizado: {fix}")
for b in db.collection("buildings").stream():
    bd = b.to_dict() or {}
    if bd.get("tenant_id") == "":
        db.collection("buildings").document(b.id).update({"tenant_id": None})
        print(f"building {b.id} normalizado")

print(f"FIM: migrados={migrados} pulados={pulados}")
