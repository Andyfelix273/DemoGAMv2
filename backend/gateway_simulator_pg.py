#!/usr/bin/env python3
"""
Gateway Simulator BEMS per PostgreSQL/TimescaleDB
==================================================
Simula un gateway IoT che invia letture di telemetria al backend GAM
tramite l'endpoint REST /api/bems/telemetry/batch.

NESSUN DATO HARDCODED: zone, impianti, capacità e working hours vengono
caricati dal DB all'avvio, così il simulatore è sempre allineato con i
dati reali dell'asset.

Utilizzo:
    python3 gateway_simulator_pg.py --interval 60
    python3 gateway_simulator_pg.py --backfill 24 --no-loop
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
DB_DSN   = "postgresql://gamuser:gampassword@db:5432/gamdb"
ASSET_ID = 6  # Sede Centrale Roma

# Baseline kW di fallback se energia_baseline_kw è NULL nel DB
BASELINE_KW_DEFAULT = {
    "contatore":    27.0,
    "hvac":          5.5,
    "illuminazione": 2.5,
    "ups":           1.5,
    "generatore":    0.0,
    "ced":           1.8,
    "servizi_em":    2.0,
    "altri_carichi": 2.5,
}

# ── Caricamento configurazione dal DB ───────────────────────────────────────
def carica_config_da_db():
    """Legge zone, impianti e working hours dal DB. Nessun hardcoded."""
    import psycopg2
    conn = psycopg2.connect(DB_DSN)
    cur  = conn.cursor()

    # Zone dell'asset: (zone_id, floor_id, tipo, capacita_persone)
    cur.execute("""
        SELECT zone_id, floor_id, tipo, COALESCE(capacita_persone, 0)
        FROM zones WHERE asset_id = %s ORDER BY floor_id, zone_id
    """, (ASSET_ID,))
    zones = cur.fetchall()

    # Impianti: (plant_id, floor_id, tipo, baseline_kw)
    cur.execute("""
        SELECT plant_id, floor_id, tipo,
               COALESCE(energia_baseline_kw, energy_baseline_kw)
        FROM plants WHERE asset_id = %s ORDER BY plant_id
    """, (ASSET_ID,))
    plants = []
    for plant_id, floor_id, tipo, baseline in cur.fetchall():
        kw = float(baseline) if baseline else BASELINE_KW_DEFAULT.get(tipo, 2.0)
        plants.append((plant_id, floor_id, tipo, kw))

    # Working hours dell'asset
    cur.execute("""
        SELECT working_hours_start, working_hours_end, working_days
        FROM assets WHERE id = %s
    """, (ASSET_ID,))
    row = cur.fetchone()
    wh_start = row[0].hour if row and row[0] else 8
    wh_end   = row[1].hour if row and row[1] else 19
    wd_str   = row[2] if row and row[2] else "MON,TUE,WED,THU,FRI"
    wd_map   = {"MON":0,"TUE":1,"WED":2,"THU":3,"FRI":4,"SAT":5,"SUN":6}
    working_days = {wd_map[d] for d in wd_str.split(",") if d in wd_map}

    conn.close()
    return zones, plants, wh_start, wh_end, working_days


# ── Profilo orario per tipo zona ─────────────────────────────────────────────
def profilo_orario(ora: int, tipo: str, wh_start: int, wh_end: int) -> float:
    """Fattore 0-1 di occupancy basato su ora e tipo zona, relativo all'orario lavorativo."""
    if tipo in ("server_room", "server", "ced"):
        return 0.85 + random.uniform(0, 0.1)
    if ora < wh_start or ora >= wh_end:
        return 0.0

    rel    = ora - wh_start
    durata = wh_end - wh_start
    meta   = durata // 2

    if tipo == "ufficio":
        if rel == 0:               return 0.30 + random.uniform(0, 0.20)
        if 1 <= rel < meta:        return 0.70 + random.uniform(0, 0.25)
        if rel == meta:            return 0.40 + random.uniform(0, 0.15)
        if meta < rel < durata-1:  return 0.65 + random.uniform(0, 0.25)
        return 0.20 + random.uniform(0, 0.10)

    elif tipo == "open_space":
        if rel == 0:               return 0.25 + random.uniform(0, 0.15)
        if 1 <= rel < meta:        return 0.65 + random.uniform(0, 0.25)
        if rel == meta:            return 0.35 + random.uniform(0, 0.15)
        if meta < rel < durata-1:  return 0.60 + random.uniform(0, 0.25)
        return 0.15 + random.uniform(0, 0.10)

    elif tipo in ("sala", "sala_riunioni"):
        if rel == 0:               return 0.10 + random.uniform(0, 0.15)
        if 1 <= rel < meta:        return 0.55 + random.uniform(0, 0.35)
        if rel == meta:            return 0.05 + random.uniform(0, 0.10)
        if meta < rel < durata-1:  return 0.60 + random.uniform(0, 0.30)
        return 0.10 + random.uniform(0, 0.10)

    elif tipo == "laboratorio":
        if rel == 0:               return 0.30 + random.uniform(0, 0.20)
        if 1 <= rel < meta:        return 0.55 + random.uniform(0, 0.20)
        if rel == meta:            return 0.40 + random.uniform(0, 0.15)
        if meta < rel < durata-1:  return 0.70 + random.uniform(0, 0.25)
        return 0.25 + random.uniform(0, 0.10)

    elif tipo == "break":
        if rel == 1:               return 0.35 + random.uniform(0, 0.20)
        if rel == meta:            return 0.75 + random.uniform(0, 0.20)
        if rel == meta + 1:        return 0.35 + random.uniform(0, 0.20)
        return 0.10 + random.uniform(0, 0.10)

    elif tipo == "reception":
        if rel == 0:               return 0.60 + random.uniform(0, 0.20)
        if 1 <= rel < durata-1:    return 0.40 + random.uniform(0, 0.20)
        return 0.20 + random.uniform(0, 0.10)

    elif tipo == "corridoio":
        return 0.05 + random.uniform(0, 0.05)

    else:
        # servizi, vano_tecnico, deposito, archivio → non monitorati
        return 0.0


# ── Simulazione zona ─────────────────────────────────────────────────────────
def simula_zona(zone_id, floor_id, tipo, capacita, ts, wh_start, wh_end, working_days):
    ora = ts.hour
    is_working_day = ts.weekday() in working_days
    if not is_working_day and tipo not in ("server_room", "server", "ced"):
        occ_factor = 0.0
    else:
        occ_factor = profilo_orario(ora, tipo, wh_start, wh_end)
    occ_factor = max(0.0, min(1.0, occ_factor + random.gauss(0, 0.04)))

    # Persone presenti: cappate a capacita_persone
    if capacita and capacita > 0:
        persone_presenti = min(round(occ_factor * capacita), capacita)
    else:
        persone_presenti = None

    # Sensori ambientali
    giorno_anno = ts.timetuple().tm_yday
    stagione  = math.sin(2 * math.pi * (giorno_anno - 80) / 365)
    temp      = 20.0 + stagione * 3.0 + occ_factor * 2.0 + random.gauss(0, 0.3)
    co2       = 400 + occ_factor * 600 + random.gauss(0, 20)
    humidity  = 50 + occ_factor * 5 + random.gauss(0, 2)
    power_kw  = max(0.05, 0.3 + occ_factor * 0.8 + random.gauss(0, 0.05))

    return {
        "asset_id":         ASSET_ID,
        "floor_id":         floor_id,
        "zone_id":          zone_id,
        "plant_id":         None,
        "power_kw":         round(power_kw, 3),
        "temp_c":           round(temp, 1),
        "humidity":         round(max(20, min(80, humidity)), 1),
        "co2_ppm":          round(max(300, co2), 0),
        "occupancy":        occ_factor > 0.05,
        "persone_presenti": persone_presenti,
    }


# ── Simulazione impianto ─────────────────────────────────────────────────────
def simula_impianto(plant_id, floor_id, tipo, baseline_kw, ts, wh_start, wh_end, working_days, sub_total_kw=None):
    ora = ts.hour
    is_working_day = ts.weekday() in working_days
    in_orario = is_working_day and (wh_start <= ora < wh_end)

    if tipo == "contatore":
        if sub_total_kw is not None:
            consumo_kw = sub_total_kw * 1.05 + random.gauss(0, 0.2)
        else:
            consumo_kw = baseline_kw * (1.0 if in_orario else 0.35) + random.gauss(0, 0.5)

    elif tipo == "hvac":
        if not in_orario:
            fattore = 0.15 + random.uniform(0, 0.05)
        else:
            rel = ora - wh_start
            fattore = 0.6 + 0.4 * math.sin(math.pi * rel / max(1, wh_end - wh_start)) + random.gauss(0, 0.05)
            fattore = max(0.3, min(1.0, fattore))
        consumo_kw = baseline_kw * fattore

    elif tipo == "illuminazione":
        fattore = (0.85 + random.gauss(0, 0.05)) if in_orario else (0.02 + random.uniform(0, 0.02))
        consumo_kw = baseline_kw * fattore

    elif tipo == "altri_carichi":
        fattore = (0.70 + random.gauss(0, 0.10)) if in_orario else (0.10 + random.uniform(0, 0.05))
        consumo_kw = baseline_kw * fattore

    elif tipo == "ced":
        fattore = 0.90 + random.gauss(0, 0.03)
        if 0 <= ora < 5:
            fattore += random.uniform(0, 0.05)
        consumo_kw = baseline_kw * max(0.80, min(1.05, fattore))

    elif tipo == "servizi_em":
        fattore = (0.75 + random.gauss(0, 0.10)) if in_orario else (0.20 + random.uniform(0, 0.05))
        consumo_kw = baseline_kw * fattore

    else:
        consumo_kw = baseline_kw * (0.5 + random.gauss(0, 0.1))

    return {
        "asset_id":         ASSET_ID,
        "floor_id":         floor_id,
        "zone_id":          None,
        "plant_id":         plant_id,
        "power_kw":         round(max(0, consumo_kw), 3),
        "occupancy":        None,
        "persone_presenti": None,
    }


# ── Generazione batch ────────────────────────────────────────────────────────
def genera_batch(ts, zones, plants, wh_start, wh_end, working_days):
    ts_iso = ts.isoformat()
    batch  = []

    # Zone
    for zone_id, floor_id, tipo, capacita in zones:
        item = simula_zona(zone_id, floor_id, tipo, capacita, ts, wh_start, wh_end, working_days)
        item["ts"] = ts_iso
        batch.append(item)

    # Impianti sub (escluso contatore principale)
    sub_items  = []
    main_plant = None
    for plant_id, floor_id, tipo, baseline_kw in plants:
        if tipo == "contatore":
            main_plant = (plant_id, floor_id, tipo, baseline_kw)
            continue
        item = simula_impianto(plant_id, floor_id, tipo, baseline_kw, ts, wh_start, wh_end, working_days)
        item["ts"] = ts_iso
        sub_items.append(item)
        batch.append(item)

    # Contatore principale = somma sub × 1.05
    if main_plant:
        sub_total = sum(i.get("power_kw", 0) for i in sub_items)
        plant_id, floor_id, tipo, baseline_kw = main_plant
        item = simula_impianto(plant_id, floor_id, tipo, baseline_kw, ts, wh_start, wh_end, working_days, sub_total_kw=sub_total)
        item["ts"] = ts_iso
        batch.append(item)

    return batch


# ── Invio batch ──────────────────────────────────────────────────────────────
def invia_batch(batch, verbose=False):
    url  = f"{BASE_URL}/api/bems/telemetry/batch"
    data = json.dumps(batch).encode("utf-8")
    req  = urllib.request.Request(url, data=data, method="POST",
                                  headers={"Content-Type": "application/json"})
    try:
        resp   = urllib.request.urlopen(req, timeout=10)
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
    parser = argparse.ArgumentParser(description="Gateway Simulator BEMS — config da DB")
    parser.add_argument("--backfill",          type=int, default=0)
    parser.add_argument("--backfill-interval", type=int, default=5)
    parser.add_argument("--interval",          type=int, default=60)
    parser.add_argument("--no-loop",           action="store_true")
    parser.add_argument("--verbose",           action="store_true")
    args = parser.parse_args()

    print("=" * 60)
    print("Gateway Simulator BEMS — GAM Platform (config da DB)")
    print(f"Backend : {BASE_URL}  |  Asset: {ASSET_ID}")

    zones, plants, wh_start, wh_end, working_days = carica_config_da_db()

    wd_names = {0:"MON",1:"TUE",2:"WED",3:"THU",4:"FRI",5:"SAT",6:"SUN"}
    wd_str   = ",".join(wd_names[d] for d in sorted(working_days))
    print(f"Zone    : {len(zones)}  |  Impianti: {len(plants)}")
    print(f"Orario  : {wh_start:02d}:00 – {wh_end:02d}:00  |  Giorni: {wd_str}")
    print("=" * 60)

    if args.backfill > 0:
        now   = datetime.now(timezone.utc)
        start = now - timedelta(hours=args.backfill)
        step  = timedelta(minutes=args.backfill_interval)
        ts    = start
        count = 0
        total = int(args.backfill * 60 / args.backfill_interval)
        print(f"\nBackfill: {args.backfill}h ({total} intervalli da {args.backfill_interval} min)")
        while ts <= now:
            batch = genera_batch(ts, zones, plants, wh_start, wh_end, working_days)
            ok = invia_batch(batch, verbose=args.verbose)
            if ok:
                count += 1
                if count % 20 == 0 or args.verbose:
                    print(f"  [{count}/{total}] {ts.strftime('%Y-%m-%d %H:%M')} — {len(batch)} letture")
            ts += step
            time.sleep(0.05)
        print(f"\n✓ Backfill: {count} intervalli, ~{count*len(batch)} letture")

    if not args.no_loop:
        print(f"\nLoop real-time ogni {args.interval}s (Ctrl+C per fermare)")
        try:
            while True:
                ts    = datetime.now(timezone.utc)
                batch = genera_batch(ts, zones, plants, wh_start, wh_end, working_days)
                ok    = invia_batch(batch, verbose=True)
                tag   = "OK" if ok else "ERR"
                print(f"[{ts.strftime('%H:%M:%S')}] [{tag}] {len(batch)} letture "
                      f"({len(zones)} zone + {len(plants)} impianti)")
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("\nSimulatore fermato.")


if __name__ == "__main__":
    main()
