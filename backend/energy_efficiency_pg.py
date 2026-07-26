"""
GIS Asset Manager - Modulo Efficienza Energetica (KPI)
Versione: 1.0
Autore: Felix / KeyBiz

Endpoint aggregati per il modulo Efficienza Energetica (tab modale + pagina Energy Summary).
Usa la tabella telemetry (impianti asset 6) e energy_readings (contatori per tutti gli asset).

Endpoint esposti:
  GET /api/efficiency/{asset_id}/kpi          — KPI sintesi (E-1…E-6)
  GET /api/efficiency/{asset_id}/profile24h   — Profilo 24h per tipo impianto (E-7)
  GET /api/efficiency/{asset_id}/breakdown    — Breakdown % per tipo impianto (E-9)
  GET /api/efficiency/{asset_id}/heatmap7d    — Heatmap ora×giorno ultimi 7gg (E-10)
  GET /api/efficiency/{asset_id}/trend        — Trend mensile consumi + costi (E-13, E-14)
  GET /api/efficiency/{asset_id}/baseline     — Confronto baseline per impianto (E-8)
  GET /api/efficiency/{asset_id}/occupancy    — Correlazione occupancy vs costo (E-12)
  GET /api/efficiency/portfolio/summary       — KPI portafoglio (P-1…P-10)
"""

import os
import psycopg2
import psycopg2.extras
from datetime import datetime, timedelta, timezone, date
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://gamuser:gampassword@localhost:5432/gamdb"
)

# ── Mapping tipo impianto → etichetta leggibile ───────────────────────────────
PLANT_TYPE_LABEL = {
    "hvac":          "HVAC",
    "illuminazione": "Illuminazione",
    "ced":           "CED",
    "altri_carichi": "Altri carichi",
    "servizi_em":    "Servizi EM",
    "contatore":     "Contatore principale",
}

# Colori per tipo impianto (usati nei grafici frontend)
PLANT_TYPE_COLOR = {
    "hvac":          "#58A6FF",
    "illuminazione": "#F0E68C",
    "ced":           "#FF8C00",
    "altri_carichi": "#8FBC8F",
    "servizi_em":    "#DDA0DD",
    "contatore":     "#A0A0A0",
}

# Classi energetiche EUI (kWh/mq/anno) per uffici — soglie EPBD
EUI_THRESHOLDS_OFFICE = [
    ("A4", 0,   30),
    ("A3", 30,  50),
    ("A2", 50,  75),
    ("A1", 75,  100),
    ("A",  100, 130),
    ("B",  130, 160),
    ("C",  160, 200),
    ("D",  200, 250),
    ("E",  250, 320),
    ("F",  320, 400),
    ("G",  400, 9999),
]


def _eui_class(eui_kwh_mq_anno: float) -> str:
    for label, lo, hi in EUI_THRESHOLDS_OFFICE:
        if lo <= eui_kwh_mq_anno < hi:
            return label
    return "G"


def _get_unit_cost(cur, asset_id: int, commodity: str) -> float:
    """Recupera il costo unitario per asset/commodity. Fallback su valori di default."""
    defaults = {"ELECTRICITY": 0.285, "GAS_METHANE": 0.980, "WATER": 2.15}
    cur.execute(
        "SELECT unit_cost_eur FROM energy_unit_costs WHERE asset_id=%s AND commodity=%s",
        (asset_id, commodity)
    )
    row = cur.fetchone()
    if row:
        return float(row["unit_cost_eur"])
    return defaults.get(commodity, 0.25)


def _telemetry_available(cur, asset_id: int) -> bool:
    """Verifica se ci sono dati di telemetria per impianti dell'asset."""
    cur.execute(
        "SELECT 1 FROM telemetry WHERE asset_id=%s LIMIT 1",
        (asset_id,)
    )
    return cur.fetchone() is not None


def register_efficiency_routes(app, get_db, get_utente_corrente):
    """Registra gli endpoint del modulo Efficienza Energetica sull'app FastAPI."""

    # ── E-1 … E-6: KPI Sintesi ────────────────────────────────────────────────
    @app.get("/api/efficiency/{asset_id}/kpi", tags=["efficiency"])
    def get_efficiency_kpi(asset_id: int,
                           _=Depends(get_utente_corrente),
                           db=Depends(get_db)):
        """KPI sintesi efficienza energetica per un asset.
        Calcola: costo periodo, EUI, % fuori orario, allarmi energetici attivi,
        trend vs periodo precedente, CO2 equivalente."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Dati asset
        cur.execute("""
            SELECT id, nome, tipo, superficie_mq, anno_costruzione, energy_class,
                   working_hours_start, working_hours_end, working_days
            FROM assets WHERE id=%s
        """, (asset_id,))
        asset = cur.fetchone()
        if not asset:
            raise HTTPException(status_code=404, detail="Asset non trovato")

        superficie = asset["superficie_mq"] or 1
        now = datetime.now(timezone.utc)
        mese_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        mese_prec_start = (mese_start - timedelta(days=1)).replace(day=1)
        anno_start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)

        # Costo unitario elettricità
        unit_cost_elec = _get_unit_cost(cur, asset_id, "ELECTRICITY")
        unit_cost_gas  = _get_unit_cost(cur, asset_id, "GAS_METHANE")

        # Usa telemetria se disponibile (asset con impianti), altrimenti energy_readings
        use_telemetry = _telemetry_available(cur, asset_id)

        if use_telemetry:
            # Consumi dal totale impianti (escludi contatori principali)
            # Formula corretta: integrazione trapezoidale → SUM(power_kw * Δt_ore)
            # usando LAG per calcolare Δt tra letture consecutive per ogni impianto
            cur.execute("""
                SELECT COALESCE(SUM(sub.kwh_step), 0) AS kwh_mese
                FROM (
                    SELECT t.power_kw
                           * EXTRACT(EPOCH FROM (t.ts - LAG(t.ts) OVER
                               (PARTITION BY t.plant_id ORDER BY t.ts))) / 3600.0 AS kwh_step
                    FROM telemetry t
                    JOIN plants p ON p.plant_id = t.plant_id AND p.asset_id = t.asset_id
                    WHERE t.asset_id=%%s AND t.ts >= %%s AND t.ts <= %%s
                      AND p.tipo NOT IN ('contatore')
                ) sub
                WHERE sub.kwh_step IS NOT NULL AND sub.kwh_step > 0
            """.replace('%%s', '%s'), (asset_id, mese_start, now))
            row = cur.fetchone()
            kwh_mese = float(row["kwh_mese"] or 0)

            # Mese precedente
            cur.execute("""
                SELECT COALESCE(SUM(sub.kwh_step), 0) AS kwh
                FROM (
                    SELECT t.power_kw
                           * EXTRACT(EPOCH FROM (t.ts - LAG(t.ts) OVER
                               (PARTITION BY t.plant_id ORDER BY t.ts))) / 3600.0 AS kwh_step
                    FROM telemetry t
                    JOIN plants p ON p.plant_id = t.plant_id AND p.asset_id = t.asset_id
                    WHERE t.asset_id=%%s AND t.ts >= %%s AND t.ts < %%s
                      AND p.tipo NOT IN ('contatore')
                ) sub
                WHERE sub.kwh_step IS NOT NULL AND sub.kwh_step > 0
            """.replace('%%s', '%s'), (asset_id, mese_prec_start, mese_start))
            kwh_mese_prec = float(cur.fetchone()["kwh"] or 0)

            # Anno corrente
            cur.execute("""
                SELECT COALESCE(SUM(sub.kwh_step), 0) AS kwh
                FROM (
                    SELECT t.power_kw
                           * EXTRACT(EPOCH FROM (t.ts - LAG(t.ts) OVER
                               (PARTITION BY t.plant_id ORDER BY t.ts))) / 3600.0 AS kwh_step
                    FROM telemetry t
                    JOIN plants p ON p.plant_id = t.plant_id AND p.asset_id = t.asset_id
                    WHERE t.asset_id=%%s AND t.ts >= %%s AND t.ts <= %%s
                      AND p.tipo NOT IN ('contatore')
                ) sub
                WHERE sub.kwh_step IS NOT NULL AND sub.kwh_step > 0
            """.replace('%%s', '%s'), (asset_id, anno_start, now))
            kwh_anno = float(cur.fetchone()["kwh"] or 0)

            # % fuori orario (ore non lavorative)
            _whs = asset["working_hours_start"]
            _whe = asset["working_hours_end"]
            wh_start = int(str(_whs or "08:00:00").split(":")[0])
            wh_end   = int(str(_whe or "19:00:00").split(":")[0])
            cur.execute("""
                SELECT
                    COALESCE(SUM(CASE WHEN EXTRACT(HOUR FROM t.ts AT TIME ZONE 'Europe/Rome')
                                          NOT BETWEEN %s AND %s
                                     THEN t.power_kw ELSE 0 END), 0) AS kwh_off,
                    COALESCE(SUM(t.power_kw), 0) AS kwh_tot
                FROM telemetry t
                JOIN plants p ON p.plant_id = t.plant_id AND p.asset_id = t.asset_id
                WHERE t.asset_id=%s AND t.ts >= %s AND t.ts <= %s
                  AND p.tipo NOT IN ('contatore')
            """, (wh_start, wh_end - 1, asset_id, mese_start, now))
            row_off = cur.fetchone()
            kwh_off = float(row_off["kwh_off"] or 0)
            kwh_tot_check = float(row_off["kwh_tot"] or 1)
            pct_fuori_orario = round((kwh_off / kwh_tot_check) * 100, 1) if kwh_tot_check > 0 else 0.0

        else:
            # Fallback su energy_readings (contatori vettoriali)
            cur.execute("""
                SELECT COALESCE(SUM(r.valore), 0) AS kwh
                FROM energy_readings r
                JOIN energy_meters m ON m.id = r.meter_id
                WHERE r.asset_id=%s AND m.tipo='elettrico' AND r.ts >= %s AND r.ts <= %s
            """, (asset_id, mese_start, now))
            kwh_mese = float(cur.fetchone()["kwh"] or 0)

            cur.execute("""
                SELECT COALESCE(SUM(r.valore), 0) AS kwh
                FROM energy_readings r
                JOIN energy_meters m ON m.id = r.meter_id
                WHERE r.asset_id=%s AND m.tipo='elettrico' AND r.ts >= %s AND r.ts < %s
            """, (asset_id, mese_prec_start, mese_start))
            kwh_mese_prec = float(cur.fetchone()["kwh"] or 0)

            cur.execute("""
                SELECT COALESCE(SUM(r.valore), 0) AS kwh
                FROM energy_readings r
                JOIN energy_meters m ON m.id = r.meter_id
                WHERE r.asset_id=%s AND m.tipo='elettrico' AND r.ts >= %s AND r.ts <= %s
            """, (asset_id, anno_start, now))
            kwh_anno = float(cur.fetchone()["kwh"] or 0)
            pct_fuori_orario = None  # Non calcolabile senza telemetria oraria

        # Costo mese corrente (solo elettricità per semplicità)
        costo_mese = round(kwh_mese * unit_cost_elec, 2)
        costo_mese_prec = round(kwh_mese_prec * unit_cost_elec, 2)

        # EUI annualizzato (kWh/mq/anno)
        giorni_anno_trascorsi = max((now - anno_start).days, 1)
        kwh_anno_proiettato = kwh_anno * (365 / giorni_anno_trascorsi)
        eui = round(kwh_anno_proiettato / superficie, 1)

        # Classe calcolata vs certificata
        eui_class_calcolata = _eui_class(eui)
        eui_class_certificata = asset["energy_class"] or None

        # CO2 equivalente mese (fattore 0.233 kg/kWh)
        co2_kg_mese = round(kwh_mese * 0.233, 1)

        # Trend vs mese precedente
        if kwh_mese_prec > 0:
            trend_pct = round(((kwh_mese - kwh_mese_prec) / kwh_mese_prec) * 100, 1)
        else:
            trend_pct = None

        # Allarmi energetici attivi
        cur.execute("""
            SELECT COUNT(*) AS n FROM alarms
            WHERE asset_id=%s AND ack_at IS NULL
              AND (campo ILIKE '%%energia%%' OR campo ILIKE '%%consumo%%'
                   OR campo ILIKE '%%potenza%%' OR campo ILIKE '%%kwh%%'
                   OR campo ILIKE '%%efficien%%')
        """, (asset_id,))
        n_allarmi = cur.fetchone()["n"] or 0

        return {
            "asset_id": asset_id,
            "asset_nome": asset["nome"],
            "superficie_mq": superficie,
            "anno_costruzione": asset["anno_costruzione"],
            "energy_class_certificata": eui_class_certificata,
            "energy_class_calcolata": eui_class_calcolata,
            "working_hours_start": str(asset["working_hours_start"] or "08:00"),
            "working_hours_end":   str(asset["working_hours_end"]   or "19:00"),
            "working_days": asset["working_days"] or "MON,TUE,WED,THU,FRI",
            # E-1: Costo energetico periodo
            "costo_mese_eur": costo_mese,
            "costo_mese_prec_eur": costo_mese_prec,
            # E-2: Costo per mq
            "costo_mq_eur": round(costo_mese / superficie, 3),
            # E-3: EUI
            "eui_kwh_mq_anno": eui,
            # E-4: Allarmi energetici
            "allarmi_energetici_attivi": int(n_allarmi),
            # E-5: % fuori orario
            "pct_fuori_orario": pct_fuori_orario,
            # E-6: CO2
            "co2_kg_mese": co2_kg_mese,
            # Trend
            "trend_vs_mese_prec_pct": trend_pct,
            # Consumi grezzi
            "kwh_mese": round(kwh_mese, 1),
            "kwh_mese_prec": round(kwh_mese_prec, 1),
            "kwh_anno": round(kwh_anno, 1),
            "has_telemetry": use_telemetry if use_telemetry else False,
        }

    # ── E-7: Profilo 24h per tipo impianto ────────────────────────────────────
    @app.get("/api/efficiency/{asset_id}/profile24h", tags=["efficiency"])
    def get_profile24h(asset_id: int,
                       giorni: int = 7,
                       _=Depends(get_utente_corrente),
                       db=Depends(get_db)):
        """Profilo medio di potenza (kW) per ora del giorno, aggregato per tipo impianto.
        Restituisce una lista di {ora: 0-23, tipo: str, label: str, kw_medio: float}."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(days=giorni)

        cur.execute("""
            SELECT
                EXTRACT(HOUR FROM t.ts AT TIME ZONE 'Europe/Rome')::int AS ora,
                p.tipo,
                AVG(t.power_kw) AS kw_medio
            FROM telemetry t
            JOIN plants p ON p.plant_id = t.plant_id AND p.asset_id = t.asset_id
            WHERE t.asset_id = %s AND t.ts >= %s
              AND p.tipo NOT IN ('contatore')
              AND t.power_kw IS NOT NULL
            GROUP BY ora, p.tipo
            ORDER BY p.tipo, ora
        """, (asset_id, ts_from))
        rows = cur.fetchall()

        result = []
        for r in rows:
            result.append({
                "ora": int(r["ora"]),
                "tipo": r["tipo"],
                "label": PLANT_TYPE_LABEL.get(r["tipo"], r["tipo"]),
                "color": PLANT_TYPE_COLOR.get(r["tipo"], "#888"),
                "kw_medio": round(float(r["kw_medio"] or 0), 2),
            })
        return result

    # ── E-8: Baseline vs attuale per impianto ─────────────────────────────────
    @app.get("/api/efficiency/{asset_id}/baseline", tags=["efficiency"])
    def get_baseline_comparison(asset_id: int,
                                _=Depends(get_utente_corrente),
                                db=Depends(get_db)):
        """Confronto potenza media attuale vs baseline configurata per ogni impianto."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(hours=24)

        cur.execute("""
            SELECT
                p.plant_id, p.nome, p.tipo, p.energy_baseline_kw,
                AVG(t.power_kw) AS kw_attuale
            FROM plants p
            LEFT JOIN telemetry t ON t.plant_id = p.plant_id AND t.asset_id = p.asset_id
                AND t.ts >= %s
            WHERE p.asset_id = %s AND p.tipo NOT IN ('contatore')
            GROUP BY p.plant_id, p.nome, p.tipo, p.energy_baseline_kw
            ORDER BY p.tipo, p.nome
        """, (ts_from, asset_id))
        rows = cur.fetchall()

        result = []
        for r in rows:
            kw_att = float(r["kw_attuale"] or 0)
            baseline = float(r["energy_baseline_kw"] or 0)
            delta_pct = None
            if baseline > 0:
                delta_pct = round(((kw_att - baseline) / baseline) * 100, 1)
            result.append({
                "plant_id": r["plant_id"],
                "nome": r["nome"],
                "tipo": r["tipo"],
                "label": PLANT_TYPE_LABEL.get(r["tipo"], r["tipo"]),
                "color": PLANT_TYPE_COLOR.get(r["tipo"], "#888"),
                "kw_baseline": baseline,
                "kw_attuale": round(kw_att, 2),
                "delta_pct": delta_pct,
            })
        return result

    # ── E-9: Breakdown % per tipo impianto ────────────────────────────────────
    @app.get("/api/efficiency/{asset_id}/breakdown", tags=["efficiency"])
    def get_breakdown(asset_id: int,
                      giorni: int = 30,
                      _=Depends(get_utente_corrente),
                      db=Depends(get_db)):
        """Ripartizione percentuale dei consumi per tipo impianto negli ultimi N giorni.
        Restituisce lista di {tipo, label, color, kwh, pct}."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(days=giorni)

        cur.execute("""
            SELECT
                p.tipo,
                SUM(t.power_kw) * (EXTRACT(EPOCH FROM (%s - %s)) / 3600.0 / COUNT(DISTINCT t.ts)) AS kwh_approx
            FROM telemetry t
            JOIN plants p ON p.plant_id = t.plant_id AND p.asset_id = t.asset_id
            WHERE t.asset_id = %s AND t.ts >= %s
              AND p.tipo NOT IN ('contatore')
              AND t.power_kw IS NOT NULL
            GROUP BY p.tipo
            ORDER BY kwh_approx DESC
        """, (now, ts_from, asset_id, ts_from))
        rows = cur.fetchall()

        # Calcolo più preciso: media kW × ore periodo
        cur.execute("""
            SELECT
                p.tipo,
                AVG(t.power_kw) AS kw_medio,
                COUNT(*) AS n_letture
            FROM telemetry t
            JOIN plants p ON p.plant_id = t.plant_id AND p.asset_id = t.asset_id
            WHERE t.asset_id = %s AND t.ts >= %s
              AND p.tipo NOT IN ('contatore')
              AND t.power_kw IS NOT NULL
            GROUP BY p.tipo
            ORDER BY kw_medio DESC
        """, (asset_id, ts_from))
        rows = cur.fetchall()

        ore_periodo = giorni * 24
        totale_kwh = 0.0
        items = []
        for r in rows:
            kw_medio = float(r["kw_medio"] or 0)
            kwh = round(kw_medio * ore_periodo, 1)
            totale_kwh += kwh
            items.append({
                "tipo": r["tipo"],
                "label": PLANT_TYPE_LABEL.get(r["tipo"], r["tipo"]),
                "color": PLANT_TYPE_COLOR.get(r["tipo"], "#888"),
                "kwh": kwh,
                "pct": 0.0,
            })

        # Calcola percentuali
        for item in items:
            item["pct"] = round((item["kwh"] / totale_kwh) * 100, 1) if totale_kwh > 0 else 0.0

        return {"giorni": giorni, "totale_kwh": round(totale_kwh, 1), "breakdown": items}

    # ── E-10: Heatmap ora×giorno settimana ────────────────────────────────────
    @app.get("/api/efficiency/{asset_id}/heatmap7d", tags=["efficiency"])
    def get_heatmap7d(asset_id: int,
                      giorni: int = 28,
                      _=Depends(get_utente_corrente),
                      db=Depends(get_db)):
        """Heatmap consumo medio per ora del giorno × giorno della settimana.
        Restituisce lista di {dow: 0-6 (lun=0), ora: 0-23, kw_medio: float}."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(days=giorni)

        cur.execute("""
            SELECT
                EXTRACT(DOW FROM t.ts AT TIME ZONE 'Europe/Rome')::int AS dow,
                EXTRACT(HOUR FROM t.ts AT TIME ZONE 'Europe/Rome')::int AS ora,
                AVG(t.power_kw) AS kw_medio
            FROM telemetry t
            JOIN plants p ON p.plant_id = t.plant_id AND p.asset_id = t.asset_id
            WHERE t.asset_id = %s AND t.ts >= %s
              AND p.tipo NOT IN ('contatore')
              AND t.power_kw IS NOT NULL
            GROUP BY dow, ora
            ORDER BY dow, ora
        """, (asset_id, ts_from))
        rows = cur.fetchall()

        # PostgreSQL DOW: 0=domenica, 1=lunedì … 6=sabato → normalizziamo a lun=0
        result = []
        for r in rows:
            pg_dow = int(r["dow"])
            # Converti: pg 0(dom)→6, pg 1(lun)→0, …, pg 6(sab)→5
            dow_lun0 = (pg_dow - 1) % 7
            result.append({
                "dow": dow_lun0,
                "ora": int(r["ora"]),
                "kw_medio": round(float(r["kw_medio"] or 0), 2),
            })
        return result

    # ── E-12: Correlazione occupancy vs costo ────────────────────────────────
    @app.get("/api/efficiency/{asset_id}/occupancy", tags=["efficiency"])
    def get_occupancy_vs_cost(asset_id: int,
                              giorni: int = 14,
                              _=Depends(get_utente_corrente),
                              db=Depends(get_db)):
        """Correlazione giornaliera tra occupancy media e costo energetico.
        Restituisce lista di {data, occ_pct_media, kwh, costo_eur}."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(days=giorni)
        unit_cost = _get_unit_cost(cur, asset_id, "ELECTRICITY")

        # Occupancy media giornaliera
        cur.execute("""
            SELECT
                DATE(ts AT TIME ZONE 'Europe/Rome') AS giorno,
                AVG(pct_occupancy) AS occ_pct
            FROM occupancy_snapshot
            WHERE asset_id = %s AND ts >= %s
            GROUP BY giorno
            ORDER BY giorno
        """, (asset_id, ts_from))
        occ_rows = {str(r["giorno"]): float(r["occ_pct"] or 0) for r in cur.fetchall()}

        # Consumo giornaliero da telemetria
        cur.execute("""
            SELECT
                DATE(t.ts AT TIME ZONE 'Europe/Rome') AS giorno,
                AVG(t.power_kw) AS kw_medio
            FROM telemetry t
            JOIN plants p ON p.plant_id = t.plant_id AND p.asset_id = t.asset_id
            WHERE t.asset_id = %s AND t.ts >= %s
              AND p.tipo NOT IN ('contatore')
              AND t.power_kw IS NOT NULL
            GROUP BY giorno
            ORDER BY giorno
        """, (asset_id, ts_from))
        energy_rows = {str(r["giorno"]): float(r["kw_medio"] or 0) for r in cur.fetchall()}

        # Unisci per data
        all_dates = sorted(set(list(occ_rows.keys()) + list(energy_rows.keys())))
        result = []
        for d in all_dates:
            kw_medio = energy_rows.get(d, 0)
            kwh = round(kw_medio * 24, 1)
            result.append({
                "data": d,
                "occ_pct_media": round(occ_rows.get(d, 0), 1),
                "kwh": kwh,
                "costo_eur": round(kwh * unit_cost, 2),
            })
        return result

    # ── E-13, E-14: Trend mensile consumi + costi ─────────────────────────────
    @app.get("/api/efficiency/{asset_id}/trend", tags=["efficiency"])
    def get_trend(asset_id: int,
                  mesi: int = 12,
                  _=Depends(get_utente_corrente),
                  db=Depends(get_db)):
        """Trend mensile di consumi (kWh) e costi (€) negli ultimi N mesi.
        Restituisce lista di {mese: 'YYYY-MM', kwh, costo_eur, co2_kg}."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        unit_cost = _get_unit_cost(cur, asset_id, "ELECTRICITY")
        use_telemetry = _telemetry_available(cur, asset_id)

        if use_telemetry:
            cur.execute("""
                SELECT
                    TO_CHAR(t.ts AT TIME ZONE 'Europe/Rome', 'YYYY-MM') AS mese,
                    AVG(t.power_kw) AS kw_medio,
                    COUNT(DISTINCT DATE(t.ts AT TIME ZONE 'Europe/Rome')) AS giorni
                FROM telemetry t
                JOIN plants p ON p.plant_id = t.plant_id AND p.asset_id = t.asset_id
                WHERE t.asset_id = %s
                  AND t.ts >= NOW() - INTERVAL '%s months'
                  AND p.tipo NOT IN ('contatore')
                  AND t.power_kw IS NOT NULL
                GROUP BY mese
                ORDER BY mese
            """, (asset_id, mesi))
        else:
            cur.execute("""
                SELECT
                    TO_CHAR(r.ts AT TIME ZONE 'Europe/Rome', 'YYYY-MM') AS mese,
                    SUM(r.valore) AS kwh_tot,
                    COUNT(DISTINCT DATE(r.ts AT TIME ZONE 'Europe/Rome')) AS giorni
                FROM energy_readings r
                JOIN energy_meters m ON m.id = r.meter_id
                WHERE r.asset_id = %s AND m.tipo = 'elettrico'
                  AND r.ts >= NOW() - INTERVAL '%s months'
                GROUP BY mese
                ORDER BY mese
            """, (asset_id, mesi))

        rows = cur.fetchall()
        result = []
        for r in rows:
            if use_telemetry:
                giorni = int(r["giorni"] or 1)
                kwh = round(float(r["kw_medio"] or 0) * giorni * 24, 1)
            else:
                kwh = round(float(r["kwh_tot"] or 0), 1)
            costo = round(kwh * unit_cost, 2)
            co2 = round(kwh * 0.233, 1)
            result.append({
                "mese": r["mese"],
                "kwh": kwh,
                "costo_eur": costo,
                "co2_kg": co2,
            })
        return result

    # ── P-1 … P-10: KPI Portafoglio ──────────────────────────────────────────
    @app.get("/api/efficiency/portfolio/summary", tags=["efficiency"])
    def get_portfolio_summary(_=Depends(get_utente_corrente),
                              db=Depends(get_db)):
        """KPI aggregati per il portafoglio completo di asset.
        Calcola: consumi totali, costi, CO2, EUI medio, ranking, asset peggiori."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        mese_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        mese_prec_start = (mese_start - timedelta(days=1)).replace(day=1)
        anno_start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)

        cur.execute("SELECT id, nome, tipo, superficie_mq, energy_class FROM assets WHERE stato='attivo'")
        assets = cur.fetchall()

        totale_kwh_mese = 0.0
        totale_costo_mese = 0.0
        totale_co2_mese = 0.0
        totale_kwh_mese_prec = 0.0
        totale_kwh_anno = 0.0
        eui_list = []
        asset_ranking = []

        for a in assets:
            asset_id = a["id"]
            superficie = a["superficie_mq"] or 1
            unit_cost = _get_unit_cost(cur, asset_id, "ELECTRICITY")
            use_telemetry = _telemetry_available(cur, asset_id)

            if use_telemetry:
                # Formula corretta: integrazione trapezoidale Σ(power_kw × 0.25h)
                # Ogni riga telemetria rappresenta 15 minuti = 0.25 ore
                cur.execute("""
                    SELECT COALESCE(SUM(t.power_kw) * 0.25, 0) AS kwh_mese
                    FROM telemetry t
                    JOIN plants p ON p.plant_id = t.plant_id AND p.asset_id = t.asset_id
                    WHERE t.asset_id = %s AND t.ts >= %s AND t.ts <= %s
                      AND p.tipo NOT IN ('contatore') AND t.power_kw IS NOT NULL
                """, (asset_id, mese_start, now))
                kwh_mese = float(cur.fetchone()["kwh_mese"] or 0)

                cur.execute("""
                    SELECT COALESCE(SUM(t.power_kw) * 0.25, 0) AS kwh
                    FROM telemetry t
                    JOIN plants p ON p.plant_id = t.plant_id AND p.asset_id = t.asset_id
                    WHERE t.asset_id = %s AND t.ts >= %s AND t.ts < %s
                      AND p.tipo NOT IN ('contatore') AND t.power_kw IS NOT NULL
                """, (asset_id, mese_prec_start, mese_start))
                kwh_mese_prec = float(cur.fetchone()["kwh"] or 0)

                cur.execute("""
                    SELECT COALESCE(SUM(t.power_kw) * 0.25, 0) AS kwh
                    FROM telemetry t
                    JOIN plants p ON p.plant_id = t.plant_id AND p.asset_id = t.asset_id
                    WHERE t.asset_id = %s AND t.ts >= %s AND t.ts <= %s
                      AND p.tipo NOT IN ('contatore') AND t.power_kw IS NOT NULL
                """, (asset_id, anno_start, now))
                kwh_anno = float(cur.fetchone()["kwh"] or 0)
            else:
                cur.execute("""
                    SELECT COALESCE(SUM(r.valore), 0) AS kwh
                    FROM energy_readings r JOIN energy_meters m ON m.id = r.meter_id
                    WHERE r.asset_id=%s AND m.tipo='elettrico' AND r.ts >= %s AND r.ts <= %s
                """, (asset_id, mese_start, now))
                kwh_mese = float(cur.fetchone()["kwh"] or 0)

                cur.execute("""
                    SELECT COALESCE(SUM(r.valore), 0) AS kwh
                    FROM energy_readings r JOIN energy_meters m ON m.id = r.meter_id
                    WHERE r.asset_id=%s AND m.tipo='elettrico' AND r.ts >= %s AND r.ts < %s
                """, (asset_id, mese_prec_start, mese_start))
                kwh_mese_prec = float(cur.fetchone()["kwh"] or 0)

                cur.execute("""
                    SELECT COALESCE(SUM(r.valore), 0) AS kwh
                    FROM energy_readings r JOIN energy_meters m ON m.id = r.meter_id
                    WHERE r.asset_id=%s AND m.tipo='elettrico' AND r.ts >= %s AND r.ts <= %s
                """, (asset_id, anno_start, now))
                kwh_anno = float(cur.fetchone()["kwh"] or 0)

            costo_mese = round(kwh_mese * unit_cost, 2)
            co2_mese = round(kwh_mese * 0.233, 1)

            # EUI annualizzato
            giorni_anno = max((now - anno_start).days, 1)
            kwh_anno_proiettato = kwh_anno * (365 / giorni_anno)
            eui = round(kwh_anno_proiettato / superficie, 1)
            eui_class = _eui_class(eui)
            eui_list.append(eui)

            totale_kwh_mese      += kwh_mese
            totale_costo_mese    += costo_mese
            totale_co2_mese      += co2_mese
            totale_kwh_mese_prec += kwh_mese_prec
            totale_kwh_anno      += kwh_anno

            asset_ranking.append({
                "asset_id": asset_id,
                "nome": a["nome"],
                "tipo": a["tipo"],
                "superficie_mq": superficie,
                "kwh_mese": round(kwh_mese, 1),
                "costo_mese_eur": costo_mese,
                "eui": eui,
                "eui_class": eui_class,
                "energy_class_certificata": a["energy_class"],
                "has_telemetry": use_telemetry,
            })

        # Ordina per EUI decrescente (peggiori in cima)
        asset_ranking.sort(key=lambda x: x["eui"], reverse=True)

        # Trend portafoglio
        trend_pct = None
        if totale_kwh_mese_prec > 0:
            trend_pct = round(((totale_kwh_mese - totale_kwh_mese_prec) / totale_kwh_mese_prec) * 100, 1)

        eui_medio = round(sum(eui_list) / len(eui_list), 1) if eui_list else 0.0

        return {
            # P-1: Consumo totale portafoglio
            "kwh_mese_totale": round(totale_kwh_mese, 1),
            "kwh_anno_totale": round(totale_kwh_anno, 1),
            # P-2: Costo totale
            "costo_mese_eur": round(totale_costo_mese, 2),
            # P-3: CO2 totale
            "co2_kg_mese": round(totale_co2_mese, 1),
            # P-4: EUI medio portafoglio
            "eui_medio": eui_medio,
            # P-5: Trend
            "trend_vs_mese_prec_pct": trend_pct,
            # P-6: N. asset attivi
            "n_asset_attivi": len(assets),
            # P-7: Ranking asset per EUI (peggiori prima)
            "ranking_asset": asset_ranking,
            # P-8: Asset più efficiente
            "asset_migliore": asset_ranking[-1] if asset_ranking else None,
            # P-9: Asset meno efficiente
            "asset_peggiore": asset_ranking[0] if asset_ranking else None,
        }
