#!/usr/bin/env python3
"""
Gateway Simulator BEMS per PostgreSQL/TimescaleDB
==================================================
Simula un gateway IoT che invia letture di telemetria al backend GAM
tramite l'endpoint REST /api/bems/telemetry/batch.

Funzionalità:
- Genera dati realistici per zone e impianti (Piano 4 e Piano 5)
- Simula profili orari di occupancy, temperatura, CO2, potenza
- Inserisce dati storici (backfill) e continua in real-time
- Configura tramite variabili d'ambiente o argomenti CLI

Utilizzo:
    # Backfill 24 ore di dati storici + loop real-time ogni 5 minuti
    python3 gateway_simulator_pg.py --backfill 24 --interval 300

    # Solo backfill (per inizializzare il DB)
    python3 gateway_simulator_pg.py --backfill 48 --no-loop

    # Solo loop real-time
    python3 gateway_simulator_pg.py --interval 60
"""

import argparse
import json
import math
import random
import time
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

# ── Configurazione ──────────────────────────────────────────────────────────
BASE_URL = "http://localhost:8500"
ASSET_ID = 6  # Sede Centrale Roma

# Definizione zone: (zone_id, floor_id, nome, tipo, capacita_persone, superficie_mq)
ZONES = [
    # Piano 4
    ("Z-P4-01", "P4", "Ufficio 1",       "ufficio",       8,  80.0),
    ("Z-P4-02", "P4", "Ufficio 2",       "ufficio",       8,  80.0),
    ("Z-P4-03", "P4", "Ufficio 3",       "ufficio",       8,  80.0),
    ("Z-P4-04", "P4", "Ufficio 4",       "ufficio",       8,  80.0),
    ("Z-P4-05", "P4", "Dir. Generale",   "ufficio",       4, 120.0),
    ("Z-P4-06", "P4", "Sala Riunioni A", "sala_riunioni", 12, 60.0),
    ("Z-P4-07", "P4", "Sala Riunioni B", "sala_riunioni",  8, 40.0),
    ("Z-P4-08", "P4", "Reception P4",    "reception",      2, 30.0),
    ("Z-P4-09", "P4", "Corridoio P4",    "corridoio",      0, 80.0),
    # Piano 5
    ("Z-P5-01", "P5", "Open Space A",    "ufficio",       20, 200.0),
    ("Z-P5-02", "P5", "Open Space B",    "ufficio",       15, 150.0),
    ("Z-P5-03", "P5", "Ufficio 5A",      "ufficio",        6,  60.0),
    ("Z-P5-04", "P5", "Ufficio 5B",      "ufficio",        6,  60.0),
    ("Z-P5-05", "P5", "Sala Conferenze", "sala_riunioni", 20, 100.0),
    ("Z-P5-06", "P5", "Server Room",     "server",         0,  25.0),
    ("Z-P5-07", "P5", "Corridoio P5",    "corridoio",      0,  60.0),
    ("Z-P5-08", "P5", "Archivio P5",     "archivio",       0,  40.0),
]

# Definizione impianti: (plant_id, floor_id, zone_id, tipo)
PLANTS = [
    ("IMP-MAIN-MTR", None,   None,       "contatore"),
    ("IMP-P4-HVAC",  "P4",   None,       "hvac"),
    ("IMP-P4-LUX",   "P4",   None,       "illuminazione"),
    ("IMP-P4-SUB",   "P4",   None,       "altri_carichi"),
    ("IMP-P5-HVAC",  "P5",   None,       "hvac"),
    ("IMP-P5-LUX",   "P5",   None,       "illuminazione"),
    ("IMP-P5-SUB",   "P5",   None,       "altri_carichi"),
    ("IMP-CED",      None,   None,       "ced"),
    ("IMP-SERV-EM",  None,   None,       "servizi_em"),
]

# Baseline potenza per tipo impianto (kW)
# Asset 6: Sede Centrale Roma — 2 piani (P4: 650 mq, P5: 695 mq) = 1345 mq totali
# Target: ~9.500 kWh/mese = EUI ~85 kWh/mq/anno → classe C
# Ripartizione: HVAC 45%, Illuminazione 21%, Altri 21%, CED 8%, ServEM 5%
# Picco in orario lavorativo ~28 kW, media h24 ~13 kW
BASELINE_KW = {
    "contatore":     14.0,   # Contatore principale: media h24 ~13 kW
    "hvac":           6.0,   # HVAC per piano: picco 6 kW, media ~3 kW (spento di notte)
    "illuminazione":  3.0,   # Illuminazione per piano: picco 3 kW, quasi zero di notte
    "ups":            1.5,
    "generatore":     0.0,
    "ced":            1.8,   # CED: 4 server × 0.3 kW + storage 0.3 kW + switch 0.1 kW + condiz. 0.5 kW
    "servizi_em":     2.5,   # Servizi EM: pompe, ascensori — picco in orario
    "altri_carichi":  3.0,   # Altri carichi: prese, stampanti — picco in orario, stand-by di notte
}

# ── Funzioni di simulazione ─────────────────────────────────────────────────

def profilo_orario(ora: int, tipo: str) -> float:
    """Restituisce un moltiplicatore 0-1 basato sull'ora del giorno e tipo zona."""
    # Orario lavorativo: 8-19
    if tipo in ("ufficio", "sala_riunioni", "reception"):
        if 8 <= ora < 9:    return 0.3 + random.uniform(0, 0.2)
        if 9 <= ora < 12:   return 0.7 + random.uniform(0, 0.3)
        if 12 <= ora < 14:  return 0.3 + random.uniform(0, 0.2)  # pausa pranzo
        if 14 <= ora < 18:  return 0.6 + random.uniform(0, 0.3)
        if 18 <= ora < 20:  return 0.2 + random.uniform(0, 0.1)
        return 0.0
    elif tipo == "server":
        return 0.85 + random.uniform(0, 0.1)  # sempre acceso
    elif tipo == "corridoio":
        if 8 <= ora < 20:   return 0.1 + random.uniform(0, 0.1)
        return 0.0
    else:
        return 0.0

def simula_zona(zone_id: str, floor_id: str, tipo: str, capacita: int, ts: datetime) -> dict:
    """Genera una lettura di telemetria per una zona."""
    ora = ts.hour
    occ_factor = profilo_orario(ora, tipo)
    noise = random.gauss(0, 0.05)
    occ_factor = max(0.0, min(1.0, occ_factor + noise))

    # Temperatura: base 20°C, +2°C se occupato, variazione stagionale
    giorno_anno = ts.timetuple().tm_yday
    stagione = math.sin(2 * math.pi * (giorno_anno - 80) / 365)  # -1 inverno, +1 estate
    temp_base = 20.0 + stagione * 3.0
    temp = temp_base + occ_factor * 2.0 + random.gauss(0, 0.3)

    # CO2: base 400 ppm, +600 ppm a piena occupancy
    co2 = 400 + occ_factor * 600 + random.gauss(0, 20)

    # Umidità: 40-60%
    humidity = 50 + occ_factor * 5 + random.gauss(0, 2)

    # Potenza: proporzionale a superficie e occupancy
    if tipo == "server":
        power = 3.5 + random.gauss(0, 0.2)
    elif tipo == "corridoio":
        power = 0.5 * occ_factor + random.gauss(0, 0.05)
    elif tipo == "archivio":
        power = 0.2 + random.gauss(0, 0.05)
    else:
        power = (2.0 + occ_factor * 3.0) + random.gauss(0, 0.2)

    # Occupancy booleana (True se > 10% capacità)
    occupancy = occ_factor > 0.1

    # ── PUNTO DI INTEGRAZIONE SENSORE REALE ─────────────────────────────────
    # In produzione questo valore viene letto direttamente dal sensore:
    #   - People counter (telecamera AI): dato diretto in numero persone
    #   - Sensore PIR/microonde: dato binario → persone_presenti = None
    #   - Badge system: conteggio accessi per zona
    # Nel simulatore lo calcoliamo come stima: occ_factor × capacità massima
    # ────────────────────────────────────────────────────────────────────────
    persone_presenti = round(occ_factor * capacita) if capacita and capacita > 0 else None

    return {
        "asset_id": ASSET_ID,
        "floor_id": floor_id,
        "zone_id": zone_id,
        "plant_id": None,
        "power_kw": round(max(0, power), 3),
        "temp_c": round(temp, 2),
        "humidity": round(max(20, min(80, humidity)), 2),
        "co2_ppm": round(max(380, co2), 2),
        "occupancy": occupancy,
        "persone_presenti": persone_presenti
    }

def simula_impianto(plant_id: str, floor_id: str, tipo: str, ts: datetime) -> dict:
    """Genera una lettura di telemetria per un impianto."""
    ora = ts.hour
    is_working = 8 <= ora < 20
    baseline = BASELINE_KW.get(tipo, 5.0)

    if tipo == "contatore":
        # Contatore principale: somma tutti i consumi
        factor = (0.6 + random.uniform(0, 0.3)) if is_working else (0.2 + random.uniform(0, 0.1))
        power = baseline * factor
    elif tipo == "hvac":
        factor = (0.7 + random.uniform(0, 0.2)) if is_working else (0.1 + random.uniform(0, 0.1))
        power = baseline * factor
    elif tipo == "illuminazione":
        factor = (0.8 + random.uniform(0, 0.15)) if is_working else 0.05
        power = baseline * factor
    elif tipo == "ced":
        # Piccolo CED: 4-5 server + storage + switch + condizionatore sempre acceso
        # Carico quasi piatto h24 con leggere variazioni (batch notturni, backup)
        # Server: ~1.2 kW x5 = 6 kW, storage: ~1 kW, switch: ~0.3 kW, condizionatore: ~2 kW
        # Totale atteso: ~8-9 kW con variazione ±5%
        factor = 0.92 + random.gauss(0, 0.03)   # molto stabile, quasi flat
        # Leggero picco notturno per backup/aggiornamenti (00-05)
        if 0 <= ora < 5:
            factor += random.uniform(0, 0.05)   # +0-5% per batch notturni
        power = baseline * max(0.80, min(1.05, factor))
    elif tipo == "altri_carichi":
        # Prese, stampanti, caricatori, attrezzature varie
        # Seguono l'orario lavorativo ma con baseline minima sempre presente (stand-by)
        if is_working:
            factor = 0.55 + random.uniform(0, 0.35)  # 55-90% in orario (molto variabile)
        else:
            factor = 0.08 + random.uniform(0, 0.07)  # 8-15% fuori orario (stand-by)
        power = baseline * factor
    elif tipo == "servizi_em":
        # Servizi elettromeccanici: pompe, ascensori, UPS, gruppi elettrogeni
        # Picco in orario lavorativo (ascensori, pompe circolazione), minimo notturno
        if is_working:
            factor = 0.65 + random.uniform(0, 0.25)  # 65-90% in orario
        else:
            factor = 0.20 + random.uniform(0, 0.10)  # 20-30% fuori orario (solo UPS/pompe)
        power = baseline * factor
    else:
        power = baseline * (0.5 + random.uniform(0, 0.3))

    return {
        "asset_id": ASSET_ID,
        "floor_id": floor_id,
        "zone_id": None,
        "plant_id": plant_id,
        "power_kw": round(max(0, power), 3),
        "temp_c": None,
        "humidity": None,
        "co2_ppm": None,
        "occupancy": None
    }

def genera_batch(ts: datetime) -> list:
    """Genera un batch completo di letture per tutte le zone e impianti."""
    ts_iso = ts.isoformat()
    batch = []
    for zone_id, floor_id, nome, tipo, capacita, _ in ZONES:
        item = simula_zona(zone_id, floor_id, tipo, capacita, ts)
        item["ts"] = ts_iso
        batch.append(item)
    for plant_id, floor_id, zone_id, tipo in PLANTS:
        item = simula_impianto(plant_id, floor_id, tipo, ts)
        item["ts"] = ts_iso
        batch.append(item)
    return batch

def invia_batch(batch: list, verbose: bool = False) -> bool:
    """Invia un batch di letture al backend tramite REST."""
    url = f"{BASE_URL}/api/bems/telemetry/batch"
    data = json.dumps(batch).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST",
                                  headers={"Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        result = json.loads(resp.read())
        if verbose:
            print(f"  → Inserite {result.get('inserted', len(batch))} letture")
        return True
    except urllib.error.HTTPError as e:
        print(f"  ✗ HTTP {e.code}: {e.read().decode()[:200]}")
        return False
    except Exception as e:
        print(f"  ✗ Errore: {e}")
        return False

# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Gateway Simulator BEMS per PostgreSQL")
    parser.add_argument("--backfill", type=int, default=0,
                        help="Ore di dati storici da inserire (default: 0)")
    parser.add_argument("--backfill-interval", type=int, default=5,
                        help="Intervallo in minuti tra le letture storiche (default: 5)")
    parser.add_argument("--interval", type=int, default=300,
                        help="Intervallo in secondi tra le letture real-time (default: 300)")
    parser.add_argument("--no-loop", action="store_true",
                        help="Esegui solo il backfill senza loop real-time")
    parser.add_argument("--verbose", action="store_true",
                        help="Output verboso")
    args = parser.parse_args()

    print("=" * 60)
    print("Gateway Simulator BEMS - GAM Platform")
    print(f"Backend: {BASE_URL}")
    print(f"Asset ID: {ASSET_ID} (Sede Centrale Roma)")
    print(f"Zone: {len(ZONES)}, Impianti: {len(PLANTS)}")
    print("=" * 60)

    # ── Backfill dati storici ──────────────────────────────────────
    if args.backfill > 0:
        now = datetime.now(timezone.utc)
        start = now - timedelta(hours=args.backfill)
        step = timedelta(minutes=args.backfill_interval)
        ts = start
        count = 0
        total_steps = int(args.backfill * 60 / args.backfill_interval)
        print(f"\nBackfill: {args.backfill}h di dati storici ({total_steps} intervalli da {args.backfill_interval} min)")

        while ts <= now:
            batch = genera_batch(ts)
            ok = invia_batch(batch, verbose=args.verbose)
            if ok:
                count += 1
                if count % 20 == 0 or args.verbose:
                    print(f"  [{count}/{total_steps}] {ts.strftime('%Y-%m-%d %H:%M')} - {len(batch)} letture")
            ts += step
            time.sleep(0.05)  # Rate limiting

        print(f"\n✓ Backfill completato: {count} intervalli, {count * len(batch)} letture totali")

    # ── Loop real-time ─────────────────────────────────────────────
    if not args.no_loop:
        print(f"\nLoop real-time ogni {args.interval}s (Ctrl+C per fermare)")
        try:
            while True:
                ts = datetime.now(timezone.utc)
                batch = genera_batch(ts)
                ok = invia_batch(batch, verbose=True)
                if ok:
                    print(f"[{ts.strftime('%H:%M:%S')}] Batch inviato: {len(batch)} letture")
                else:
                    print(f"[{ts.strftime('%H:%M:%S')}] Errore invio batch")
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("\n\nSimulatore fermato.")

if __name__ == "__main__":
    main()
