"""
GIS Asset Manager - Modulo Occupancy (PostgreSQL + TimescaleDB)
Versione: 2.0
Autore: Felix / KeyBiz

Gestisce il rilevamento dell'occupancy tramite contapassaggi infrarossi.
Usa psycopg2 con PostgreSQL e TimescaleDB per le tabelle time-series.

Tabelle gestite:
  occupancy_zones    - zone dell'edificio (piano, area, capacità)
  occupancy_gates    - varchi con direzione IN/OUT rispetto a una zona
  occupancy_events   - eventi di passaggio — hypertable TimescaleDB
  occupancy_snapshot - snapshot periodici dell'occupancy — hypertable TimescaleDB
"""

import asyncio
import random
import os
import psycopg2
import psycopg2.extras
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://gamuser:gampassword@localhost:5432/gamdb"
)


def _get_pg_conn():
    return psycopg2.connect(DATABASE_URL)


# ── Schema DB ─────────────────────────────────────────────────────────────────

def migrate_occupancy_schema(db_path: str = None):
    """Applica lo schema occupancy al DB PostgreSQL. Crea hypertable TimescaleDB."""
    conn = _get_pg_conn()
    cur = conn.cursor()
    try:
        cur.execute("""
        CREATE TABLE IF NOT EXISTS occupancy_zones (
            id           SERIAL PRIMARY KEY,
            asset_id     INTEGER NOT NULL REFERENCES assets(id),
            codice       TEXT NOT NULL,
            nome         TEXT NOT NULL,
            piano        TEXT,
            area_m2      DOUBLE PRECISION,
            capacita_max INTEGER NOT NULL DEFAULT 50,
            attiva       INTEGER NOT NULL DEFAULT 1,
            UNIQUE(asset_id, codice)
        );

        CREATE TABLE IF NOT EXISTS occupancy_gates (
            id       SERIAL PRIMARY KEY,
            asset_id INTEGER NOT NULL REFERENCES assets(id),
            zone_id  INTEGER NOT NULL REFERENCES occupancy_zones(id),
            codice   TEXT NOT NULL,
            nome     TEXT NOT NULL,
            tipo     TEXT NOT NULL DEFAULT 'bidirezionale',
            pos_x    DOUBLE PRECISION,
            pos_y    DOUBLE PRECISION,
            attivo   INTEGER NOT NULL DEFAULT 1,
            UNIQUE(asset_id, codice)
        );

        CREATE TABLE IF NOT EXISTS occupancy_events (
            id        SERIAL,
            gate_id   INTEGER NOT NULL REFERENCES occupancy_gates(id),
            asset_id  INTEGER NOT NULL,
            zone_id   INTEGER NOT NULL,
            ts        TIMESTAMPTZ NOT NULL,
            direzione TEXT NOT NULL,
            delta     INTEGER NOT NULL DEFAULT 1,
            UNIQUE(gate_id, ts, direzione)
        );

        CREATE TABLE IF NOT EXISTS occupancy_snapshot (
            id            SERIAL,
            zone_id       INTEGER NOT NULL REFERENCES occupancy_zones(id),
            asset_id      INTEGER NOT NULL,
            ts            TIMESTAMPTZ NOT NULL,
            presenti      INTEGER NOT NULL DEFAULT 0,
            capacita_max  INTEGER NOT NULL,
            pct_occupancy DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            UNIQUE(zone_id, ts)
        );
        """)
        conn.commit()

        # Converti in hypertable TimescaleDB (idempotente)
        for table in ["occupancy_events", "occupancy_snapshot"]:
            try:
                cur.execute(f"""
                    SELECT create_hypertable(
                        '{table}', 'ts',
                        if_not_exists => TRUE,
                        migrate_data => TRUE
                    );
                """)
                conn.commit()
                print(f"[occupancy] hypertable TimescaleDB creata per {table}")
            except Exception as e:
                conn.rollback()
                print(f"[occupancy] TimescaleDB non disponibile per {table}, uso indici standard: {e}")
                cur.execute(f"""
                    CREATE INDEX IF NOT EXISTS idx_{table}_asset_ts
                        ON {table}(asset_id, ts DESC);
                """)
                conn.commit()
    finally:
        cur.close()
        conn.close()


# ── Profili di occupancy simulati ────────────────────────────────────────────

_OCC_WEEKDAY = [
    0.02, 0.01, 0.01, 0.01, 0.01, 0.03,
    0.10, 0.45, 0.75, 0.88, 0.92, 0.85,
    0.60, 0.80, 0.88, 0.85, 0.75, 0.50,
    0.25, 0.12, 0.06, 0.04, 0.03, 0.02,
]

_OCC_WEEKEND = [
    0.01, 0.01, 0.01, 0.01, 0.01, 0.01,
    0.02, 0.04, 0.06, 0.08, 0.10, 0.08,
    0.06, 0.05, 0.05, 0.04, 0.03, 0.03,
    0.02, 0.02, 0.01, 0.01, 0.01, 0.01,
]


def _occ_factor(ts: datetime) -> float:
    is_weekend = ts.weekday() >= 5
    profile = _OCC_WEEKEND if is_weekend else _OCC_WEEKDAY
    base = profile[ts.hour]
    return max(0.0, min(1.0, base + random.gauss(0, 0.03)))


def _occ_stato(pct: float) -> str:
    if pct >= 90:
        return "critico"
    elif pct >= 70:
        return "alto"
    elif pct >= 30:
        return "normale"
    else:
        return "basso"


# ── Configurazione demo ───────────────────────────────────────────────────────

_DEMO_CONFIG = {
    1: {
        "zones": [
            {"codice": "Z-PT",  "nome": "Piano Terra",                "piano": "Piano Terra", "area_m2": 450, "capacita_max": 80},
            {"codice": "Z-P1",  "nome": "Piano 1 - Open Space",       "piano": "Piano 1",     "area_m2": 380, "capacita_max": 65},
            {"codice": "Z-P2",  "nome": "Piano 2 - Uffici Direzionali","piano": "Piano 2",    "area_m2": 320, "capacita_max": 40},
        ],
        "gates": [
            {"zone_codice": "Z-PT", "codice": "G-ING-MAIN",  "nome": "Ingresso Principale",  "tipo": "bidirezionale", "pos_x": 0.5,  "pos_y": 0.95},
            {"zone_codice": "Z-PT", "codice": "G-ING-SEC",   "nome": "Ingresso Secondario",  "tipo": "bidirezionale", "pos_x": 0.15, "pos_y": 0.5},
            {"zone_codice": "Z-P1", "codice": "G-SCALA-P1",  "nome": "Scala/Ascensore P1",   "tipo": "bidirezionale", "pos_x": 0.5,  "pos_y": 0.5},
            {"zone_codice": "Z-P2", "codice": "G-SCALA-P2",  "nome": "Scala/Ascensore P2",   "tipo": "bidirezionale", "pos_x": 0.5,  "pos_y": 0.5},
        ],
    },
    2: {
        "zones": [
            {"codice": "Z-PROD-A", "nome": "Area Produzione A", "piano": "Piano Terra", "area_m2": 1200, "capacita_max": 120},
            {"codice": "Z-PROD-B", "nome": "Area Produzione B", "piano": "Piano Terra", "area_m2": 800,  "capacita_max": 80},
            {"codice": "Z-UFF",    "nome": "Uffici",            "piano": "Piano 1",     "area_m2": 300,  "capacita_max": 35},
        ],
        "gates": [
            {"zone_codice": "Z-PROD-A", "codice": "G-ACCESSO-A",  "nome": "Accesso Area A",  "tipo": "bidirezionale", "pos_x": 0.2, "pos_y": 0.9},
            {"zone_codice": "Z-PROD-B", "codice": "G-ACCESSO-B",  "nome": "Accesso Area B",  "tipo": "bidirezionale", "pos_x": 0.8, "pos_y": 0.9},
            {"zone_codice": "Z-UFF",    "codice": "G-UFF-SCALA",  "nome": "Scala Uffici",    "tipo": "bidirezionale", "pos_x": 0.5, "pos_y": 0.5},
        ],
    },
    6: {
        "zones": [
            {"codice": "Z-PT",     "nome": "Piano Terra - Reception",  "piano": "Piano Terra", "area_m2": 350, "capacita_max": 60},
            {"codice": "Z-P1-OPEN","nome": "Piano 1 - Open Space",     "piano": "Piano 1",     "area_m2": 420, "capacita_max": 75},
            {"codice": "Z-P1-SALE","nome": "Piano 1 - Sale Riunioni",  "piano": "Piano 1",     "area_m2": 180, "capacita_max": 30},
            {"codice": "Z-P2",     "nome": "Piano 2 - Direzione",      "piano": "Piano 2",     "area_m2": 280, "capacita_max": 25},
        ],
        "gates": [
            {"zone_codice": "Z-PT",      "codice": "G-ING-MAIN",  "nome": "Ingresso Principale",    "tipo": "bidirezionale", "pos_x": 0.5,  "pos_y": 0.98},
            {"zone_codice": "Z-P1-OPEN", "codice": "G-SCALA-P1",  "nome": "Scala/Ascensore P1",     "tipo": "bidirezionale", "pos_x": 0.45, "pos_y": 0.5},
            {"zone_codice": "Z-P1-SALE", "codice": "G-SALE-ACC",  "nome": "Accesso Sale Riunioni",  "tipo": "bidirezionale", "pos_x": 0.8,  "pos_y": 0.3},
            {"zone_codice": "Z-P2",      "codice": "G-SCALA-P2",  "nome": "Scala/Ascensore P2",     "tipo": "bidirezionale", "pos_x": 0.45, "pos_y": 0.5},
        ],
    },
    7: {
        "zones": [
            {"codice": "Z-MAG-A", "nome": "Magazzino Area A",  "piano": "Piano Terra", "area_m2": 2000, "capacita_max": 30},
            {"codice": "Z-MAG-B", "nome": "Magazzino Area B",  "piano": "Piano Terra", "area_m2": 1500, "capacita_max": 25},
            {"codice": "Z-UFF",   "nome": "Uffici Operativi",  "piano": "Piano 1",     "area_m2": 200,  "capacita_max": 20},
        ],
        "gates": [
            {"zone_codice": "Z-MAG-A", "codice": "G-DOCK-A",  "nome": "Baia Carico A",  "tipo": "bidirezionale", "pos_x": 0.2, "pos_y": 0.95},
            {"zone_codice": "Z-MAG-B", "codice": "G-DOCK-B",  "nome": "Baia Carico B",  "tipo": "bidirezionale", "pos_x": 0.8, "pos_y": 0.95},
            {"zone_codice": "Z-UFF",   "codice": "G-UFF-ACC", "nome": "Accesso Uffici", "tipo": "bidirezionale", "pos_x": 0.5, "pos_y": 0.1},
        ],
    },
}


def seed_occupancy_config(db_path: str = None):
    """Popola zone e varchi demo per gli asset BIM (skip se già presenti)."""
    conn = _get_pg_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    for asset_id, config in _DEMO_CONFIG.items():
        cur.execute("SELECT 1 FROM assets WHERE id=%s", (asset_id,))
        if not cur.fetchone():
            continue

        for z in config["zones"]:
            cur.execute("""
                INSERT INTO occupancy_zones (asset_id, codice, nome, piano, area_m2, capacita_max)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (asset_id, codice) DO NOTHING
            """, (asset_id, z["codice"], z["nome"], z.get("piano"),
                  z.get("area_m2"), z["capacita_max"]))

        for g in config["gates"]:
            cur.execute(
                "SELECT id FROM occupancy_zones WHERE asset_id=%s AND codice=%s",
                (asset_id, g["zone_codice"])
            )
            zone = cur.fetchone()
            if zone:
                cur.execute("""
                    INSERT INTO occupancy_gates
                        (asset_id, zone_id, codice, nome, tipo, pos_x, pos_y)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (asset_id, codice) DO NOTHING
                """, (asset_id, zone["id"], g["codice"], g["nome"],
                      g.get("tipo", "bidirezionale"),
                      g.get("pos_x"), g.get("pos_y")))

    conn.commit()
    cur.close()
    conn.close()


def seed_occupancy_history(db_path: str = None, giorni: int = 30):
    """Genera snapshot storici di occupancy ogni 15 minuti. Skip se già presenti."""
    conn = _get_pg_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute("SELECT COUNT(*) AS cnt FROM occupancy_snapshot")
    if cur.fetchone()["cnt"] > 0:
        cur.close()
        conn.close()
        return

    cur.execute("""
        SELECT id, asset_id, capacita_max
        FROM occupancy_zones WHERE attiva = 1
    """)
    zones = cur.fetchall()

    now = datetime.now(timezone.utc)
    start = now - timedelta(days=giorni)
    step = timedelta(minutes=15)

    batch = []
    ts = start
    while ts <= now:
        for z in zones:
            factor = _occ_factor(ts)
            presenti = int(z["capacita_max"] * factor)
            pct = round((presenti / z["capacita_max"]) * 100, 1) if z["capacita_max"] > 0 else 0
            batch.append((z["id"], z["asset_id"], ts, presenti, z["capacita_max"], pct))
        ts += step
        if len(batch) >= 5000:
            psycopg2.extras.execute_values(cur, """
                INSERT INTO occupancy_snapshot
                    (zone_id, asset_id, ts, presenti, capacita_max, pct_occupancy)
                VALUES %s
                ON CONFLICT (zone_id, ts) DO NOTHING
            """, batch)
            conn.commit()
            batch = []

    if batch:
        psycopg2.extras.execute_values(cur, """
            INSERT INTO occupancy_snapshot
                (zone_id, asset_id, ts, presenti, capacita_max, pct_occupancy)
            VALUES %s
            ON CONFLICT (zone_id, ts) DO NOTHING
        """, batch)
        conn.commit()

    cur.close()
    conn.close()
    print(f"[occupancy] storico {giorni}gg generato per {len(zones)} zone")


# ── Simulatore asincrono ──────────────────────────────────────────────────────

async def run_occupancy_simulator(db_path: str = None, intervallo_sec: int = 60):
    """Task asincrono che genera snapshot di occupancy ogni intervallo_sec secondi."""
    while True:
        try:
            conn = _get_pg_conn()
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            now = datetime.now(timezone.utc)

            cur.execute("""
                SELECT id, asset_id, capacita_max
                FROM occupancy_zones WHERE attiva = 1
            """)
            zones = cur.fetchall()

            for z in zones:
                factor = _occ_factor(now)
                presenti = int(z["capacita_max"] * factor)
                pct = round((presenti / z["capacita_max"]) * 100, 1) if z["capacita_max"] > 0 else 0
                cur.execute("""
                    INSERT INTO occupancy_snapshot
                        (zone_id, asset_id, ts, presenti, capacita_max, pct_occupancy)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (zone_id, ts) DO UPDATE SET
                        presenti = EXCLUDED.presenti,
                        pct_occupancy = EXCLUDED.pct_occupancy
                """, (z["id"], z["asset_id"], now, presenti, z["capacita_max"], pct))

            conn.commit()
            cur.close()
            conn.close()
        except Exception as exc:
            print(f"[occupancy-simulator] errore: {exc}")

        await asyncio.sleep(intervallo_sec)


# ── Router FastAPI ────────────────────────────────────────────────────────────

def register_occupancy_routes(app, get_db, get_utente_corrente):
    """Registra gli endpoint occupancy sull'app FastAPI."""

    @app.get("/api/occupancy/zones/{asset_id}", tags=["occupancy"])
    def get_zones(asset_id: int,
                  _=Depends(get_utente_corrente),
                  db=Depends(get_db)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT * FROM occupancy_zones
            WHERE asset_id = %s AND attiva = 1
            ORDER BY piano, nome
        """, (asset_id,))
        zones = cur.fetchall()
        if not zones:
            raise HTTPException(status_code=404, detail="Nessuna zona configurata per questo asset")
        return [dict(z) for z in zones]

    @app.get("/api/occupancy/gates/{asset_id}", tags=["occupancy"])
    def get_gates(asset_id: int,
                  _=Depends(get_utente_corrente),
                  db=Depends(get_db)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT g.*, oz.nome AS zona_nome, oz.codice AS zona_codice
            FROM occupancy_gates g
            JOIN occupancy_zones oz ON oz.id = g.zone_id
            WHERE g.asset_id = %s AND g.attivo = 1
            ORDER BY oz.piano, g.nome
        """, (asset_id,))
        return [dict(g) for g in cur.fetchall()]

    @app.get("/api/occupancy/current/{asset_id}", tags=["occupancy"])
    def get_current_occupancy(asset_id: int,
                               _=Depends(get_utente_corrente),
                               db=Depends(get_db)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT id, codice, nome, piano, area_m2, capacita_max
            FROM occupancy_zones
            WHERE asset_id = %s AND attiva = 1
        """, (asset_id,))
        zones = cur.fetchall()
        if not zones:
            raise HTTPException(status_code=404, detail="Nessuna zona configurata")

        result = []
        totale_presenti = 0
        totale_capacita = 0

        for z in zones:
            cur.execute("""
                SELECT presenti, pct_occupancy, ts
                FROM occupancy_snapshot
                WHERE zone_id = %s
                ORDER BY ts DESC LIMIT 1
            """, (z["id"],))
            snapshot = cur.fetchone()

            presenti = snapshot["presenti"] if snapshot else 0
            pct = snapshot["pct_occupancy"] if snapshot else 0.0
            ts_val = snapshot["ts"].isoformat() if snapshot and snapshot["ts"] else None

            totale_presenti += presenti
            totale_capacita += z["capacita_max"]

            result.append({
                "zone_id": z["id"],
                "codice": z["codice"],
                "nome": z["nome"],
                "piano": z["piano"],
                "area_m2": z["area_m2"],
                "capacita_max": z["capacita_max"],
                "presenti": presenti,
                "pct_occupancy": pct,
                "aggiornato_il": ts_val,
                "stato": _occ_stato(pct),
            })

        pct_totale = round((totale_presenti / totale_capacita) * 100, 1) if totale_capacita > 0 else 0
        return {
            "asset_id": asset_id,
            "totale_presenti": totale_presenti,
            "totale_capacita": totale_capacita,
            "pct_occupancy_totale": pct_totale,
            "stato_totale": _occ_stato(pct_totale),
            "zone": result,
        }

    @app.get("/api/occupancy/history/{asset_id}", tags=["occupancy"])
    def get_occupancy_history(asset_id: int,
                               ore: int = 24,
                               zone_id: Optional[int] = None,
                               _=Depends(get_utente_corrente),
                               db=Depends(get_db)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(hours=ore)

        if zone_id:
            cur.execute("""
                SELECT s.ts, s.presenti, s.pct_occupancy, s.zone_id,
                       oz.nome AS zona_nome, oz.piano
                FROM occupancy_snapshot s
                JOIN occupancy_zones oz ON oz.id = s.zone_id
                WHERE s.asset_id = %s AND s.zone_id = %s
                  AND s.ts >= %s AND s.ts <= %s
                ORDER BY s.ts ASC
            """, (asset_id, zone_id, ts_from, now))
        else:
            cur.execute("""
                SELECT s.ts,
                       SUM(s.presenti) AS presenti,
                       ROUND(AVG(s.pct_occupancy)::numeric, 1) AS pct_occupancy,
                       NULL::integer AS zone_id,
                       'Totale edificio' AS zona_nome,
                       NULL::text AS piano
                FROM occupancy_snapshot s
                WHERE s.asset_id = %s
                  AND s.ts >= %s AND s.ts <= %s
                GROUP BY s.ts
                ORDER BY s.ts ASC
            """, (asset_id, ts_from, now))

        rows = cur.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            if isinstance(d.get("ts"), datetime):
                d["ts"] = d["ts"].isoformat()
            result.append(d)
        return result

    @app.get("/api/occupancy/summary", tags=["occupancy"])
    def get_occupancy_summary(_=Depends(get_utente_corrente), db=Depends(get_db)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT DISTINCT oz.asset_id, a.nome, a.tipo, a.lat, a.lon
            FROM occupancy_zones oz
            JOIN assets a ON a.id = oz.asset_id
            WHERE oz.attiva = 1 AND a.stato = 'attivo'
        """)
        assets_with_zones = cur.fetchall()

        result = []
        for a in assets_with_zones:
            cur.execute("""
                SELECT SUM(s.presenti) AS presenti,
                       SUM(oz.capacita_max) AS capacita_max
                FROM occupancy_snapshot s
                JOIN occupancy_zones oz ON oz.id = s.zone_id
                WHERE s.asset_id = %s
                  AND s.ts = (
                      SELECT MAX(ts) FROM occupancy_snapshot WHERE asset_id = %s
                  )
            """, (a["asset_id"], a["asset_id"]))
            latest = cur.fetchone()

            presenti = latest["presenti"] or 0 if latest else 0
            capacita = latest["capacita_max"] or 1 if latest else 1
            pct = round((presenti / capacita) * 100, 1)

            result.append({
                "asset_id": a["asset_id"],
                "nome": a["nome"],
                "tipo": a["tipo"],
                "lat": a["lat"],
                "lon": a["lon"],
                "presenti": presenti,
                "capacita_max": capacita,
                "pct_occupancy": pct,
                "stato": _occ_stato(pct),
            })

        return result

    @app.get("/api/occupancy/correlation/{asset_id}", tags=["occupancy"])
    def get_correlation(asset_id: int,
                        ore: int = 48,
                        _=Depends(get_utente_corrente),
                        db=Depends(get_db)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(hours=ore)

        cur.execute("""
            SELECT ts, ROUND(AVG(pct_occupancy)::numeric, 1) AS pct_occ
            FROM occupancy_snapshot
            WHERE asset_id = %s AND ts >= %s AND ts <= %s
            GROUP BY ts
            ORDER BY ts ASC
        """, (asset_id, ts_from, now))
        occ_rows = cur.fetchall()

        cur.execute("""
            SELECT r.ts, SUM(r.valore) AS kwh
            FROM energy_readings r
            JOIN energy_meters m ON m.id = r.meter_id
            WHERE r.asset_id = %s AND m.tipo = 'elettrico'
              AND r.ts >= %s AND r.ts <= %s
            GROUP BY r.ts
            ORDER BY r.ts ASC
        """, (asset_id, ts_from, now))
        energy_rows = cur.fetchall()

        energy_map = {r["ts"]: r["kwh"] for r in energy_rows}
        result = []
        for occ in occ_rows:
            kwh = energy_map.get(occ["ts"])
            if kwh is not None:
                ts_val = occ["ts"].isoformat() if isinstance(occ["ts"], datetime) else occ["ts"]
                result.append({
                                        "ts": ts_val,
                    "pct_occupancy": float(occ["pct_occ"]),
                    "kwh_elettrico": round(float(kwh), 4),
                })
        return result

    # ── KPI Occupancy — Modulo BEMS ───────────────────────────────────────────

    # ── KPI Occupancy Portafoglio — registrati PRIMA di /{asset_id}/* per evitare conflitti ──

    @app.get("/api/occupancy/portfolio/summary", tags=["occupancy-kpi"])
    def get_occupancy_portfolio_summary_v2(giorni: int = 30,
                                            _=Depends(get_utente_corrente),
                                            db=Depends(get_db)):
        """P-O1: Tasso Utilizzo Medio Portafoglio (frontend-friendly)."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(days=giorni)
        ts_prev = now - timedelta(days=giorni * 2)
        cur.execute("""
            SELECT t.asset_id, a.nome, a.tipo, a.superficie_mq,
                   ROUND(AVG(CASE WHEN t.occupancy THEN 100.0 ELSE 0.0 END)::numeric, 1) AS avg_pct,
                   COUNT(DISTINCT t.zone_id) AS zone_count
            FROM telemetry t
            JOIN assets a ON a.id = t.asset_id
            WHERE t.zone_id IS NOT NULL AND t.ts >= %s AND t.ts < %s
            GROUP BY t.asset_id, a.nome, a.tipo, a.superficie_mq
            ORDER BY avg_pct DESC
        """, (ts_from, now))
        rows = cur.fetchall()
        if not rows:
            return {"avg_pct_portfolio": None, "n_asset_con_sensori": 0, "delta_pct": None, "asset": []}
        assets_list = [{"asset_id": r["asset_id"], "nome": r["nome"], "tipo": r["tipo"],
                        "superficie_mq": float(r["superficie_mq"] or 0),
                        "avg_pct": float(r["avg_pct"] or 0), "zone_count": int(r["zone_count"])} for r in rows]
        avg_cur = round(sum(a["avg_pct"] for a in assets_list) / len(assets_list), 1)
        cur.execute("""
            SELECT ROUND(AVG(CASE WHEN occupancy THEN 100.0 ELSE 0.0 END)::numeric, 1) AS avg_pct
            FROM telemetry WHERE zone_id IS NOT NULL AND ts >= %s AND ts < %s
        """, (ts_prev, ts_from))
        prev_row = cur.fetchone()
        avg_prev = float(prev_row["avg_pct"]) if prev_row and prev_row["avg_pct"] else None
        delta = round(avg_cur - avg_prev, 1) if avg_prev is not None else None
        return {"avg_pct_portfolio": avg_cur, "n_asset_con_sensori": len(assets_list),
                "delta_pct": delta, "giorni": giorni, "asset": assets_list}

    @app.get("/api/occupancy/portfolio/weekly_pattern_v2", tags=["occupancy-kpi"])
    def get_occupancy_portfolio_weekly_v2(giorni: int = 90,
                                           _=Depends(get_utente_corrente),
                                           db=Depends(get_db)):
        """P-O2: Pattern Settimanale Portafoglio con campo lavorativo."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(days=giorni)
        cur.execute("""
            SELECT EXTRACT(isodow FROM ts AT TIME ZONE 'Europe/Rome')::int AS dow,
                   ROUND(AVG(CASE WHEN occupancy THEN 100.0 ELSE 0.0 END)::numeric, 1) AS avg_pct,
                   COUNT(DISTINCT asset_id) AS n_asset
            FROM telemetry WHERE zone_id IS NOT NULL AND ts >= %s AND ts < %s GROUP BY dow ORDER BY dow
        """, (ts_from, now))
        rows = cur.fetchall()
        dow_labels = {1:"Lun",2:"Mar",3:"Mer",4:"Gio",5:"Ven",6:"Sab",7:"Dom"}
        dow_map = {r["dow"]: r for r in rows}
        result = []
        for dow in range(1, 8):
            r = dow_map.get(dow)
            result.append({"dow": dow, "label": dow_labels[dow],
                           "avg_pct": float(r["avg_pct"]) if r else None,
                           "n_asset": int(r["n_asset"]) if r else 0,
                           "lavorativo": dow <= 5, "weekend": dow >= 6})
        return {"giorni": giorni, "dati_parziali": giorni < 84, "data": result}

    @app.get("/api/occupancy/portfolio/scatter_eui", tags=["occupancy-kpi"])
    def get_occupancy_portfolio_scatter_eui(giorni: int = 365,
                                             _=Depends(get_utente_corrente),
                                             db=Depends(get_db)):
        """P-O5: Scatter Occupancy vs EUI (frontend-friendly)."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from_occ = now - timedelta(days=30)
        ts_from_energy = now - timedelta(days=giorni)
        cur.execute("""
            SELECT asset_id, ROUND(AVG(CASE WHEN occupancy THEN 100.0 ELSE 0.0 END)::numeric, 1) AS avg_pct
            FROM telemetry WHERE zone_id IS NOT NULL AND ts >= %s AND ts < %s GROUP BY asset_id
        """, (ts_from_occ, now))
        occ_map = {r["asset_id"]: float(r["avg_pct"]) for r in cur.fetchall()}
        if not occ_map:
            return {"data": []}
        cur.execute("""
            SELECT r.asset_id, SUM(r.valore) AS kwh_totale,
                   a.superficie_mq, a.nome, a.tipo, a.building_category, a.energy_class
            FROM energy_readings r
            JOIN energy_meters m ON m.id = r.meter_id
            JOIN assets a ON a.id = r.asset_id
            WHERE r.asset_id = ANY(%s) AND m.tipo = 'elettrico'
              AND r.ts >= %s AND r.ts < %s
            GROUP BY r.asset_id, a.superficie_mq, a.nome, a.tipo, a.building_category, a.energy_class
        """, (list(occ_map.keys()), ts_from_energy, now))
        result = []
        for r in cur.fetchall():
            aid = r["asset_id"]
            if aid not in occ_map: continue
            sup = float(r["superficie_mq"] or 1)
            kwh = float(r["kwh_totale"] or 0)
            days_ratio = giorni / 365.0
            eui = round(kwh / sup / days_ratio, 1) if sup > 0 and days_ratio > 0 else None
            result.append({"asset_id": aid, "nome": r["nome"], "tipo": r["tipo"],
                           "superficie_mq": sup, "avg_pct": occ_map[aid], "eui": eui})
        return {"data": result}

    @app.get("/api/occupancy/{asset_id}/summary", tags=["occupancy-kpi"])
    def get_occupancy_kpi_summary(asset_id: int,
                                   giorni: int = 30,
                                   _=Depends(get_utente_corrente),
                                   db=Depends(get_db)):
        """O-1: Tasso Occupazione Medio — media pct_occupancy nelle ore lavorative."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(days=giorni)
        ts_prev = ts_from - timedelta(days=giorni)

        cur.execute("""
            SELECT working_hours_start, working_hours_end, working_days
            FROM assets WHERE id = %s
        """, (asset_id,))
        asset = cur.fetchone()
        if not asset:
            raise HTTPException(status_code=404, detail="Asset non trovato")

        wh_start = int(str(asset["working_hours_start"] or "08:00:00")[:2])
        wh_end   = int(str(asset["working_hours_end"]   or "19:00:00")[:2])
        wd_str   = asset["working_days"] or "MON,TUE,WED,THU,FRI"
        wd_map   = {"MON":1,"TUE":2,"WED":3,"THU":4,"FRI":5,"SAT":6,"SUN":7}
        wd_list  = [wd_map[d.strip()] for d in wd_str.split(",") if d.strip() in wd_map]

        def _avg_occ(ts_a, ts_b):
            cur.execute("""
                SELECT ROUND(AVG(CASE WHEN occupancy THEN 100.0 ELSE 0.0 END)::numeric, 1) AS avg_pct,
                       COUNT(DISTINCT zone_id) AS zone_count
                FROM telemetry
                WHERE asset_id = %s AND zone_id IS NOT NULL
                  AND ts >= %s AND ts < %s
                  AND EXTRACT(hour FROM ts AT TIME ZONE 'Europe/Rome') >= %s
                  AND EXTRACT(hour FROM ts AT TIME ZONE 'Europe/Rome') < %s
                  AND EXTRACT(isodow FROM ts AT TIME ZONE 'Europe/Rome') = ANY(%s)
            """, (asset_id, ts_a, ts_b, wh_start, wh_end, wd_list))
            r = cur.fetchone()
            return float(r["avg_pct"] or 0), int(r["zone_count"] or 0)

        avg_curr, zone_count = _avg_occ(ts_from, now)
        avg_prev, _          = _avg_occ(ts_prev, ts_from)

        delta_pct = None
        if avg_prev > 0:
            delta_pct = round(((avg_curr - avg_prev) / avg_prev) * 100, 1)

        cur.execute("""
            SELECT COUNT(DISTINCT ts) AS n_snap
            FROM telemetry
            WHERE asset_id = %s AND zone_id IS NOT NULL AND ts >= %s AND ts < %s
              AND EXTRACT(hour FROM ts AT TIME ZONE 'Europe/Rome') >= %s
              AND EXTRACT(hour FROM ts AT TIME ZONE 'Europe/Rome') < %s
              AND EXTRACT(isodow FROM ts AT TIME ZONE 'Europe/Rome') = ANY(%s)
        """, (asset_id, ts_from, now, wh_start, wh_end, wd_list))
        n_snap = cur.fetchone()["n_snap"] or 0

        return {
            "asset_id": asset_id,
            "giorni": giorni,
            "avg_pct_occupancy": avg_curr,
            "avg_pct_prev": avg_prev,
            "delta_pct": delta_pct,
            "zone_count": zone_count,
            "n_snapshot_lavorativi": n_snap,
            "working_hours": f"{wh_start:02d}:00\u2013{wh_end:02d}:00",
            "working_days": wd_str,
        }

    @app.get("/api/occupancy/{asset_id}/heatmap", tags=["occupancy-kpi"])
    def get_occupancy_heatmap(asset_id: int,
                               giorni: int = 30,
                               _=Depends(get_utente_corrente),
                               db=Depends(get_db)):
        """O-5: Heatmap Occupancy zona x ora — matrice zona_nome x ora del giorno."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(days=giorni)

        cur.execute("""
            SELECT COALESCE(z.nome, t.zone_id) AS zona_nome,
                   t.zone_id,
                   EXTRACT(hour FROM t.ts AT TIME ZONE 'Europe/Rome')::int AS ora,
                   ROUND(AVG(CASE WHEN t.occupancy THEN 100.0 ELSE 0.0 END)::numeric, 1) AS avg_pct
            FROM telemetry t
            LEFT JOIN zones z ON z.zone_id = t.zone_id AND z.asset_id = t.asset_id
            WHERE t.asset_id = %s AND t.zone_id IS NOT NULL
              AND t.ts >= %s AND t.ts < %s
            GROUP BY zona_nome, t.zone_id, ora
            ORDER BY t.zone_id, ora
        """, (asset_id, ts_from, now))
        rows = cur.fetchall()

        if not rows:
            raise HTTPException(status_code=404, detail="Nessun dato occupancy disponibile")

        zones_set = list(dict.fromkeys(r["zona_nome"] for r in rows))  # preserva ordine
        matrix = {z: [None]*24 for z in zones_set}
        for r in rows:
            matrix[r["zona_nome"]][r["ora"]] = float(r["avg_pct"])

        return {
            "asset_id": asset_id,
            "giorni": giorni,
            "zones": zones_set,
            "zone_ids": list(dict.fromkeys(r["zone_id"] for r in rows)),
            "hours": list(range(24)),
            "matrix": [matrix[z] for z in zones_set],
        }

    @app.get("/api/occupancy/{asset_id}/daily_profile", tags=["occupancy-kpi"])
    def get_occupancy_daily_profile(asset_id: int,
                                     giorni: int = 30,
                                     _=Depends(get_utente_corrente),
                                     db=Depends(get_db)):
        """O-7: Profilo Giornaliero 24h — media pct_occupancy per ora del giorno."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(days=giorni)

        cur.execute("""
            SELECT EXTRACT(hour FROM ts AT TIME ZONE 'Europe/Rome')::int AS ora,
                   ROUND(AVG(CASE WHEN occupancy THEN 100.0 ELSE 0.0 END)::numeric, 1) AS avg_pct,
                   ROUND(MAX(CASE WHEN occupancy THEN 100.0 ELSE 0.0 END)::numeric, 1) AS max_pct,
                   ROUND(MIN(CASE WHEN occupancy THEN 100.0 ELSE 0.0 END)::numeric, 1) AS min_pct
            FROM telemetry
            WHERE asset_id = %s AND zone_id IS NOT NULL AND ts >= %s AND ts < %s
            GROUP BY ora
            ORDER BY ora
        """, (asset_id, ts_from, now))
        rows = cur.fetchall()

        if not rows:
            raise HTTPException(status_code=404, detail="Nessun dato occupancy disponibile")

        cur.execute("""
            SELECT working_hours_start, working_hours_end FROM assets WHERE id = %s
        """, (asset_id,))
        asset = cur.fetchone()
        wh_start = int(str(asset["working_hours_start"] or "08:00:00")[:2]) if asset else 8
        wh_end   = int(str(asset["working_hours_end"]   or "19:00:00")[:2]) if asset else 19

        ora_map = {r["ora"]: r for r in rows}
        result = []
        for h in range(24):
            r = ora_map.get(h)
            result.append({
                "ora": h,
                "avg_pct": float(r["avg_pct"]) if r else None,
                "max_pct": float(r["max_pct"]) if r else None,
                "min_pct": float(r["min_pct"]) if r else None,
                "lavorativo": wh_start <= h < wh_end,
            })

        return {
            "asset_id": asset_id,
            "giorni": giorni,
            "data": result,
            "working_hours_start": wh_start,
            "working_hours_end": wh_end,
        }

    @app.get("/api/occupancy/{asset_id}/weekly_pattern", tags=["occupancy-kpi"])
    def get_occupancy_weekly_pattern(asset_id: int,
                                      giorni: int = 90,
                                      _=Depends(get_utente_corrente),
                                      db=Depends(get_db)):
        """O-6: Pattern Settimanale — media pct_occupancy per giorno della settimana."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(days=giorni)

        cur.execute("""
            SELECT EXTRACT(isodow FROM ts AT TIME ZONE 'Europe/Rome')::int AS dow,
                   ROUND(AVG(CASE WHEN occupancy THEN 100.0 ELSE 0.0 END)::numeric, 1) AS avg_pct,
                   COUNT(DISTINCT DATE(ts AT TIME ZONE 'Europe/Rome')) AS n_giorni
            FROM telemetry
            WHERE asset_id = %s AND zone_id IS NOT NULL AND ts >= %s AND ts < %s
            GROUP BY dow
            ORDER BY dow
        """, (asset_id, ts_from, now))
        rows = cur.fetchall()

        cur.execute("SELECT working_days FROM assets WHERE id = %s", (asset_id,))
        asset = cur.fetchone()
        wd_str = asset["working_days"] if asset else "MON,TUE,WED,THU,FRI"
        wd_map = {"MON":1,"TUE":2,"WED":3,"THU":4,"FRI":5,"SAT":6,"SUN":7}
        wd_list = [wd_map[d.strip()] for d in wd_str.split(",") if d.strip() in wd_map]

        dow_labels = {1:"Lun",2:"Mar",3:"Mer",4:"Gio",5:"Ven",6:"Sab",7:"Dom"}
        dow_map = {r["dow"]: r for r in rows}
        result = []
        for dow in range(1, 8):
            r = dow_map.get(dow)
            result.append({
                "dow": dow,
                "label": dow_labels[dow],
                "avg_pct": float(r["avg_pct"]) if r else None,
                "n_giorni": int(r["n_giorni"]) if r else 0,
                "lavorativo": dow in wd_list,
            })

        return {
            "asset_id": asset_id,
            "giorni": giorni,
            "settimane_stimate": round(giorni / 7),
            "dati_parziali": giorni < 84,
            "data": result,
        }

    @app.get("/api/occupancy/{asset_id}/ovi", tags=["occupancy-kpi"])
    def get_occupancy_ovi(asset_id: int,
                           mesi: int = 6,
                           _=Depends(get_utente_corrente),
                           db=Depends(get_db)):
        """O-11: OVI Trend — Occupancy Variability Index mensile (coefficiente di variazione)."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(days=mesi * 30)

        cur.execute("""
            SELECT DATE_TRUNC('month', ts AT TIME ZONE 'Europe/Rome') AS mese,
                   ROUND(AVG(CASE WHEN occupancy THEN 100.0 ELSE 0.0 END)::numeric, 2) AS avg_pct,
                   ROUND(STDDEV(CASE WHEN occupancy THEN 100.0 ELSE 0.0 END)::numeric, 2) AS stddev_pct,
                   COUNT(*) AS n
            FROM telemetry
            WHERE asset_id = %s AND zone_id IS NOT NULL AND ts >= %s AND ts < %s
            GROUP BY mese
            ORDER BY mese
        """, (asset_id, ts_from, now))
        rows = cur.fetchall()

        result = []
        for r in rows:
            avg = float(r["avg_pct"] or 0)
            std = float(r["stddev_pct"] or 0)
            ovi = round(std / avg, 3) if avg > 0 else None
            result.append({
                "mese": str(r["mese"])[:7],
                "avg_pct": avg,
                "stddev_pct": std,
                "ovi": ovi,
                "n": int(r["n"]),
            })

        return {
            "asset_id": asset_id,
            "mesi": mesi,
            "dati_parziali": mesi < 8,
            "data": result,
        }

    # ── KPI Occupancy Portafoglio ─────────────────────────────────────────────

    @app.get("/api/occupancy/portfolio/kpi_summary", tags=["occupancy-kpi"])
    def get_occupancy_portfolio_kpi(giorni: int = 30,
                                     _=Depends(get_utente_corrente),
                                     db=Depends(get_db)):
        """P-O1: Tasso Utilizzo Medio Portafoglio — per ogni asset con dati occupancy."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(days=giorni)

        cur.execute("""
            SELECT t.asset_id,
                   a.nome,
                   a.tipo,
                   a.superficie_mq,
                   ROUND(AVG(CASE WHEN t.occupancy THEN 100.0 ELSE 0.0 END)::numeric, 1) AS avg_pct,
                   COUNT(DISTINCT t.zone_id) AS zone_count
            FROM telemetry t
            JOIN assets a ON a.id = t.asset_id
            WHERE t.zone_id IS NOT NULL AND t.ts >= %s AND t.ts < %s
            GROUP BY t.asset_id, a.nome, a.tipo, a.superficie_mq
            ORDER BY avg_pct DESC
        """, (ts_from, now))
        rows = cur.fetchall()

        if not rows:
            return {"giorni": giorni, "avg_portafoglio": None, "asset": []}

        assets_list = []
        for r in rows:
            assets_list.append({
                "asset_id": r["asset_id"],
                "nome": r["nome"],
                "tipo": r["tipo"],
                "superficie_mq": float(r["superficie_mq"] or 0),
                "avg_pct": float(r["avg_pct"] or 0),
                "zone_count": int(r["zone_count"]),
            })

        avg_portafoglio = round(sum(a["avg_pct"] for a in assets_list) / len(assets_list), 1)

        return {
            "giorni": giorni,
            "avg_portafoglio": avg_portafoglio,
            "n_asset": len(assets_list),
            "asset": assets_list,
        }

    @app.get("/api/occupancy/portfolio/weekly_pattern", tags=["occupancy-kpi"])
    def get_occupancy_portfolio_weekly(giorni: int = 90,
                                        _=Depends(get_utente_corrente),
                                        db=Depends(get_db)):
        """P-O2: Pattern Settimanale Portafoglio — media portafoglio per giorno settimana."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(days=giorni)

        cur.execute("""
            SELECT EXTRACT(isodow FROM ts AT TIME ZONE 'Europe/Rome')::int AS dow,
                   ROUND(AVG(CASE WHEN occupancy THEN 100.0 ELSE 0.0 END)::numeric, 1) AS avg_pct,
                   COUNT(DISTINCT asset_id) AS n_asset
            FROM telemetry
            WHERE zone_id IS NOT NULL AND ts >= %s AND ts < %s
            GROUP BY dow
            ORDER BY dow
        """, (ts_from, now))
        rows = cur.fetchall()

        dow_labels = {1:"Lun",2:"Mar",3:"Mer",4:"Gio",5:"Ven",6:"Sab",7:"Dom"}
        dow_map = {r["dow"]: r for r in rows}
        result = []
        for dow in range(1, 8):
            r = dow_map.get(dow)
            result.append({
                "dow": dow,
                "label": dow_labels[dow],
                "avg_pct": float(r["avg_pct"]) if r else None,
                "n_asset": int(r["n_asset"]) if r else 0,
                "weekend": dow >= 6,
            })

        return {
            "giorni": giorni,
            "dati_parziali": giorni < 84,
            "data": result,
        }

    @app.get("/api/occupancy/portfolio/scatter", tags=["occupancy-kpi"])
    def get_occupancy_portfolio_scatter(giorni: int = 365,
                                         _=Depends(get_utente_corrente),
                                         db=Depends(get_db)):
        """P-O5: Scatter Occupancy vs EUI — per ogni asset con dati occupancy."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from_occ = now - timedelta(days=30)
        ts_from_energy = now - timedelta(days=giorni)

        cur.execute("""
            SELECT asset_id, ROUND(AVG(pct_occupancy)::numeric, 1) AS avg_pct
            FROM occupancy_snapshot
            WHERE ts >= %s AND ts < %s
            GROUP BY asset_id
        """, (ts_from_occ, now))
        occ_map = {r["asset_id"]: float(r["avg_pct"]) for r in cur.fetchall()}

        if not occ_map:
            return {"data": [], "median_occupancy": None, "median_eui": None}

        cur.execute("""
            SELECT r.asset_id,
                   SUM(r.valore) AS kwh_totale,
                   a.superficie_mq,
                   a.nome,
                   a.tipo,
                   a.building_category,
                   a.energy_class
            FROM energy_readings r
            JOIN energy_meters m ON m.id = r.meter_id
            JOIN assets a ON a.id = r.asset_id
            WHERE r.asset_id = ANY(%s) AND m.tipo = 'elettrico'
              AND r.ts >= %s AND r.ts < %s
            GROUP BY r.asset_id, a.superficie_mq, a.nome, a.tipo, a.building_category, a.energy_class
        """, (list(occ_map.keys()), ts_from_energy, now))
        energy_rows = cur.fetchall()

        result = []
        for r in energy_rows:
            aid = r["asset_id"]
            if aid not in occ_map:
                continue
            sup = float(r["superficie_mq"] or 1)
            kwh = float(r["kwh_totale"] or 0)
            days_ratio = giorni / 365.0
            eui = round(kwh / sup / days_ratio, 1) if sup > 0 and days_ratio > 0 else None
            result.append({
                "asset_id": aid,
                "nome": r["nome"],
                "tipo": r["tipo"],
                "building_category": r["building_category"],
                "energy_class": r["energy_class"],
                "superficie_mq": sup,
                "avg_pct_occupancy": occ_map[aid],
                "eui_kwh_mq_anno": eui,
            })

        if result:
            occ_vals = sorted([x["avg_pct_occupancy"] for x in result])
            eui_vals = sorted([x["eui_kwh_mq_anno"] for x in result if x["eui_kwh_mq_anno"]])
            med_occ = occ_vals[len(occ_vals)//2] if occ_vals else None
            med_eui = eui_vals[len(eui_vals)//2] if eui_vals else None
        else:
            med_occ = med_eui = None

        return {
            "data": result,
            "median_occupancy": med_occ,
            "median_eui": med_eui,
            "giorni_energia": giorni,
        }

    # ── KPI IAQ — Qualità Aria e Comfort (da tabella telemetry) ──────────────
    # Registrati prima degli endpoint /{asset_id}/* per evitare conflitti.

    @app.get("/api/occupancy/portfolio/iaq_summary", tags=["occupancy-kpi"])
    def get_iaq_portfolio_summary(giorni: int = 30,
                                   _=Depends(get_utente_corrente),
                                   db=Depends(get_db)):
        """P-O3: Qualità Aria Portafoglio — asset con CO2 critico, medie IAQ."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(days=giorni)

        # Media CO2, temp, humidity per asset + conteggio ore critiche (CO2 > 1000 ppm)
        cur.execute("""
            SELECT
                t.asset_id,
                a.nome,
                a.tipo,
                COUNT(DISTINCT t.zone_id) AS zone_iaq,
                ROUND(AVG(t.co2_ppm)::numeric, 0)    AS avg_co2,
                ROUND(MAX(t.co2_ppm)::numeric, 0)    AS max_co2,
                ROUND(AVG(t.temp_c)::numeric, 1)     AS avg_temp,
                ROUND(AVG(t.humidity)::numeric, 1)   AS avg_hum,
                COUNT(*) AS tot_letture,
                SUM(CASE WHEN t.co2_ppm > 1000 THEN 1 ELSE 0 END) AS ore_co2_critico,
                SUM(CASE WHEN t.co2_ppm > 800  THEN 1 ELSE 0 END) AS ore_co2_warning
            FROM telemetry t
            JOIN assets a ON a.id = t.asset_id
            WHERE t.co2_ppm IS NOT NULL
              AND t.ts >= %s AND t.ts < %s
            GROUP BY t.asset_id, a.nome, a.tipo
            ORDER BY avg_co2 DESC
        """, (ts_from, now))
        rows = cur.fetchall()

        if not rows:
            return {"giorni": giorni, "n_asset_iaq": 0, "asset_critici": 0, "data": []}

        result = []
        for r in rows:
            tot = int(r["tot_letture"]) or 1
            pct_critico = round(int(r["ore_co2_critico"]) / tot * 100, 1)
            pct_warning = round(int(r["ore_co2_warning"]) / tot * 100, 1)
            stato = "critico" if pct_critico > 20 else ("warning" if pct_warning > 30 else "ok")
            result.append({
                "asset_id":       r["asset_id"],
                "nome":           r["nome"],
                "tipo":           r["tipo"],
                "zone_iaq":       int(r["zone_iaq"]),
                "avg_co2":        float(r["avg_co2"] or 0),
                "max_co2":        float(r["max_co2"] or 0),
                "avg_temp":       float(r["avg_temp"] or 0),
                "avg_hum":        float(r["avg_hum"] or 0),
                "pct_ore_critico": pct_critico,
                "pct_ore_warning": pct_warning,
                "stato_iaq":      stato,
            })

        n_critici = sum(1 for r in result if r["stato_iaq"] == "critico")
        avg_co2_portfolio = round(sum(r["avg_co2"] for r in result) / len(result), 0)
        avg_temp_portfolio = round(sum(r["avg_temp"] for r in result) / len(result), 1)

        return {
            "giorni":              giorni,
            "n_asset_iaq":         len(result),
            "asset_critici":       n_critici,
            "avg_co2_portfolio":   avg_co2_portfolio,
            "avg_temp_portfolio":  avg_temp_portfolio,
            "data":                result,
        }

    @app.get("/api/occupancy/{asset_id}/iaq_summary", tags=["occupancy-kpi"])
    def get_iaq_asset_summary(asset_id: int,
                               giorni: int = 30,
                               _=Depends(get_utente_corrente),
                               db=Depends(get_db)):
        """O-3/O-4: Qualità Aria e Comfort Termico per asset — medie CO2, temp, umidità per zona."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(days=giorni)

        cur.execute("""
            SELECT
                zone_id,
                ROUND(AVG(co2_ppm)::numeric, 0)  AS avg_co2,
                ROUND(MAX(co2_ppm)::numeric, 0)  AS max_co2,
                ROUND(AVG(temp_c)::numeric, 1)   AS avg_temp,
                ROUND(MIN(temp_c)::numeric, 1)   AS min_temp,
                ROUND(MAX(temp_c)::numeric, 1)   AS max_temp,
                ROUND(AVG(humidity)::numeric, 1) AS avg_hum,
                COUNT(*) AS tot_letture,
                SUM(CASE WHEN co2_ppm > 1000 THEN 1 ELSE 0 END) AS ore_co2_critico,
                SUM(CASE WHEN co2_ppm > 800  THEN 1 ELSE 0 END) AS ore_co2_warning,
                SUM(CASE WHEN temp_c > 26 OR temp_c < 19 THEN 1 ELSE 0 END) AS ore_temp_fuori
            FROM telemetry
            WHERE asset_id = %s
              AND co2_ppm IS NOT NULL
              AND ts >= %s AND ts < %s
            GROUP BY zone_id
            ORDER BY avg_co2 DESC
        """, (asset_id, ts_from, now))
        zone_rows = cur.fetchall()

        if not zone_rows:
            return {
                "asset_id": asset_id,
                "giorni": giorni,
                "iaq_disponibile": False,
                "zone": [],
            }

        zone_list = []
        for r in zone_rows:
            tot = int(r["tot_letture"]) or 1
            pct_critico = round(int(r["ore_co2_critico"]) / tot * 100, 1)
            pct_warning = round(int(r["ore_co2_warning"]) / tot * 100, 1)
            pct_temp_fuori = round(int(r["ore_temp_fuori"]) / tot * 100, 1)
            stato = "critico" if pct_critico > 20 else ("warning" if pct_warning > 30 else "ok")
            zone_list.append({
                "zone_id":          r["zone_id"],
                "avg_co2":          float(r["avg_co2"] or 0),
                "max_co2":          float(r["max_co2"] or 0),
                "avg_temp":         float(r["avg_temp"] or 0),
                "min_temp":         float(r["min_temp"] or 0),
                "max_temp":         float(r["max_temp"] or 0),
                "avg_hum":          float(r["avg_hum"] or 0),
                "pct_ore_critico":  pct_critico,
                "pct_ore_warning":  pct_warning,
                "pct_temp_fuori":   pct_temp_fuori,
                "stato_iaq":        stato,
            })

        # Medie asset
        avg_co2  = round(sum(z["avg_co2"]  for z in zone_list) / len(zone_list), 0)
        avg_temp = round(sum(z["avg_temp"] for z in zone_list) / len(zone_list), 1)
        avg_hum  = round(sum(z["avg_hum"]  for z in zone_list) / len(zone_list), 1)
        n_critici = sum(1 for z in zone_list if z["stato_iaq"] == "critico")

        return {
            "asset_id":        asset_id,
            "giorni":          giorni,
            "iaq_disponibile": True,
            "avg_co2":         avg_co2,
            "avg_temp":        avg_temp,
            "avg_hum":         avg_hum,
            "n_zone_critiche": n_critici,
            "zone":            zone_list,
        }

    @app.get("/api/occupancy/{asset_id}/iaq_trend", tags=["occupancy-kpi"])
    def get_iaq_asset_trend(asset_id: int,
                             giorni: int = 30,
                             _=Depends(get_utente_corrente),
                             db=Depends(get_db)):
        """O-3 Trend: andamento giornaliero CO2 media, max, temp media per asset."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(days=giorni)

        cur.execute("""
            SELECT
                DATE_TRUNC('day', ts AT TIME ZONE 'Europe/Rome')::date AS giorno,
                ROUND(AVG(co2_ppm)::numeric, 0)  AS avg_co2,
                ROUND(MAX(co2_ppm)::numeric, 0)  AS max_co2,
                ROUND(AVG(temp_c)::numeric, 1)   AS avg_temp,
                ROUND(AVG(humidity)::numeric, 1) AS avg_hum,
                COUNT(*) AS n_letture
            FROM telemetry
            WHERE asset_id = %s
              AND co2_ppm IS NOT NULL
              AND ts >= %s AND ts < %s
            GROUP BY giorno
            ORDER BY giorno
        """, (asset_id, ts_from, now))
        rows = cur.fetchall()

        return {
            "asset_id": asset_id,
            "giorni": giorni,
            "data": [
                {
                    "giorno":    str(r["giorno"]),
                    "avg_co2":   float(r["avg_co2"] or 0),
                    "max_co2":   float(r["max_co2"] or 0),
                    "avg_temp":  float(r["avg_temp"] or 0),
                    "avg_hum":   float(r["avg_hum"] or 0),
                    "n_letture": int(r["n_letture"]),
                }
                for r in rows
            ],
        }

    # ── daily_avg: media giornaliera occupancy % per asset ─────────────────
    @app.get("/api/occupancy/{asset_id}/daily_avg", tags=["occupancy-kpi"])
    async def get_occupancy_daily_avg(
        asset_id: int,
        giorni: int = 30,
        current_user=Depends(get_utente_corrente),
        db=Depends(get_db)
    ):
        """
        Media giornaliera occupancy % in orario lavorativo.
        Formula: AVG(SUM_persone_per_campione) / capacita_totale_asset × 100
        Filtra solo i campioni nell'orario lavorativo configurato sull'asset
        (working_hours_start..working_hours_end, default 08:00-19:00).
        """
        now = datetime.utcnow()
        ts_from = now - timedelta(days=giorni)
        with db.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # 1. Orario lavorativo dell'asset
            cur.execute("""
                SELECT working_hours_start, working_hours_end
                FROM assets WHERE id = %s
            """, (asset_id,))
            asset = cur.fetchone()
            wh_start = int(str(asset["working_hours_start"] or "08:00:00").split(":")[0]) if asset else 8
            wh_end   = int(str(asset["working_hours_end"]   or "19:00:00").split(":")[0]) if asset else 19

            # 2. Capienza totale fissa dell'asset
            cur.execute("""
                SELECT COALESCE(SUM(capacita_persone), 1) AS cap_tot
                FROM zones
                WHERE asset_id = %s AND capacita_persone > 0
            """, (asset_id,))
            cap_tot = float(cur.fetchone()["cap_tot"] or 1)

            # 3. Per ogni campione in orario lavorativo: somma persone su tutte le zone,
            #    poi media giornaliera divisa per capienza totale
            cur.execute("""
                SELECT
                    DATE(ts AT TIME ZONE 'Europe/Rome') AS giorno,
                    LEAST(ROUND(
                        AVG(campione_persone) / %s * 100.0
                    , 1), 100.0) AS occ_pct,
                    ROUND(AVG(campione_persone)::numeric, 1) AS avg_persone,
                    COUNT(*) AS n_campioni
                FROM (
                    SELECT
                        ts,
                        SUM(COALESCE(persone_presenti, 0)) AS campione_persone
                    FROM telemetry
                    WHERE asset_id = %s
                      AND ts >= %s AND ts <= %s
                      AND zone_id IS NOT NULL
                      AND EXTRACT(HOUR FROM ts AT TIME ZONE 'Europe/Rome') >= %s
                      AND EXTRACT(HOUR FROM ts AT TIME ZONE 'Europe/Rome') <  %s
                    GROUP BY ts
                ) sub
                GROUP BY giorno
                ORDER BY giorno
            """, (cap_tot, asset_id, ts_from, now, wh_start, wh_end))
            rows = cur.fetchall()
        return [
            {
                "giorno":        str(r["giorno"]),
                "occ_pct":       float(r["occ_pct"]) if r["occ_pct"] is not None else None,
                "avg_persone":   float(r["avg_persone"] or 0),
                "n_campioni":    int(r["n_campioni"]),
                "wh_start":      wh_start,
                "wh_end":        wh_end,
            }
            for r in rows
        ]

    @app.get("/api/occupancy/{asset_id}/hourly")
    async def get_occupancy_hourly(
        asset_id: int,
        ore: int = 168,
        current_user=Depends(get_utente_corrente),
        db=Depends(get_db)
    ):
        """
        Occupancy % con risoluzione oraria per il grafico Consumi vs Occupancy.
        Per ogni ora: SUM(persone_presenti) / capienza_totale * 100.
        Ore fuori orario lavorativo → 0%.
        """
        now = datetime.utcnow()
        ts_from = now - timedelta(hours=ore)
        with db.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Capienza totale fissa
            cur.execute("""
                SELECT COALESCE(SUM(capacita_persone), 1) AS cap_tot
                FROM zones WHERE asset_id = %s AND capacita_persone > 0
            """, (asset_id,))
            cap_tot = float(cur.fetchone()["cap_tot"] or 1)

            # Occupancy per ora: somma persone per ts troncato all'ora, poi media nell'ora
            cur.execute("""
                SELECT
                    date_trunc('hour', ts AT TIME ZONE 'Europe/Rome') AS ora_ts,
                    LEAST(
                        ROUND(AVG(somma_pp) / %s * 100.0, 1),
                        100.0
                    ) AS occ_pct
                FROM (
                    SELECT
                        ts,
                        SUM(COALESCE(persone_presenti, 0)) AS somma_pp
                    FROM telemetry
                    WHERE asset_id = %s
                      AND ts >= %s AND ts <= %s
                      AND zone_id IS NOT NULL
                    GROUP BY ts
                ) sub
                GROUP BY date_trunc('hour', ts AT TIME ZONE 'Europe/Rome')
                ORDER BY ora_ts
            """, (cap_tot, asset_id, ts_from, now))
            rows = cur.fetchall()
        return [
            {
                "ts":      r["ora_ts"].isoformat(),
                "occ_pct": float(r["occ_pct"]) if r["occ_pct"] is not None else 0.0,
            }
            for r in rows
        ]
