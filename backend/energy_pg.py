"""
GIS Asset Manager - Modulo Energy (PostgreSQL + TimescaleDB)
Versione: 2.0
Autore: Felix / KeyBiz

Gestisce il metering energetico near-real-time per il modulo Asset Efficiency.
Usa psycopg2 con PostgreSQL e TimescaleDB per la tabella energy_readings (hypertable).

Tabelle gestite:
  energy_meters     - configurazione contatori per asset (elettrico, termico, gas)
  energy_readings   - letture storiche (15-min interval) — hypertable TimescaleDB
  energy_targets    - target di consumo mensili per asset
"""

import asyncio
import random
import os
import psycopg2
import psycopg2.extras
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://gamuser:gampassword@localhost:5432/gamdb"
)


def _get_pg_conn():
    return psycopg2.connect(DATABASE_URL)


# ── Schema DB ─────────────────────────────────────────────────────────────────

def migrate_bems_studio_schema(database_url: str = None):
    """Migrazione BEMS Studio: aggiunge colonne mqtt_config/sensori_config a plants
    e crea la tabella bems_studio_sessions."""
    url = database_url or DATABASE_URL
    conn = psycopg2.connect(url)
    cur = conn.cursor()
    try:
        cur.execute("""
            ALTER TABLE plants
                ADD COLUMN IF NOT EXISTS mqtt_config     JSONB DEFAULT NULL;
            ALTER TABLE plants
                ADD COLUMN IF NOT EXISTS sensori_config  JSONB DEFAULT NULL;
            ALTER TABLE plants
                ADD COLUMN IF NOT EXISTS note_integratore TEXT DEFAULT NULL;
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS bems_studio_sessions (
                id          SERIAL PRIMARY KEY,
                asset_id    INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
                nome        TEXT NOT NULL,
                integratore TEXT,
                stato       TEXT NOT NULL DEFAULT 'bozza',
                config_json JSONB NOT NULL DEFAULT '{}',
                created_at  TIMESTAMPTZ DEFAULT NOW(),
                updated_at  TIMESTAMPTZ DEFAULT NOW()
            );
        """)
        conn.commit()
        print("[bems_studio] Schema migrato OK (mqtt_config, sensori_config, bems_studio_sessions)")
    except Exception as e:
        conn.rollback()
        print(f"[bems_studio] Errore migrazione schema: {e}")
    finally:
        cur.close()
        conn.close()


def migrate_energy_schema(database_url: str = None):
    """Applica lo schema energy al DB PostgreSQL. Crea hypertable TimescaleDB."""
    url = database_url or DATABASE_URL
    conn = psycopg2.connect(url)
    cur = conn.cursor()
    try:
        cur.execute("""
        CREATE TABLE IF NOT EXISTS energy_meters (
            id         SERIAL PRIMARY KEY,
            asset_id   INTEGER NOT NULL REFERENCES assets(id),
            tipo       TEXT NOT NULL,
            label      TEXT NOT NULL,
            unita      TEXT NOT NULL DEFAULT 'kWh',
            attivo     INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(asset_id, tipo)
        );

        CREATE TABLE IF NOT EXISTS energy_readings (
            id             SERIAL,
            meter_id       INTEGER NOT NULL REFERENCES energy_meters(id),
            asset_id       INTEGER NOT NULL,
            ts             TIMESTAMPTZ NOT NULL,
            valore         DOUBLE PRECISION NOT NULL,
            intervallo_min INTEGER NOT NULL DEFAULT 15,
            UNIQUE(meter_id, ts)
        );

        CREATE TABLE IF NOT EXISTS energy_targets (
            id         SERIAL PRIMARY KEY,
            asset_id   INTEGER NOT NULL REFERENCES assets(id),
            anno       INTEGER NOT NULL,
            mese       INTEGER NOT NULL,
            tipo       TEXT NOT NULL,
            target_kwh DOUBLE PRECISION NOT NULL,
            UNIQUE(asset_id, anno, mese, tipo)
        );
        """)
        conn.commit()

        # Converti energy_readings in hypertable TimescaleDB (idempotente)
        try:
            cur.execute("""
                SELECT create_hypertable(
                    'energy_readings', 'ts',
                    if_not_exists => TRUE,
                    migrate_data => TRUE
                );
            """)
            conn.commit()
            print("[energy] hypertable TimescaleDB creata per energy_readings")
        except Exception as e:
            conn.rollback()
            print(f"[energy] TimescaleDB non disponibile, uso indici standard: {e}")
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_energy_readings_asset_ts
                    ON energy_readings(asset_id, ts DESC);
                CREATE INDEX IF NOT EXISTS idx_energy_readings_meter_ts
                    ON energy_readings(meter_id, ts DESC);
            """)
            conn.commit()
    finally:
        cur.close()
        conn.close()


# ── Profili di carico simulati ────────────────────────────────────────────────

_LOAD_WEEKDAY = [
    0.10, 0.08, 0.08, 0.08, 0.09, 0.12,
    0.25, 0.55, 0.80, 0.90, 0.95, 0.92,
    0.85, 0.88, 0.92, 0.90, 0.85, 0.70,
    0.45, 0.30, 0.22, 0.18, 0.14, 0.11,
]

_LOAD_WEEKEND = [
    0.08, 0.07, 0.07, 0.07, 0.07, 0.08,
    0.10, 0.12, 0.15, 0.18, 0.20, 0.18,
    0.15, 0.14, 0.13, 0.12, 0.11, 0.10,
    0.09, 0.09, 0.08, 0.08, 0.08, 0.08,
]

# Baseline kW/100mq in picco orario lavorativo.
# Formula: kw_picco = base * (sup/100); kW_medi_h24 = kw_picco * load_medio (~0.38)
# EUI annuo = kW_medi * 8760 / sup = base * 0.38 * 8760 / 100
# Target EUI: stabilimento ~200, ufficio ~80, magazzino ~60, deposito ~45 kWh/mq/anno
_BASE_KW_PER_100M2 = {
    "ufficio":      2.4,   # EUI ~80 kWh/mq/anno  (2.4 * 0.38 * 8760/100 = 80)
    "stabilimento": 6.0,   # EUI ~200 kWh/mq/anno (6.0 * 0.38 * 8760/100 = 200)
    "magazzino":    1.8,   # EUI ~60 kWh/mq/anno  (1.8 * 0.38 * 8760/100 = 60)
    "deposito":     1.35,  # EUI ~45 kWh/mq/anno  (1.35 * 0.38 * 8760/100 = 45)
}

_VECTOR_FACTOR = {
    "elettrico": 1.0,
    "termico":   0.6,
    "gas":       0.4,
}


def _simulate_reading(asset_tipo: str, superficie_mq: int,
                      vettore: str, ts: datetime,
                      intervallo_min: int = 15) -> float:
    tipo_norm = (asset_tipo or "ufficio").lower()
    base_kw = _BASE_KW_PER_100M2.get(tipo_norm, 6.0)
    factor_v = _VECTOR_FACTOR.get(vettore, 1.0)
    is_weekend = ts.weekday() >= 5
    profile = _LOAD_WEEKEND if is_weekend else _LOAD_WEEKDAY
    load = profile[ts.hour]
    load = max(0.02, min(1.0, load + random.gauss(0, 0.04)))
    kw_totali = base_kw * (superficie_mq / 100.0) * factor_v * load
    kwh = kw_totali * (intervallo_min / 60.0)
    return round(kwh, 4)


# ── Simulatore asincrono ──────────────────────────────────────────────────────

async def run_energy_simulator(db_path: str = None, intervallo_sec: int = 300):
    """Task asincrono che genera letture simulate ogni intervallo_sec secondi."""
    while True:
        try:
            conn = _get_pg_conn()
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            now = datetime.now(timezone.utc)

            cur.execute("""
                SELECT em.id, em.asset_id, em.tipo,
                       a.tipo AS asset_tipo, a.superficie_mq
                FROM energy_meters em
                JOIN assets a ON a.id = em.asset_id
                WHERE em.attivo = 1
            """)
            meters = cur.fetchall()

            for m in meters:
                superficie = m["superficie_mq"] or 500
                valore = _simulate_reading(
                    asset_tipo=m["asset_tipo"],
                    superficie_mq=superficie,
                    vettore=m["tipo"],
                    ts=now,
                    intervallo_min=intervallo_sec // 60,
                )
                cur.execute("""
                    INSERT INTO energy_readings (meter_id, asset_id, ts, valore, intervallo_min)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (meter_id, ts) DO NOTHING
                """, (m["id"], m["asset_id"], now, valore, intervallo_sec // 60))

            conn.commit()
            cur.close()
            conn.close()
        except Exception as exc:
            print(f"[energy-simulator] errore: {exc}")

        await asyncio.sleep(intervallo_sec)


# ── Seed dati ─────────────────────────────────────────────────────────────────

def seed_energy_meters(db_path: str = None):
    """Popola energy_meters per tutti gli asset attivi (skip se già presenti)."""
    conn = _get_pg_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT id, tipo FROM assets WHERE stato='attivo'")
    assets = cur.fetchall()

    vettori = [
        ("elettrico", "kWh",    "Contatore Elettrico"),
        ("termico",   "kWh_th", "Contatore Termico"),
        ("gas",       "m3",     "Contatore Gas"),
    ]

    for asset in assets:
        for tipo, unita, label in vettori:
            cur.execute("""
                INSERT INTO energy_meters (asset_id, tipo, label, unita)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (asset_id, tipo) DO NOTHING
            """, (asset["id"], tipo, label, unita))

    conn.commit()
    cur.close()
    conn.close()


def seed_energy_history(db_path: str = None, giorni: int = 30):
    """Genera letture storiche simulate. Skip se il DB contiene già letture."""
    conn = _get_pg_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute("SELECT COUNT(*) AS cnt FROM energy_readings")
    if cur.fetchone()["cnt"] > 0:
        cur.close()
        conn.close()
        return

    cur.execute("""
        SELECT em.id, em.asset_id, em.tipo,
               a.tipo AS asset_tipo, a.superficie_mq
        FROM energy_meters em
        JOIN assets a ON a.id = em.asset_id
        WHERE em.attivo = 1
    """)
    meters = cur.fetchall()

    now = datetime.now(timezone.utc)
    start = now - timedelta(days=giorni)
    step = timedelta(minutes=15)

    batch = []
    ts = start
    while ts <= now:
        for m in meters:
            superficie = m["superficie_mq"] or 500
            valore = _simulate_reading(
                asset_tipo=m["asset_tipo"],
                superficie_mq=superficie,
                vettore=m["tipo"],
                ts=ts,
                intervallo_min=15,
            )
            batch.append((m["id"], m["asset_id"], ts, valore, 15))
        ts += step
        if len(batch) >= 5000:
            psycopg2.extras.execute_values(cur, """
                INSERT INTO energy_readings (meter_id, asset_id, ts, valore, intervallo_min)
                VALUES %s
                ON CONFLICT (meter_id, ts) DO NOTHING
            """, batch)
            conn.commit()
            batch = []

    if batch:
        psycopg2.extras.execute_values(cur, """
            INSERT INTO energy_readings (meter_id, asset_id, ts, valore, intervallo_min)
            VALUES %s
            ON CONFLICT (meter_id, ts) DO NOTHING
        """, batch)
        conn.commit()

    cur.close()
    conn.close()
    print(f"[energy] storico {giorni}gg generato per {len(meters)} contatori")


# ── Router FastAPI ────────────────────────────────────────────────────────────

def register_energy_routes(app, get_db, get_utente_corrente):
    """Registra gli endpoint energy sull'app FastAPI."""

    def _ts_range(ore: int):
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(hours=ore)
        return ts_from, now

    def _kwh_period(cur, asset_id: int, tipo: str, ts_from, ts_to) -> float:
        cur.execute("""
            SELECT COALESCE(SUM(r.valore), 0.0) AS tot
            FROM energy_readings r
            JOIN energy_meters m ON m.id = r.meter_id
            WHERE r.asset_id = %s AND m.tipo = %s
              AND r.ts >= %s AND r.ts <= %s
        """, (asset_id, tipo, ts_from, ts_to))
        return round(cur.fetchone()["tot"], 2)

    def _co2_from_kwh(kwh: float) -> float:
        return round(kwh * 0.233, 2)

    def _cost_from_kwh(kwh: float, tipo: str) -> float:
        tariffe = {"elettrico": 0.25, "termico": 0.12, "gas": 0.95}
        return round(kwh * tariffe.get(tipo, 0.20), 2)

    @app.get("/api/energy/meters", tags=["energy"])
    def get_meters(asset_id: Optional[int] = None,
                   _=Depends(get_utente_corrente),
                   db=Depends(get_db)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if asset_id:
            cur.execute("""
                SELECT em.*, a.nome AS asset_nome, a.tipo AS asset_tipo
                FROM energy_meters em
                JOIN assets a ON a.id = em.asset_id
                WHERE em.asset_id = %s AND em.attivo = 1
                ORDER BY em.tipo
            """, (asset_id,))
        else:
            cur.execute("""
                SELECT em.*, a.nome AS asset_nome, a.tipo AS asset_tipo
                FROM energy_meters em
                JOIN assets a ON a.id = em.asset_id
                WHERE em.attivo = 1
                ORDER BY em.asset_id, em.tipo
            """)
        return [dict(r) for r in cur.fetchall()]

    @app.get("/api/energy/readings/{asset_id}", tags=["energy"])
    def get_readings(asset_id: int,
                     ore: int = 24,
                     tipo: Optional[str] = None,
                     _=Depends(get_utente_corrente),
                     db=Depends(get_db)):
        ts_from, ts_to = _ts_range(ore)
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if tipo:
            cur.execute("""
                SELECT r.ts, r.valore, r.intervallo_min, m.tipo, m.unita, m.label
                FROM energy_readings r
                JOIN energy_meters m ON m.id = r.meter_id
                WHERE r.asset_id = %s AND m.tipo = %s
                  AND r.ts >= %s AND r.ts <= %s
                ORDER BY r.ts ASC
            """, (asset_id, tipo, ts_from, ts_to))
        else:
            cur.execute("""
                SELECT r.ts, r.valore, r.intervallo_min, m.tipo, m.unita, m.label
                FROM energy_readings r
                JOIN energy_meters m ON m.id = r.meter_id
                WHERE r.asset_id = %s
                  AND r.ts >= %s AND r.ts <= %s
                ORDER BY m.tipo, r.ts ASC
            """, (asset_id, ts_from, ts_to))
        rows = cur.fetchall()
        # Serializza datetime in ISO string
        result = []
        for r in rows:
            d = dict(r)
            if isinstance(d.get("ts"), datetime):
                d["ts"] = d["ts"].isoformat()
            result.append(d)
        return result

    @app.get("/api/energy/summary/{asset_id}", tags=["energy"])
    def get_summary_asset(asset_id: int,
                          _=Depends(get_utente_corrente),
                          db=Depends(get_db)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT id, nome, tipo, superficie_mq FROM assets WHERE id=%s",
            (asset_id,)
        )
        asset = cur.fetchone()
        if not asset:
            raise HTTPException(status_code=404, detail="Asset non trovato")

        superficie = asset["superficie_mq"] or 1
        now = datetime.now(timezone.utc)
        oggi_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        sett_start = oggi_start - timedelta(days=7)
        mese_start = oggi_start.replace(day=1)
        sett_prec_start = sett_start - timedelta(days=7)

        vettori = ["elettrico", "termico", "gas"]
        result = {
            "asset_id": asset_id,
            "asset_nome": asset["nome"],
            "superficie_mq": superficie,
            "vettori": {},
            "totale_kwh_oggi": 0.0,
            "kwh_m2_oggi": 0.0,
            "co2_kg_oggi": 0.0,
            "costo_eur_oggi": 0.0,
            "trend_vs_settimana_prec_pct": 0.0,
        }

        kwh_oggi_tot = 0.0
        kwh_sett_tot = 0.0
        kwh_sett_prec_tot = 0.0

        for v in vettori:
            kwh_oggi = _kwh_period(cur, asset_id, v, oggi_start, now)
            kwh_sett = _kwh_period(cur, asset_id, v, sett_start, now)
            kwh_mese = _kwh_period(cur, asset_id, v, mese_start, now)
            kwh_sett_prec = _kwh_period(cur, asset_id, v, sett_prec_start, sett_start)

            result["vettori"][v] = {
                "kwh_oggi": kwh_oggi,
                "kwh_settimana": kwh_sett,
                "kwh_mese": kwh_mese,
                "costo_eur_oggi": _cost_from_kwh(kwh_oggi, v),
            }
            kwh_oggi_tot += kwh_oggi
            kwh_sett_tot += kwh_sett
            kwh_sett_prec_tot += kwh_sett_prec

        result["totale_kwh_oggi"] = round(kwh_oggi_tot, 2)
        result["kwh_m2_oggi"] = round(kwh_oggi_tot / superficie, 4)
        result["co2_kg_oggi"] = _co2_from_kwh(
            result["vettori"].get("elettrico", {}).get("kwh_oggi", 0)
        )
        result["costo_eur_oggi"] = round(
            sum(v["costo_eur_oggi"] for v in result["vettori"].values()), 2
        )
        if kwh_sett_prec_tot > 0:
            trend = ((kwh_sett_tot - kwh_sett_prec_tot) / kwh_sett_prec_tot) * 100
            result["trend_vs_settimana_prec_pct"] = round(trend, 1)

        return result

    @app.get("/api/energy/summary", tags=["energy"])
    def get_summary_all(_=Depends(get_utente_corrente), db=Depends(get_db)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT id FROM assets WHERE stato='attivo'")
        assets = cur.fetchall()
        results = []
        for a in assets:
            try:
                summary = get_summary_asset(a["id"], _, db)
                results.append(summary)
            except Exception:
                pass
        results.sort(key=lambda x: x.get("kwh_m2_oggi", 0), reverse=True)
        return results

    @app.get("/api/energy/heatmap", tags=["energy"])
    def get_heatmap(_=Depends(get_utente_corrente), db=Depends(get_db)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT id, nome, tipo, lat, lon, superficie_mq
            FROM assets WHERE stato='attivo'
        """)
        assets = cur.fetchall()

        now = datetime.now(timezone.utc)
        oggi_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

        result = []
        kwh_m2_values = []

        for a in assets:
            superficie = a["superficie_mq"] or 1
            kwh_tot = sum(
                _kwh_period(cur, a["id"], v, oggi_start, now)
                for v in ["elettrico", "termico", "gas"]
            )
            kwh_m2 = round(kwh_tot / superficie, 4)
            kwh_m2_values.append(kwh_m2)
            result.append({
                "asset_id": a["id"],
                "nome": a["nome"],
                "tipo": a["tipo"],
                "lat": a["lat"],
                "lon": a["lon"],
                "kwh_oggi": round(kwh_tot, 2),
                "kwh_m2_oggi": kwh_m2,
            })

        if kwh_m2_values:
            max_val = max(kwh_m2_values) or 1
            min_val = min(kwh_m2_values)
            for item in result:
                if max_val > min_val:
                    score = 100 - ((item["kwh_m2_oggi"] - min_val) / (max_val - min_val)) * 100
                else:
                    score = 100
                item["efficiency_score"] = round(score, 1)
                if score >= 70:
                    item["efficiency_level"] = "alta"
                    item["color"] = "green"   # retrocompatibilità
                elif score >= 40:
                    item["efficiency_level"] = "media"
                    item["color"] = "orange"  # retrocompatibilità
                else:
                    item["efficiency_level"] = "bassa"
                    item["color"] = "red"     # retrocompatibilità

        return result

    @app.get("/api/energy/anomalies", tags=["energy"])
    def get_anomalies(_=Depends(get_utente_corrente), db=Depends(get_db)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT id, nome, tipo, superficie_mq FROM assets WHERE stato='attivo'")
        assets = cur.fetchall()

        now = datetime.now(timezone.utc)
        ts_2d = now - timedelta(days=2)
        ts_14d = now - timedelta(days=14)

        anomalies = []
        for a in assets:
            kwh_recenti = sum(
                _kwh_period(cur, a["id"], v, ts_2d, now)
                for v in ["elettrico", "termico", "gas"]
            )
            kwh_storici = sum(
                _kwh_period(cur, a["id"], v, ts_14d, ts_2d)
                for v in ["elettrico", "termico", "gas"]
            )
            media_giornaliera = kwh_storici / 12.0 if kwh_storici > 0 else 0
            media_2gg = media_giornaliera * 2

            if media_2gg > 0:
                delta_pct = ((kwh_recenti - media_2gg) / media_2gg) * 100
                if delta_pct > 30:
                    anomalies.append({
                        "asset_id": a["id"],
                        "nome": a["nome"],
                        "tipo": a["tipo"],
                        "kwh_ultimi_2gg": round(kwh_recenti, 2),
                        "media_2gg_storica": round(media_2gg, 2),
                        "delta_pct": round(delta_pct, 1),
                        "severita": "alta" if delta_pct > 60 else "media",
                    })

        anomalies.sort(key=lambda x: x["delta_pct"], reverse=True)
        return anomalies


    # ── BEMS: Piani, Zone, Impianti ───────────────────────────────────────────

    @app.get("/api/bems/buildings/{asset_id}/floors", tags=["bems"])
    def get_floors(asset_id: int,
                   _=Depends(get_utente_corrente),
                   db=Depends(get_db)):
        """Lista piani dell'edificio."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT f.id, f.floor_id, f.nome, f.level, f.superficie_mq,
                   f.svg_file, f.ifc_storey_guid
            FROM floors f
            WHERE f.asset_id = %s
            ORDER BY f.level
        """, (asset_id,))
        return [dict(r) for r in cur.fetchall()]

    @app.get("/api/bems/buildings/{asset_id}/zones", tags=["bems"])
    def get_zones(asset_id: int,
                  floor_id: Optional[str] = None,
                  _=Depends(get_utente_corrente),
                  db=Depends(get_db)):
        """Lista zone energetiche dell'edificio, opzionalmente filtrate per piano."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if floor_id:
            cur.execute("""
                SELECT z.*, f.nome AS floor_nome
                FROM zones z
                LEFT JOIN floors f ON f.floor_id = z.floor_id AND f.asset_id = z.asset_id
                WHERE z.asset_id = %s AND z.floor_id = %s
                ORDER BY f.level, z.nome
            """, (asset_id, floor_id))
        else:
            cur.execute("""
                SELECT z.*, f.nome AS floor_nome
                FROM zones z
                LEFT JOIN floors f ON f.floor_id = z.floor_id AND f.asset_id = z.asset_id
                WHERE z.asset_id = %s
                ORDER BY f.level, z.nome
            """, (asset_id,))
        return [dict(r) for r in cur.fetchall()]

    @app.get("/api/bems/buildings/{asset_id}/plants", tags=["bems"])
    def get_plants(asset_id: int,
                   floor_id: Optional[str] = None,
                   zone_id: Optional[str] = None,
                   _=Depends(get_utente_corrente),
                   db=Depends(get_db)):
        """Lista impianti con stato operativo e ultima lettura di potenza."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        query = """
            SELECT p.*, f.nome AS floor_nome, z.nome AS zone_nome
            FROM plants p
            LEFT JOIN floors f ON f.floor_id = p.floor_id AND f.asset_id = p.asset_id
            LEFT JOIN zones z ON z.zone_id = p.zone_id AND z.asset_id = p.asset_id
            WHERE p.asset_id = %s
        """
        params: list = [asset_id]
        if floor_id:
            query += " AND p.floor_id = %s"
            params.append(floor_id)
        if zone_id:
            query += " AND p.zone_id = %s"
            params.append(zone_id)
        query += " ORDER BY p.tipo, p.nome"
        cur.execute(query, params)
        rows = cur.fetchall()

        result = []
        for r in rows:
            plant = dict(r)
            # Ultima lettura di potenza dalla telemetria
            cur2 = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur2.execute("""
                SELECT power_kw, ts
                FROM telemetry
                WHERE plant_id = %s
                ORDER BY ts DESC
                LIMIT 1
            """, (plant.get("plant_id"),))
            latest = cur2.fetchone()
            plant["current_power_kw"] = latest["power_kw"] if latest else None
            plant["last_reading_at"] = latest["ts"].isoformat() if latest and latest.get("ts") else None
            # Delta rispetto alla baseline
            if latest and plant.get("energy_baseline_kw") and latest.get("power_kw") is not None:
                baseline = plant["energy_baseline_kw"]
                if baseline > 0:
                    delta = ((latest["power_kw"] - baseline) / baseline) * 100
                    plant["baseline_delta_pct"] = round(delta, 1)
                else:
                    plant["baseline_delta_pct"] = None
            else:
                plant["baseline_delta_pct"] = None
            result.append(plant)
        return result

    @app.get("/api/bems/buildings/{asset_id}/telemetry/latest", tags=["bems"])
    def get_telemetry_latest(asset_id: int,
                             _=Depends(get_utente_corrente),
                             db=Depends(get_db)):
        """Ultima lettura di telemetria per ogni zona dell'edificio.
        Restituisce un dict zone_id -> {power_kw, temp_c, humidity, co2_ppm, occupancy_pct, ts}."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        # Ultima telemetria per zona (DISTINCT ON richiede ORDER BY)
        cur.execute("""
            SELECT DISTINCT ON (zone_id)
                zone_id, power_kw, temp_c, humidity, co2_ppm, occupancy, persone_presenti, ts
            FROM telemetry
            WHERE asset_id = %s AND zone_id IS NOT NULL
            ORDER BY zone_id, ts DESC
        """, (asset_id,))
        rows = cur.fetchall()
        # Calcola occupancy_pct_30d per ogni zona (% ore occupate negli ultimi 30 giorni)
        cur.execute("""
            SELECT zone_id,
                   ROUND(AVG(CASE WHEN occupancy THEN 100.0 ELSE 0.0 END)::numeric, 1) AS occ_pct
            FROM telemetry
            WHERE asset_id = %s
              AND zone_id IS NOT NULL
              AND occupancy IS NOT NULL
              AND ts >= NOW() - INTERVAL '30 days'
            GROUP BY zone_id
        """, (asset_id,))
        occ_pct_map = {r2["zone_id"]: float(r2["occ_pct"]) for r2 in cur.fetchall()}
        result = {}
        for r in rows:
            zid = r["zone_id"]
            result[zid] = {
                "power_kw": float(r["power_kw"]) if r["power_kw"] is not None else None,
                "temp_c": float(r["temp_c"]) if r["temp_c"] is not None else None,
                "humidity": float(r["humidity"]) if r["humidity"] is not None else None,
                "co2_ppm": float(r["co2_ppm"]) if r["co2_ppm"] is not None else None,
                "occupancy": r["occupancy"],
                "occupancy_pct": occ_pct_map.get(zid),
                "persone_presenti": int(r["persone_presenti"]) if r["persone_presenti"] is not None else None,
                "ts": r["ts"].isoformat() if r.get("ts") else None
            }
        return result

    @app.get("/api/bems/buildings/{asset_id}/telemetry/history", tags=["bems"])
    def get_telemetry_history(asset_id: int,
                              zone_id: Optional[str] = None,
                              plant_id: Optional[str] = None,
                              ore: int = 24,
                              _=Depends(get_utente_corrente),
                              db=Depends(get_db)):
        """Storico telemetria per zona o impianto nelle ultime N ore."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        query = """
            SELECT ts, zone_id, plant_id, power_kw, temp_c, humidity, co2_ppm, occupancy
            FROM telemetry
            WHERE asset_id = %s
              AND ts >= NOW() - INTERVAL '%s hours'
        """
        params: list = [asset_id, ore]
        if zone_id:
            query += " AND zone_id = %s"
            params.append(zone_id)
        if plant_id:
            query += " AND plant_id = %s"
            params.append(plant_id)
        query += " ORDER BY ts DESC LIMIT 1000"
        cur.execute(query, params)
        rows = cur.fetchall()
        result = []
        for r in rows:
            result.append({
                "ts": r["ts"].isoformat() if r.get("ts") else None,
                "zone_id": r["zone_id"],
                "plant_id": r["plant_id"],
                "power_kw": float(r["power_kw"]) if r["power_kw"] is not None else None,
                "temp_c": float(r["temp_c"]) if r["temp_c"] is not None else None,
                "humidity": float(r["humidity"]) if r["humidity"] is not None else None,
                "co2_ppm": float(r["co2_ppm"]) if r["co2_ppm"] is not None else None,
                "occupancy": r["occupancy"]
            })
        return result

    @app.post("/api/bems/telemetry", tags=["bems"])
    def post_telemetry(payload: Dict[str, Any],
                       db=Depends(get_db)):
        """Endpoint per il simulatore gateway: inserisce una lettura di telemetria.
        Payload: {asset_id, floor_id, zone_id, plant_id, power_kw, temp_c, humidity, co2_ppm, occupancy}
        Non richiede autenticazione (chiamato dal gateway interno)."""
        cur = db.cursor()
        cur.execute("""
            INSERT INTO telemetry (asset_id, floor_id, zone_id, plant_id, power_kw, temp_c, humidity, co2_ppm, occupancy, persone_presenti)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            payload.get("asset_id"),
            payload.get("floor_id"),
            payload.get("zone_id"),
            payload.get("plant_id"),
            payload.get("power_kw"),
            payload.get("temp_c"),
            payload.get("humidity"),
            payload.get("co2_ppm"),
            payload.get("occupancy"),
            payload.get("persone_presenti")
        ))
        db.commit()
        return {"status": "ok"}

    @app.post("/api/bems/telemetry/batch", tags=["bems"])
    def post_telemetry_batch(payload: List[Dict[str, Any]],
                             db=Depends(get_db)):
        """Endpoint batch per il simulatore gateway: inserisce multiple letture.
        Payload: lista di {asset_id, floor_id, zone_id, plant_id, power_kw, temp_c, humidity, co2_ppm, occupancy, ts (opzionale ISO8601)}"""
        cur = db.cursor()
        for item in payload:
            ts_val = item.get("ts")
            if ts_val:
                cur.execute("""
                    INSERT INTO telemetry (ts, asset_id, floor_id, zone_id, plant_id, power_kw, temp_c, humidity, co2_ppm, occupancy, persone_presenti)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    ts_val,
                    item.get("asset_id"),
                    item.get("floor_id"),
                    item.get("zone_id"),
                    item.get("plant_id"),
                    item.get("power_kw"),
                    item.get("temp_c"),
                    item.get("humidity"),
                    item.get("co2_ppm"),
                    item.get("occupancy"),
                    item.get("persone_presenti")
                ))
            else:
                cur.execute("""
                    INSERT INTO telemetry (asset_id, floor_id, zone_id, plant_id, power_kw, temp_c, humidity, co2_ppm, occupancy, persone_presenti)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    item.get("asset_id"),
                    item.get("floor_id"),
                    item.get("zone_id"),
                    item.get("plant_id"),
                    item.get("power_kw"),
                    item.get("temp_c"),
                    item.get("humidity"),
                    item.get("co2_ppm"),
                    item.get("occupancy"),
                    item.get("persone_presenti")
                ))
        db.commit()
        return {"status": "ok", "inserted": len(payload)}


    # ── BEMS Studio: Catalogo sensori ────────────────────────────────────────
    SENSOR_CATALOG = [
        {
            "id": "SENS-IAQ-01",
            "nome": "Sensore Temp/CO₂/Umidità",
            "tipo": "iaq",
            "marca": "Schneider Electric",
            "modello": "SpaceLogic SE8650",
            "misure": ["temp_c", "co2_ppm", "humidity"],
            "frequenza_sec": 60,
            "protocollo": "MQTT + Modbus RTU",
            "qos": 1,
            "topic_pattern": "bems/{asset_id}/{floor_id}/{zone_id}/iaq",
            "payload_schema": {"temp_c": "float", "co2_ppm": "int", "humidity": "float", "ts": "ISO8601"},
            "registri_modbus": [
                {"reg": 40001, "desc": "Temperatura (×10, °C)"},
                {"reg": 40002, "desc": "CO₂ (ppm)"},
                {"reg": 40003, "desc": "Umidità relativa (%)"}
            ],
            "note": "Installare a 1.5m dal pavimento, lontano da finestre e bocchette HVAC"
        },
        {
            "id": "SENS-OCC-01",
            "nome": "Sensore Occupancy PIR",
            "tipo": "occupancy",
            "marca": "Distech Controls",
            "modello": "ECB-PTU-24",
            "misure": ["occupancy"],
            "frequenza_sec": 10,
            "protocollo": "MQTT",
            "qos": 0,
            "topic_pattern": "bems/{asset_id}/{floor_id}/{zone_id}/occupancy",
            "payload_schema": {"occupancy": "bool", "ts": "ISO8601"},
            "registri_modbus": [],
            "note": "Copertura fino a 12m, angolo 90°. Montaggio a soffitto"
        },
        {
            "id": "SENS-PWR-01",
            "nome": "Contatore Energia Zona",
            "tipo": "power_meter",
            "marca": "Carlo Gavazzi",
            "modello": "EM24-DIN",
            "misure": ["power_kw"],
            "frequenza_sec": 30,
            "protocollo": "MQTT + Modbus TCP",
            "qos": 1,
            "topic_pattern": "bems/{asset_id}/{floor_id}/{zone_id}/power",
            "payload_schema": {"power_kw": "float", "energy_kwh": "float", "ts": "ISO8601"},
            "registri_modbus": [
                {"reg": 40001, "desc": "Potenza attiva (W)"},
                {"reg": 40003, "desc": "Energia attiva (Wh)"}
            ],
            "note": "Installare sul quadro elettrico di zona. Richiede CT clamp"
        },
        {
            "id": "SENS-HVAC-01",
            "nome": "Controller HVAC Zona",
            "tipo": "hvac",
            "marca": "Siemens",
            "modello": "RXB21.1/FC-10",
            "misure": ["temp_c", "power_kw"],
            "frequenza_sec": 60,
            "protocollo": "BACnet/IP + MQTT bridge",
            "qos": 1,
            "topic_pattern": "bems/{asset_id}/{floor_id}/{zone_id}/hvac",
            "payload_schema": {"temp_setpoint": "float", "temp_actual": "float", "mode": "string", "power_kw": "float", "ts": "ISO8601"},
            "registri_modbus": [],
            "note": "Richiede gateway BACnet→MQTT (es. Tosibox Node)"
        },
        {
            "id": "SENS-MULTI-01",
            "nome": "Sensore Multifunzione IAQ+Occ",
            "tipo": "multi",
            "marca": "Pressac",
            "modello": "Sense360",
            "misure": ["temp_c", "co2_ppm", "humidity", "occupancy"],
            "frequenza_sec": 30,
            "protocollo": "MQTT (LoRaWAN o Wi-Fi)",
            "qos": 1,
            "topic_pattern": "bems/{asset_id}/{floor_id}/{zone_id}/multi",
            "payload_schema": {"temp_c": "float", "co2_ppm": "int", "humidity": "float", "occupancy": "bool", "ts": "ISO8601"},
            "registri_modbus": [],
            "note": "Soluzione all-in-one. Alimentazione USB-C o PoE"
        },
        {
            "id": "MTR-ELEC-MAIN",
            "nome": "Contatore Principale Elettrico",
            "tipo": "meter",
            "categoria": "meters",
            "marca": "Schneider Electric",
            "modello": "iEM3355",
            "misure": ["power_kw", "energy_kwh", "voltage_v", "current_a", "power_factor"],
            "frequenza_sec": 15,
            "protocollo": "MQTT + Modbus TCP",
            "qos": 1,
            "topic_pattern": "bems/{asset_id}/meters/main-elec",
            "payload_schema": {"power_kw": "float", "energy_kwh": "float", "voltage_v": "float", "current_a": "float", "power_factor": "float", "ts": "ISO8601"},
            "registri_modbus": [
                {"reg": 3000, "desc": "Potenza attiva totale (W)"},
                {"reg": 3004, "desc": "Energia attiva importata (Wh)"},
                {"reg": 3028, "desc": "Tensione media L-N (V)"},
                {"reg": 3010, "desc": "Corrente media (A)"},
                {"reg": 3024, "desc": "Fattore di potenza totale"}
            ],
            "note": "Installare sul quadro generale MT/BT. Richiede CT 5A secondario. Classe 0.5S per misure fiscali"
        },
        {
            "id": "MTR-ELEC-SUB",
            "nome": "Sub-meter Elettrico di Zona",
            "tipo": "meter",
            "categoria": "meters",
            "marca": "Carlo Gavazzi",
            "modello": "EM24-DIN AV5",
            "misure": ["power_kw", "energy_kwh", "power_factor"],
            "frequenza_sec": 30,
            "protocollo": "MQTT + Modbus RTU",
            "qos": 1,
            "topic_pattern": "bems/{asset_id}/meters/sub-elec/{plant_id}",
            "payload_schema": {"power_kw": "float", "energy_kwh": "float", "power_factor": "float", "plant_id": "string", "ts": "ISO8601"},
            "registri_modbus": [
                {"reg": 40001, "desc": "Potenza attiva (W)"},
                {"reg": 40003, "desc": "Energia attiva (Wh)"},
                {"reg": 40005, "desc": "Fattore di potenza"}
            ],
            "note": "Per sotto-misura di impianti (HVAC, illuminazione, UPS). Indirizzo Modbus configurabile via DIP switch"
        },
        {
            "id": "MTR-GAS-01",
            "nome": "Contatore Gas Metano",
            "tipo": "meter",
            "categoria": "meters",
            "marca": "Elster",
            "modello": "BK-G16",
            "misure": ["volume_m3", "flow_m3h"],
            "frequenza_sec": 60,
            "protocollo": "MQTT + M-Bus",
            "qos": 1,
            "topic_pattern": "bems/{asset_id}/meters/gas",
            "payload_schema": {"volume_m3": "float", "flow_m3h": "float", "ts": "ISO8601"},
            "registri_modbus": [],
            "note": "Interfaccia M-Bus. Richiede gateway M-Bus->MQTT (es. Relay WMBUS). Portata max 25 m3/h"
        },
        {
            "id": "MTR-WATER-01",
            "nome": "Contatore Acqua Fredda",
            "tipo": "meter",
            "categoria": "meters",
            "marca": "Sensus",
            "modello": "620C",
            "misure": ["volume_l", "flow_lh"],
            "frequenza_sec": 60,
            "protocollo": "MQTT + M-Bus",
            "qos": 1,
            "topic_pattern": "bems/{asset_id}/meters/water",
            "payload_schema": {"volume_l": "float", "flow_lh": "float", "ts": "ISO8601"},
            "registri_modbus": [],
            "note": "Compatibile DN15-DN50. Lettura remota via M-Bus o NB-IoT"
        },
        {
            "id": "MTR-HEAT-01",
            "nome": "Contatore Energia Termica",
            "tipo": "meter",
            "categoria": "meters",
            "marca": "Kamstrup",
            "modello": "MULTICAL 403",
            "misure": ["energy_kwh_th", "power_kw_th", "temp_supply_c", "temp_return_c", "flow_m3h"],
            "frequenza_sec": 60,
            "protocollo": "MQTT + M-Bus / KMP",
            "qos": 1,
            "topic_pattern": "bems/{asset_id}/meters/heat",
            "payload_schema": {"energy_kwh_th": "float", "power_kw_th": "float", "temp_supply_c": "float", "temp_return_c": "float", "flow_m3h": "float", "ts": "ISO8601"},
            "registri_modbus": [
                {"reg": 60, "desc": "Energia termica (GJ)"},
                {"reg": 68, "desc": "Potenza termica (kW)"},
                {"reg": 86, "desc": "Temperatura mandata (C)"},
                {"reg": 87, "desc": "Temperatura ritorno (C)"}
            ],
            "note": "Per teleriscaldamento e impianti di cogenerazione. Classe 2 EN 1434"
        }
    ]

    @app.get("/api/bems/studio/sensor-catalog", tags=["bems-studio"])
    def get_sensor_catalog(_=Depends(get_utente_corrente)):
        """Catalogo sensori disponibili per BEMS Studio."""
        return SENSOR_CATALOG

    @app.get("/api/bems/buildings/{asset_id}/plants/studio", tags=["bems-studio"])
    def get_plants_studio(asset_id: int,
                          floor_id: Optional[str] = None,
                          zone_id: Optional[str] = None,
                          _=Depends(get_utente_corrente),
                          db=Depends(get_db)):
        """Lista sensori/impianti con configurazione MQTT per BEMS Studio.
        Restituisce mqtt_config e sensori_config se già presenti, altrimenti genera i default."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        query = """
            SELECT p.id, p.asset_id, p.floor_id, p.zone_id, p.plant_id,
                   p.nome, p.tipo, p.marca, p.modello, p.anno_installazione,
                   p.stato, p.energy_baseline_kw,
                   p.mqtt_config, p.sensori_config, p.note_integratore,
                   f.nome AS floor_nome, z.nome AS zone_nome
            FROM plants p
            LEFT JOIN floors f ON f.floor_id = p.floor_id AND f.asset_id = p.asset_id
            LEFT JOIN zones z ON z.zone_id = p.zone_id AND z.asset_id = p.asset_id
            WHERE p.asset_id = %s
        """
        params: list = [asset_id]
        if floor_id:
            query += " AND p.floor_id = %s"
            params.append(floor_id)
        if zone_id:
            query += " AND p.zone_id = %s"
            params.append(zone_id)
        query += " ORDER BY p.floor_id, p.zone_id, p.plant_id"
        cur.execute(query, params)
        rows = cur.fetchall()
        result = []
        for r in rows:
            plant = dict(r)
            floor = plant.get("floor_id") or "XX"
            zone = plant.get("zone_id") or "XX"
            # Genera configurazione MQTT di default se non ancora impostata
            if not plant.get("mqtt_config"):
                plant["mqtt_config_default"] = {
                    "broker_host": "mqtt.keybiz.local",
                    "broker_port": 1883,
                    "username": "bems_gw",
                    "password": "",
                    "qos": 1,
                    "topic_telemetry": f"bems/{asset_id}/{floor}/{zone}/telemetry",
                    "topic_status": f"bems/{asset_id}/{floor}/{zone}/status",
                    "frequenza_sec": 60,
                    "payload_format": "json"
                }
            else:
                plant["mqtt_config_default"] = None
            result.append(plant)
        return result

    @app.patch("/api/bems/buildings/{asset_id}/plants/{plant_id}/mqtt", tags=["bems-studio"])
    def patch_plant_mqtt(asset_id: int,
                         plant_id: str,
                         payload: Dict[str, Any],
                         _=Depends(get_utente_corrente),
                         db=Depends(get_db)):
        """Aggiorna la configurazione MQTT di un sensore/impianto esistente.
        Payload: {mqtt_config: {...}, sensori_config: {...}, note_integratore: '...'}"""
        import json as _json
        cur = db.cursor()
        updates = []
        params = []
        if "mqtt_config" in payload:
            updates.append("mqtt_config = %s")
            params.append(_json.dumps(payload["mqtt_config"]))
        if "sensori_config" in payload:
            updates.append("sensori_config = %s")
            params.append(_json.dumps(payload["sensori_config"]))
        if "note_integratore" in payload:
            updates.append("note_integratore = %s")
            params.append(payload["note_integratore"])
        if not updates:
            raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
        params.extend([asset_id, plant_id])
        cur.execute(
            f"UPDATE plants SET {', '.join(updates)} WHERE asset_id = %s AND plant_id = %s",
            params
        )
        if cur.rowcount == 0:
            db.rollback()
            raise HTTPException(status_code=404, detail="Sensore non trovato")
        db.commit()
        return {"status": "ok", "plant_id": plant_id, "updated": cur.rowcount}

    @app.post("/api/bems/buildings/{asset_id}/plants/studio", tags=["bems-studio"])
    def create_plant_studio(asset_id: int,
                            payload: Dict[str, Any],
                            _=Depends(get_utente_corrente),
                            db=Depends(get_db)):
        """Crea un nuovo sensore/impianto da BEMS Studio (nuova installazione).
        Payload: {plant_id, nome, tipo, marca, modello, floor_id, zone_id, mqtt_config, sensori_config, note_integratore}"""
        import json as _json
        cur = db.cursor()
        cur.execute("""
            INSERT INTO plants
                (asset_id, floor_id, zone_id, plant_id, nome, tipo, marca, modello,
                 stato, mqtt_config, sensori_config, note_integratore)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'operativo', %s, %s, %s)
            ON CONFLICT (asset_id, plant_id) DO UPDATE SET
                mqtt_config = EXCLUDED.mqtt_config,
                sensori_config = EXCLUDED.sensori_config,
                note_integratore = EXCLUDED.note_integratore,
                stato = 'operativo'
            RETURNING id, plant_id
        """, (
            asset_id,
            payload.get("floor_id"),
            payload.get("zone_id"),
            payload.get("plant_id"),
            payload.get("nome"),
            payload.get("tipo", "sensore"),
            payload.get("marca"),
            payload.get("modello"),
            _json.dumps(payload["mqtt_config"]) if payload.get("mqtt_config") else None,
            _json.dumps(payload["sensori_config"]) if payload.get("sensori_config") else None,
            payload.get("note_integratore")
        ))
        row = cur.fetchone()
        db.commit()
        return {"status": "ok", "id": row[0], "plant_id": row[1]}

    # ── BEMS Studio: Sessioni di configurazione ───────────────────────────────
    @app.get("/api/bems/studio/sessions", tags=["bems-studio"])
    def get_studio_sessions(asset_id: Optional[int] = None,
                            _=Depends(get_utente_corrente),
                            db=Depends(get_db)):
        """Lista sessioni BEMS Studio salvate."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if asset_id:
            cur.execute(
                "SELECT * FROM bems_studio_sessions WHERE asset_id=%s ORDER BY updated_at DESC",
                (asset_id,)
            )
        else:
            cur.execute("SELECT * FROM bems_studio_sessions ORDER BY updated_at DESC")
        rows = cur.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            for k in ("created_at", "updated_at"):
                if d.get(k):
                    d[k] = d[k].isoformat()
            result.append(d)
        return result

    @app.post("/api/bems/studio/sessions", tags=["bems-studio"])
    def create_studio_session(payload: Dict[str, Any],
                              _=Depends(get_utente_corrente),
                              db=Depends(get_db)):
        """Crea una nuova sessione BEMS Studio.
        Payload: {asset_id, nome, integratore, stato, config_json}"""
        import json as _json
        cur = db.cursor()
        cur.execute("""
            INSERT INTO bems_studio_sessions (asset_id, nome, integratore, stato, config_json)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
        """, (
            payload["asset_id"],
            payload.get("nome", "Sessione BEMS Studio"),
            payload.get("integratore"),
            payload.get("stato", "bozza"),
            _json.dumps(payload.get("config_json", {}))
        ))
        row = cur.fetchone()
        db.commit()
        return {"status": "ok", "id": row[0]}

    @app.put("/api/bems/studio/sessions/{session_id}", tags=["bems-studio"])
    def update_studio_session(session_id: int,
                              payload: Dict[str, Any],
                              _=Depends(get_utente_corrente),
                              db=Depends(get_db)):
        """Aggiorna una sessione BEMS Studio esistente."""
        import json as _json
        cur = db.cursor()
        cur.execute("""
            UPDATE bems_studio_sessions
            SET nome=%s, integratore=%s, stato=%s, config_json=%s, updated_at=NOW()
            WHERE id=%s
        """, (
            payload.get("nome"),
            payload.get("integratore"),
            payload.get("stato", "bozza"),
            _json.dumps(payload.get("config_json", {})),
            session_id
        ))
        if cur.rowcount == 0:
            db.rollback()
            raise HTTPException(status_code=404, detail="Sessione non trovata")
        db.commit()
        return {"status": "ok", "id": session_id}
