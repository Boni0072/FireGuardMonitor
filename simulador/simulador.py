import socket
import time
import argparse
import random


def contact_id(conta, qualificador, codigo, particao, zona):
    # Formato Contact ID: AAAA 18 Q XYZ GG CCC S (16 caracteres)
    # AAAA = conta (4 digitos), 18 = Contact ID, Q = qualificador (1=novo, 3=restaura, 6=status),
    # XYZ = codigo do evento, GG = particao (2 digitos), CCC = zona (3 digitos), S = checksum
    corpo = f"{conta}18{qualificador}{codigo}{particao:02d}{zona:03d}"
    soma = sum(10 if c == "0" else int(c) for c in corpo)
    dig = 15 - (soma % 15)
    return corpo + format(dig, "X")


# (qualificador, codigo, descricao)
# chave = nome curto para --tipo
# A regra de cores e derivada do par (qualificador, codigo):
#   (1, 110/120/130) -> alarme, vermelho pulsante
#   (3, 110/120/130) -> restauracao, verde estatico
#   (1, 301/302)     -> falha, ambar pulsante
#   (3, 301/302)     -> retorno, verde estatico
#   (1, 401)         -> armado/desarmado, informativo
#   (1, 602)         -> online, verde estatico
TIPOS = {
    "incendio": (1, "110", "Incendio"),
    "restaura-incendio": (3, "110", "Restauracao de incendio"),
    "panico": (1, "120", "Panico"),
    "restaura-panico": (3, "120", "Restauracao de panico"),
    "alarme": (1, "130", "Disparo de zona"),
    "restaura": (3, "130", "Restauracao de zona"),
    "armado": (1, "401", "Armado/desarmado"),
    "falta-ac": (1, "301", "Falta de energia AC"),
    "retorno-ac": (3, "301", "Retorno energia AC"),
    "bateria-baixa": (1, "302", "Bateria baixa"),
    "bateria-restaurada": (3, "302", "Bateria restaurada"),
    "online": (1, "602", "Online"),
}
# ordem padrao quando --tipo nao e informado (compativel com versao anterior)
EVENTOS = [TIPOS["incendio"], TIPOS["alarme"], TIPOS["restaura"], TIPOS["armado"], TIPOS["falta-ac"]]


def main():
    ap = argparse.ArgumentParser(
        description="Simulador Contact ID (UDP) — emula a central cadastrada no FireGuard."
    )
    ap.add_argument("--host", default="127.0.0.1",
                    help="IP onde o receptor.py está ouvindo (padrão: 127.0.0.1). "
                         "Para testar outra máquina, informe o IP dela. Ex: 192.168.15.60")
    ap.add_argument("--port", type=int, default=9000, help="Porta UDP do receptor (padrão: 9000)")
    ap.add_argument("--conta", default="1234",
                    help="Código da conta Contact ID (4 dígitos). "
                         "Use o MESMO valor cadastrado na central (asset_code ou código da conta). Padrão: 1234")
    ap.add_argument("--particao", type=int, default=1, help="Partição (padrão: 1)")
    ap.add_argument("--zona", type=int, default=5, help="Zona inicial (padrão: 5)")
    ap.add_argument("--loop", action="store_true",
                    help="Repete a sequência em loop até Ctrl+C (útil para demo no Monitor).")
    ap.add_argument("--intervalo", type=float, default=2.0, help="Segundos entre eventos (padrão: 2.0)")
    ap.add_argument("--tipo", choices=sorted(TIPOS.keys()),
                    help=f"Envia APENAS um tipo de evento. Opções: {', '.join(sorted(TIPOS.keys()))}. "
                         "Sem --tipo, envia a sequência completa (alarme, restaura, armado, falta-ac).")
    args = ap.parse_args()

    eventos = [TIPOS[args.tipo]] if args.tipo else EVENTOS

    conta = str(args.conta).strip()
    if len(conta) != 4 or not conta.isdigit():
        print(f"AVISO: conta '{conta}' deveria ter 4 dígitos (ex: 1234). Enviando mesmo assim.")

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(3)

    print(f"Simulador -> {args.host}:{args.port} | conta={conta} | particao={args.particao} | zona_base={args.zona}")
    print("Dica: cadastre na central (Página Centrais) o asset_code = conta e/ou ip_data contendo o IP desta máquina.")
    print("Pressione Ctrl+C para parar.\n")

    try:
        while True:
            for q, cod, desc in eventos:
                zona = args.zona + random.randint(0, 0)  # mantém zona configurada; ajuste se quiser variar
                msg = contact_id(conta, q, cod, args.particao, zona)
                try:
                    sock.sendto(msg.encode(), (args.host, args.port))
                except OSError as e:
                    print(f"Enviado: {msg} ({desc}) zona={zona:03d}")
                    print(f"  ERRO ao enviar: {e}. Verifique IP/porta e firewall.")
                    time.sleep(args.intervalo)
                    continue
                print(f"Enviado: {msg} ({desc}) zona={zona:03d}")
                try:
                    ack, _ = sock.recvfrom(16)
                    print("  ACK recebido:", ack)
                except socket.timeout:
                    print("  Sem ACK (receptor fora do ar ou firewall bloqueando UDP).")
                    print("  -> Abra OUTRO terminal e rode: ./run_receptor.sh --port 9000")
                except (ConnectionResetError, OSError) as e:
                    print(f"  Porta recusada ({e}). O receptor NAO esta rodando.")
                    print("  -> Abra OUTRO terminal e rode: ./run_receptor.sh --port 9000")
                time.sleep(args.intervalo)
            if not args.loop:
                break
    except KeyboardInterrupt:
        print("\nSimulador interrompido.")


if __name__ == "__main__":
    main()

