"""Receptor Contact ID (UDP) -> Firestore (colecao `events`)."""
import argparse
import datetime
import re
import socket
import sys
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

CODIGOS = {
    "110": "Incendio",
    "111": "Fumaca",
    "112": "Combustao",
    "120": "Panico",
    "130": "Disparo de zona",
    "301": "Falta de energia AC",
    "302": "Bateria baixa",
    "401": "Armado/desarmado",
    "602": "Online",
}

# Codigos de alarme (incendio / panico / disparo de zona) -> vermelho pulsante.
ALARME_CODES = (
    "110", "111", "112", "113", "114", "115", "116", "117", "118",
    "120", "121", "122",
    "130", "131", "132", "133", "134", "146", "150",
)

# Codigos de falha de supervision (energia / bateria) -> ambar pulsante.
FALHA_CODES = ("301", "302", "309", "351", "380")


def mapear_evento(codigo, qualificador):
    """Mapeia (codigo, qualificador) para (event_type, severity, state, rotulo).

    A mesma regra de cores do front-end e aplicada aqui:
      - (1, 110/120/130) -> alarme ativo, vermelho, pulsa
      - (3, 110/120/130) -> restauracao, verde, estatico
      - (1, 301/302)     -> falha ativa, ambar, pulsa suave
      - (3, 301/302)     -> restauracao, verde, estatico
      - (1, 401)         -> armado/desarmado, informativo, estatico
      - (1, 602)         -> online, verde, estatico
    """
    q = str(qualificador)
    cod = str(codigo)

    if cod in ALARME_CODES:
        if q == "3":
            return ("alarm_restore", "normal", "normal", "Restauracao de alarme")
        return ("alarm", "critical", "active", CODIGOS.get(cod, "Alarme de Incendio"))

    if cod in FALHA_CODES:
        if q == "3":
            return ("fault_restore", "normal", "normal", "Restauracao de " + CODIGOS.get(cod, "falha"))
        return ("fault", "warning", "active", CODIGOS.get(cod, "Falha de supervision"))

    if cod == "401":
        if q == "3":
            return ("supervisory", "info", "normal", "Desarmado")
        return ("supervisory", "info", "normal", "Armado/desarmado")

    if cod == "602":
        # Online: verde estatico, nunca pulsa.
        return ("heartbeat", "info", "normal", "Online")

    if q == "3":
        return ("fault_restore", "normal", "normal", CODIGOS.get(cod, "Restauracao"))
    if q == "6":
        return ("heartbeat", "info", "normal", CODIGOS.get(cod, "Status"))
    return ("supervisory", "info", "normal", CODIGOS.get(cod, "Codigo desconhecido"))


def montar_descricao(rotulo, detalhe):
    """Monta a descricao do protocolo evitando texto duplicado."""
    rotulo = (rotulo or "").strip()
    detalhe = (detalhe or "").strip()
    if not rotulo:
        return detalhe or None
    if not detalhe:
        return rotulo
    if detalhe.lower() == rotulo.lower():
        return rotulo
    if detalhe.lower().startswith(rotulo.lower()):
        return detalhe
    return f"{rotulo} - {detalhe}"


def extrair_ips(texto):
    if not texto:
        return []
    return re.findall(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", str(texto))


def resolver_painel(db, conta, origem_ip):
    """Localiza a central: 1) conta (asset_code) 2) IP (ip_data) 3) conta dentro do ip_data."""
    try:
        docs = list(db.collection("panels").stream())
    except Exception as e:
        print("Erro ao listar panels:", e)
        return None, None
    conta_norm = (conta or "").strip()
    ip_norm = (origem_ip or "").strip()
    if conta_norm:
        for d in docs:  # 1) match exato por conta
            p = d.to_dict() or {}
            if str(p.get("asset_code") or "").strip() == conta_norm:
                return d.id, {"id": d.id, **p}
    if ip_norm:
        for d in docs:  # 2) match por IP de origem
            p = d.to_dict() or {}
            if ip_norm in extrair_ips(p.get("ip_data")):
                return d.id, {"id": d.id, **p}
    if conta_norm:
        for d in docs:  # 3) conta citada dentro do ip_data
            p = d.to_dict() or {}
            if conta_norm in str(p.get("ip_data") or ""):
                return d.id, {"id": d.id, **p}
    return None, None


def resolver_gateway(db, panel_id):
    try:
        for g in db.collection("gateways").where("panel_id", "==", panel_id).limit(1).stream():
            gd = g.to_dict() or {}
            return g.id, {"id": g.id, **gd}
    except Exception as e:
        print("Aviso: falha ao buscar gateway:", e)
    return None, None


def agora_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def decodificar(msg):
    # Formato Contact ID: AAAA 18 Q XYZ GG CCC [S]
    # 16 chars com checksum S, ou 15 chars legado sem checksum.
    if not msg or len(msg) not in (15, 16) or msg[4:6] != "18":
        return None
    if len(msg) == 16:
        try:
            soma = sum(10 if c == "0" else int(c, 16) for c in msg)
        except ValueError:
            return None
        if soma % 15 != 0:  # digito verificador invalido
            return None
    else:
        try:
            int(msg, 16)
        except ValueError:
            return None
    codigo = msg[7:10]
    return {
        "conta": msg[0:4],
        "qualificador": msg[6],
        "tipo": "restauracao" if msg[6] == "3" else "evento",
        "codigo": codigo,
        "descricao": CODIGOS.get(codigo, "Codigo desconhecido"),
        "particao": msg[10:12],
        "zona": msg[12:15],
        "bruto": msg,
    }

def main():
    ap = argparse.ArgumentParser(description="Receptor Contact ID -> Firestore (events).")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=9000)
    ap.add_argument("--chave", default="chave.json")
    args = ap.parse_args()

    chave_path = Path(args.chave)
    if not chave_path.is_file():
        aqui = Path(__file__).resolve().parent
        for c in [aqui / "chave.json", aqui.parent / "chave.json", Path.cwd() / "chave.json"]:
            if c.is_file():
                chave_path = c
                break
    if not chave_path.is_file():
        print(f"ERRO: service-account nao encontrada: {args.chave}")
        sys.exit(1)

    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(str(chave_path)))
    db = firestore.client()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((args.host, args.port))
    print(f"Receptor em {args.host}:{args.port} -> colecao `events`. Ctrl+C para parar.")

    while True:
        dados, addr = sock.recvfrom(1024)
        origem_ip = addr[0]
        msg = dados.decode(errors="replace").strip()
        ev = decodificar(msg)
        if ev is None:
            print(f"Mensagem invalida de {addr}: {msg}")
            continue  # sem ACK: a central reenviaria
        event_type, severity, state, rotulo = mapear_evento(ev["codigo"], ev["qualificador"])
        ts = agora_iso()
        panel_id, panel = resolver_painel(db, ev["conta"], origem_ip)
        if panel:
            tenant_id = panel.get("tenant_id") or None
            building_id = panel.get("building_id") or None
            gateway_id, _gw = resolver_gateway(db, panel_id)
            vinculo = f"central {panel.get('manufacturer','')} {panel.get('model','')} conta={ev['conta']}"
        else:
            tenant_id, building_id, gateway_id = None, None, None
            vinculo = f"SEM VINCULO: cadastre asset_code={ev['conta']} e/ou ip_data com {origem_ip}"
        try:
            zona_num = int(ev["zona"])
        except ValueError:
            zona_num = None
        doc_event = {
            "tenant_id": tenant_id,
            "building_id": building_id,
            "gateway_id": gateway_id,
            "panel_id": panel_id,
            "input_number": zona_num,
            "input_ref": f"Z{ev['zona']}",
            "event_type": event_type,
            "severity": severity,
            "state": state,
            "occurred_at": ts,
            "received_at": ts,
            "external_event_id": f"contactid-{ev['bruto']}",
            "sequence": None,
            "acknowledged": False,
            "acknowledged_by": None,
            "acknowledged_at": None,
            "origem_ip": origem_ip,
            "conta": ev["conta"],
            "codigo_contato": ev["codigo"],
            "qualificador": ev["qualificador"],
            "particao": ev["particao"],
            "zona": ev["zona"],
            "descricao": montar_descricao(rotulo, ev["descricao"]),
            "bruto": ev["bruto"],
        }
        try:
            db.collection("events").add(doc_event)
            db.collection("eventos").add({**ev, "origem_ip": origem_ip,
                                          "panel_id": panel_id,
                                          "tenant_id": tenant_id,
                                          "building_id": building_id,
                                          "event_type": event_type,
                                          "recebido_em": firestore.SERVER_TIMESTAMP})
            if gateway_id:
                try:
                    db.collection("gateways").document(gateway_id).update(
                        {"last_event_at": ts, "last_heartbeat_at": ts, "status": "online"})
                except Exception:
                    pass
            sock.sendto(b"\x06", addr)  # so confirma depois de gravar
            print(f"OK {ev['conta']} | {rotulo} | zona {ev['zona']} | {event_type} | {vinculo}")
        except Exception as e:
            print("Erro ao gravar no Firestore:", e)  # sem ACK


if __name__ == "__main__":
    main()
