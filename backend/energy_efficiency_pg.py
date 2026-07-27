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

# Classi energetiche EUI (kWh/mq/anno) per categoria — soglie ENEA/EN 15251
# Catalogo KPI v3.0 § 1.4
EUI_THRESHOLDS = {
    "OFFICE": [
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
    ],
    "WAREHOUSE": [
        ("A",  0,   20),
        ("B",  20,  30),
        ("C",  30,  40),
        ("D",  40,  60),
        ("E",  60,  80),
        ("F",  80,  120),
        ("G",  120, 9999),
    ],
    "STORAGE": [
        ("A",  0,   10),
        ("B",  10,  15),
        ("C",  15,  20),
        ("D",  20,  30),
        ("E",  30,  40),
        ("F",  40,  60),
        ("G",  60,  9999),
    ],
}

# Benchmark €/mq/mese per categoria (fonte: ENEA, media nazionale 2024)
EUI_BENCHMARK_EUR_MQ = {
    "OFFICE":    {"min": 2.5, "max": 4.0, "label": "Benchmark uffici: 2,5–4,0 €/mq/mese"},
    "WAREHOUSE": {"min": 0.8, "max": 1.8, "label": "Benchmark magazzini: 0,8–1,8 €/mq/mese"},
    "STORAGE":   {"min": 0.4, "max": 1.0, "label": "Benchmark depositi: 0,4–1,0 €/mq/mese"},
}

# Soglie gauge EUI per colore (verde/giallo/rosso) per categoria — Catalogo KPI § 1.4
EUI_GAUGE_THRESHOLDS = {
    "OFFICE":    {"verde": 100, "giallo": 180},
    "WAREHOUSE": {"verde": 40,  "giallo": 80},
    "STORAGE":   {"verde": 20,  "giallo": 40},
}


def _eui_class(eui_kwh_mq_anno: float, categoria: str = "OFFICE") -> str:
    thresholds = EUI_THRESHOLDS.get(categoria, EUI_THRESHOLDS["OFFICE"])
    for label, lo, hi in thresholds:
        if lo <= eui_kwh_mq_anno < hi:
            return label
    return "G"


def _eui_gauge_color(eui: float, categoria: str) -> str:
    """Restituisce il colore del gauge EUI in base alla categoria."""
    if not categoria:
        return "neutral"
    thresholds = EUI_GAUGE_THRESHOLDS.get(categoria)
    if not thresholds:
        return "neutral"
    if eui < thresholds["verde"]:
        return "green"
    elif eui < thresholds["giallo"]:
        return "yellow"
    else:
        return "red"


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

        # Dati asset (include building_category per benchmark dinamici)
        cur.execute("""
            SELECT id, nome, tipo, superficie_mq, anno_costruzione, energy_class,
                   working_hours_start, working_hours_end, working_days,
                   COALESCE(building_category, tipo_upper) AS building_category,
                   annual_energy_budget_eur
            FROM (
                SELECT *,
                       UPPER(tipo) AS tipo_upper
                FROM assets WHERE id=%s
            ) sub
        """, (asset_id,))
        asset = cur.fetchone()
        if not asset:
            raise HTTPException(status_code=404, detail="Asset non trovato")
        # Normalizza building_category: mappa tipo asset → categoria BEMS
        _tipo_map = {
            "UFFICIO": "OFFICE", "UFFICI": "OFFICE", "OFFICE": "OFFICE",
            "MAGAZZINO": "WAREHOUSE", "WAREHOUSE": "WAREHOUSE",
            "DEPOSITO": "STORAGE", "STORAGE": "STORAGE",
            "STABILIMENTO": "WAREHOUSE",
        }
        categoria = _tipo_map.get((asset.get("building_category") or "").upper(), None)

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

        # Classe calcolata vs certificata (soglie dinamiche per categoria)
        eui_class_calcolata = _eui_class(eui, categoria or "OFFICE")
        eui_class_certificata = asset["energy_class"] or None
        eui_gauge_color = _eui_gauge_color(eui, categoria)

        # CO2 equivalente mese (fattore 0.233 kg/kWh)
        co2_kg_mese = round(kwh_mese * 0.233, 1)

        # Trend vs mese precedente
        if kwh_mese_prec > 0:
            trend_pct = round(((kwh_mese - kwh_mese_prec) / kwh_mese_prec) * 100, 1)
        else:
            trend_pct = None

        # Allarmi energetici attivi per severità (E-4)
        cur.execute("""
            SELECT
                COALESCE(SUM(CASE WHEN UPPER(severity) IN ('CRITICAL','HIGH') THEN 1 ELSE 0 END), 0) AS n_critical,
                COALESCE(SUM(CASE WHEN UPPER(severity) IN ('MEDIUM','WARNING') THEN 1 ELSE 0 END), 0) AS n_medium,
                COALESCE(SUM(CASE WHEN UPPER(severity) IN ('LOW','INFO') THEN 1 ELSE 0 END), 0) AS n_low,
                COUNT(*) AS n_totale
            FROM energy_alarms
            WHERE asset_id=%s AND acknowledged = FALSE
        """, (asset_id,))
        allarmi_row = cur.fetchone()
        n_allarmi_critical = int(allarmi_row["n_critical"] or 0)
        n_allarmi_medium   = int(allarmi_row["n_medium"] or 0)
        n_allarmi_low      = int(allarmi_row["n_low"] or 0)
        n_allarmi          = int(allarmi_row["n_totale"] or 0)

        # Benchmark €/mq per categoria (E-2)
        benchmark_eur_mq = EUI_BENCHMARK_EUR_MQ.get(categoria) if categoria else None

        # Budget annuale (P-10 / E-1)
        budget_annuale = float(asset.get("annual_energy_budget_eur") or 0) or None

        return {
            "asset_id": asset_id,
            "asset_nome": asset["nome"],
            "superficie_mq": superficie,
            "anno_costruzione": asset["anno_costruzione"],
            "building_category": categoria,
            "energy_class_certificata": eui_class_certificata,
            "energy_class_calcolata": eui_class_calcolata,
            "eui_gauge_color": eui_gauge_color,
            "working_hours_start": str(asset["working_hours_start"] or "08:00"),
            "working_hours_end":   str(asset["working_hours_end"]   or "19:00"),
            "working_days": asset["working_days"] or "MON,TUE,WED,THU,FRI",
            # E-1: Costo energetico periodo
            "costo_mese_eur": costo_mese,
            "costo_mese_prec_eur": costo_mese_prec,
            # E-2: Costo per mq + benchmark categoria
            "costo_mq_eur": round(costo_mese / superficie, 3),
            "benchmark_eur_mq": benchmark_eur_mq,
            # E-3: EUI con soglie dinamiche per categoria
            "eui_kwh_mq_anno": eui,
            "eui_gauge_thresholds": EUI_GAUGE_THRESHOLDS.get(categoria) if categoria else None,
            # E-4: Allarmi energetici per severità
            "allarmi_energetici_attivi": n_allarmi,
            "allarmi_critical": n_allarmi_critical,
            "allarmi_medium": n_allarmi_medium,
            "allarmi_low": n_allarmi_low,
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
            "budget_annuale_eur": budget_annuale,
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

    # ── E-6: Costo energetico per persona-ora ────────────────────────────────
    @app.get("/api/efficiency/{asset_id}/kpi_e6", tags=["efficiency"])
    def get_kpi_e6(asset_id: int,
                   giorni: int = 30,
                   _=Depends(get_utente_corrente),
                   db=Depends(get_db)):
        """Costo energetico per persona-ora nel periodo.
        Formula: costo_totale_eur / Σ(presenti × ore_slot).
        Restituisce {costo_persona_ora, costo_totale_eur, persona_ore_totali, giorni, trend_pct}."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(days=giorni)
        ts_prev  = ts_from - timedelta(days=giorni)
        unit_cost = _get_unit_cost(cur, asset_id, "ELECTRICITY")

        def _calc(ts_start, ts_end):
            # Costo energetico nel periodo
            cur.execute("""
                SELECT COALESCE(SUM(kwh),0) AS kwh_tot
                FROM (
                    SELECT AVG(t.power_kw) * 24.0 AS kwh
                    FROM telemetry t
                    JOIN plants p ON p.plant_id = t.plant_id AND p.asset_id = t.asset_id
                    WHERE t.asset_id = %s AND t.ts >= %s AND t.ts < %s
                      AND p.tipo NOT IN ('contatore') AND t.power_kw IS NOT NULL
                    GROUP BY DATE(t.ts AT TIME ZONE 'Europe/Rome')
                ) sub
            """, (asset_id, ts_start, ts_end))
            kwh_tot = float(cur.fetchone()["kwh_tot"] or 0)
            costo = round(kwh_tot * unit_cost, 2)

            # Persona-ore: ogni snapshot è un'istantanea (assumiamo slot di 15 min = 0.25h)
            cur.execute("""
                SELECT COALESCE(SUM(presenti) * 0.25, 0) AS persona_ore
                FROM occupancy_snapshot
                WHERE asset_id = %s AND ts >= %s AND ts < %s
            """, (asset_id, ts_start, ts_end))
            persona_ore = float(cur.fetchone()["persona_ore"] or 0)
            return costo, persona_ore

        costo_cur, po_cur   = _calc(ts_from, now)
        costo_prev, po_prev = _calc(ts_prev, ts_from)

        costo_ph_cur  = round(costo_cur  / po_cur,  4) if po_cur  > 0 else None
        costo_ph_prev = round(costo_prev / po_prev, 4) if po_prev > 0 else None

        trend_pct = None
        if costo_ph_cur is not None and costo_ph_prev and costo_ph_prev > 0:
            trend_pct = round((costo_ph_cur - costo_ph_prev) / costo_ph_prev * 100, 1)

        return {
            "costo_persona_ora": costo_ph_cur,
            "costo_totale_eur": round(costo_cur, 2),
            "persona_ore_totali": round(po_cur, 1),
            "giorni": giorni,
            "trend_pct": trend_pct,
            "disponibile": po_cur > 0,
        }

    # ── E-12: Correlazione occupancy vs costo ────────────────────────────────
    @app.get("/api/efficiency/{asset_id}/occupancy", tags=["efficiency"])
    def get_occupancy_vs_cost(asset_id: int,
                              giorni: int = 14,
                              _=Depends(get_utente_corrente),
                              db=Depends(get_db)):
        """
        Correlazione giornaliera tra occupancy media (in orario lavorativo) e consumo energetico h24.
        Occupancy = AVG(SUM persone_presenti per campione) / capacita_totale × 100,
        calcolata solo sui campioni nell'orario lavorativo dell'asset.
        Energia = kWh h24 (corretto: l'energia si consuma anche fuori orario).
        Restituisce lista di {data, occ_pct_media, kwh, costo_eur, wh_start, wh_end}.
        """
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        ts_from = now - timedelta(days=giorni)
        unit_cost = _get_unit_cost(cur, asset_id, "ELECTRICITY")

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

        # 3. Occupancy media giornaliera in orario lavorativo da telemetry.persone_presenti
        cur.execute("""
            SELECT
                DATE(ts AT TIME ZONE 'Europe/Rome') AS giorno,
                ROUND(AVG(campione_persone) / %s * 100.0, 1) AS occ_pct
            FROM (
                SELECT
                    ts,
                    SUM(COALESCE(persone_presenti, 0)) AS campione_persone
                FROM telemetry
                WHERE asset_id = %s
                  AND ts >= %s
                  AND zone_id IS NOT NULL
                  AND EXTRACT(HOUR FROM ts AT TIME ZONE 'Europe/Rome') >= %s
                  AND EXTRACT(HOUR FROM ts AT TIME ZONE 'Europe/Rome') <  %s
                GROUP BY ts
            ) sub
            GROUP BY giorno
            ORDER BY giorno
        """, (cap_tot, asset_id, ts_from, wh_start, wh_end))
        occ_rows = {str(r["giorno"]): float(r["occ_pct"] or 0) for r in cur.fetchall()}

        # 4. Consumo giornaliero h24 da telemetria (corretto: energia h24)
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

        # 5. Unisci per data
        all_dates = sorted(set(list(occ_rows.keys()) + list(energy_rows.keys())))
        result = []
        for d in all_dates:
            kw_medio = energy_rows.get(d, 0)
            kwh = round(kw_medio * 24, 1)
            result.append({
                "data":          d,
                "occ_pct_media": round(occ_rows.get(d, 0), 1),
                "kwh":           kwh,
                "costo_eur":     round(kwh * unit_cost, 2),
                "wh_start":      wh_start,
                "wh_end":        wh_end,
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

        cur.execute("""
            SELECT id, nome, tipo, superficie_mq, energy_class,
                   COALESCE(building_category, UPPER(tipo)) AS building_category,
                   annual_energy_budget_eur
            FROM assets WHERE stato='attivo'
        """)
        assets = cur.fetchall()

        # Mapping tipo → categoria BEMS
        _tipo_map = {
            "UFFICIO": "OFFICE", "UFFICI": "OFFICE", "OFFICE": "OFFICE",
            "MAGAZZINO": "WAREHOUSE", "WAREHOUSE": "WAREHOUSE",
            "DEPOSITO": "STORAGE", "STORAGE": "STORAGE",
            "STABILIMENTO": "WAREHOUSE",
        }

        totale_kwh_mese = 0.0
        totale_costo_mese = 0.0
        totale_co2_mese = 0.0
        totale_kwh_mese_prec = 0.0
        totale_kwh_anno = 0.0
        eui_list = []
        asset_ranking = []

        # Anomalie totali portafoglio per severità (P-3)
        cur.execute("""
            SELECT
                COALESCE(SUM(CASE WHEN UPPER(severity) IN ('CRITICAL','HIGH') THEN 1 ELSE 0 END), 0) AS n_critical,
                COALESCE(SUM(CASE WHEN UPPER(severity) IN ('MEDIUM','WARNING') THEN 1 ELSE 0 END), 0) AS n_medium,
                COALESCE(SUM(CASE WHEN UPPER(severity) IN ('LOW','INFO') THEN 1 ELSE 0 END), 0) AS n_low,
                COUNT(*) AS n_totale
            FROM energy_alarms
            WHERE acknowledged = FALSE
        """)
        allarmi_portfolio = cur.fetchone()

        # Top 3 asset per numero di anomalie (P-3)
        cur.execute("""
            SELECT a.id, a.nome, COUNT(al.id) AS n_allarmi
            FROM energy_alarms al
            JOIN assets a ON a.id = al.asset_id
            WHERE al.acknowledged = FALSE
            GROUP BY a.id, a.nome
            ORDER BY n_allarmi DESC
            LIMIT 3
        """)
        top_asset_anomalie = [{"asset_id": r["id"], "nome": r["nome"], "n_allarmi": r["n_allarmi"]} for r in cur.fetchall()]

        for a in assets:
            asset_id = a["id"]
            superficie = a["superficie_mq"] or 1
            unit_cost = _get_unit_cost(cur, asset_id, "ELECTRICITY")
            use_telemetry = _telemetry_available(cur, asset_id)
            categoria = _tipo_map.get((a.get("building_category") or "").upper(), None)

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

            # EUI annualizzato con soglie dinamiche per categoria
            giorni_anno = max((now - anno_start).days, 1)
            kwh_anno_proiettato = kwh_anno * (365 / giorni_anno)
            eui = round(kwh_anno_proiettato / superficie, 1)
            eui_class = _eui_class(eui, categoria or "OFFICE")
            eui_list.append((eui, superficie, categoria))

            # I totali KPI aggregano solo asset con telemetria reale
            # (gli asset con energy_readings sintetici distorcerebbero i KPI)
            if use_telemetry:
                totale_kwh_mese      += kwh_mese
                totale_costo_mese    += costo_mese
                totale_co2_mese      += co2_mese
                totale_kwh_mese_prec += kwh_mese_prec
                totale_kwh_anno      += kwh_anno

            asset_ranking.append({
                "asset_id": asset_id,
                "nome": a["nome"],
                "tipo": a["tipo"],
                "categoria": categoria,
                "superficie_mq": superficie,
                "kwh_mese": round(kwh_mese, 1),
                "costo_mese_eur": costo_mese,
                "eui": eui,
                "eui_class": eui_class,
                "eui_gauge_color": _eui_gauge_color(eui, categoria),
                "energy_class_certificata": a["energy_class"],
                "has_telemetry": use_telemetry,
            })

        # Ordina per EUI decrescente (peggiori in cima)
        asset_ranking.sort(key=lambda x: x["eui"], reverse=True)

        # Trend portafoglio
        trend_pct = None
        if totale_kwh_mese_prec > 0:
            trend_pct = round(((totale_kwh_mese - totale_kwh_mese_prec) / totale_kwh_mese_prec) * 100, 1)

        # EUI medio globale (media ponderata per superficie) — P-2
        if eui_list:
            tot_sup = sum(sup for _, sup, _ in eui_list)
            eui_medio = round(sum(e * sup for e, sup, _ in eui_list) / tot_sup, 1) if tot_sup > 0 else 0.0
        else:
            eui_medio = 0.0

        # EUI medio per categoria (P-2 mini-tabella)
        eui_per_categoria = {}
        for eui_val, sup, cat in eui_list:
            if cat:
                if cat not in eui_per_categoria:
                    eui_per_categoria[cat] = {"sum_eui_sup": 0.0, "sum_sup": 0.0}
                eui_per_categoria[cat]["sum_eui_sup"] += eui_val * sup
                eui_per_categoria[cat]["sum_sup"] += sup
        eui_medio_per_categoria = {
            cat: round(v["sum_eui_sup"] / v["sum_sup"], 1)
            for cat, v in eui_per_categoria.items() if v["sum_sup"] > 0
        }

        # Top 3 efficienti e meno efficienti per categoria (P-4, P-5)
        ranking_per_categoria = {}
        for r in asset_ranking:
            cat = r["categoria"] or "ALTRO"
            if cat not in ranking_per_categoria:
                ranking_per_categoria[cat] = []
            ranking_per_categoria[cat].append(r)
        # Ogni categoria è già ordinata per EUI decrescente (peggiori in cima)
        top3_efficienti_per_cat = {
            cat: sorted(items, key=lambda x: x["eui"])[:3]
            for cat, items in ranking_per_categoria.items()
        }
        top3_inefficienti_per_cat = {
            cat: sorted(items, key=lambda x: x["eui"], reverse=True)[:3]
            for cat, items in ranking_per_categoria.items()
        }

        return {
            # P-1: Consumo totale portafoglio (solo asset con telemetria reale)
            "kwh_mese_totale": round(totale_kwh_mese, 1),
            "kwh_anno_totale": round(totale_kwh_anno, 1),
            # P-1: Costo totale
            "costo_mese_eur": round(totale_costo_mese, 2),
            # CO2 totale
            "co2_kg_mese": round(totale_co2_mese, 1),
            # P-2: EUI medio portafoglio (media ponderata per superficie)
            "eui_medio": eui_medio,
            "eui_medio_per_categoria": eui_medio_per_categoria,
            # P-3: Anomalie totali per severità
            "allarmi_critical": int(allarmi_portfolio["n_critical"] or 0),
            "allarmi_medium":   int(allarmi_portfolio["n_medium"] or 0),
            "allarmi_low":      int(allarmi_portfolio["n_low"] or 0),
            "allarmi_totale":   int(allarmi_portfolio["n_totale"] or 0),
            "top_asset_anomalie": top_asset_anomalie,
            # P-4/P-5: Top 3 efficienti/inefficienti per categoria
            "top3_efficienti_per_categoria": top3_efficienti_per_cat,
            "top3_inefficienti_per_categoria": top3_inefficienti_per_cat,
            # Trend
            "trend_vs_mese_prec_pct": trend_pct,
            # Asset attivi
            "n_asset_attivi": len(assets),
            "n_asset_telemetria": sum(1 for a in asset_ranking if a["has_telemetry"]),
            # P-6: Ranking completo asset per EUI (per benchmark interno)
            "ranking_asset": asset_ranking,
            # Retrocompatibilità frontend esistente
            "asset_migliore": asset_ranking[-1] if asset_ranking else None,
            "asset_peggiore": asset_ranking[0] if asset_ranking else None,
        }

    # ── P-7: Consumi per giorno della settimana — Media Portafoglio ───────────
    @app.get("/api/efficiency/portfolio/weekday", tags=["efficiency"])
    def get_portfolio_weekday(_=Depends(get_utente_corrente), db=Depends(get_db)):
        """P-7: Media kWh/mq per giorno della settimana aggregata su tutti gli asset.
        Richiede almeno 4 settimane di dati e gross_floor_area_sqm."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        quattro_sett = now - timedelta(weeks=4)

        # Telemetria: media kWh per giorno settimana per asset con telemetria
        cur.execute("""
            SELECT
                EXTRACT(DOW FROM t.ts AT TIME ZONE 'Europe/Rome') AS dow,
                DATE_TRUNC('day', t.ts AT TIME ZONE 'Europe/Rome') AS giorno,
                SUM(t.power_kw) * 0.25 AS kwh_giorno,
                a.superficie_mq
            FROM telemetry t
            JOIN plants p ON p.plant_id = t.plant_id AND p.asset_id = t.asset_id
            JOIN assets a ON a.id = t.asset_id
            WHERE t.ts >= %s AND t.ts <= %s
              AND p.tipo NOT IN ('contatore')
              AND a.superficie_mq > 0
            GROUP BY dow, giorno, a.superficie_mq
        """, (quattro_sett, now))
        rows = cur.fetchall()

        if not rows:
            return {"data": [], "message": "Dati insufficienti (richiede almeno 4 settimane)"}

        # Aggrega per giorno settimana: media kWh/mq
        from collections import defaultdict
        dow_data = defaultdict(list)
        for r in rows:
            dow = int(r["dow"])  # 0=domenica, 1=lunedì, ..., 6=sabato
            sup = float(r["superficie_mq"] or 1)
            kwh = float(r["kwh_giorno"] or 0)
            dow_data[dow].append(kwh / sup)

        # Mappa PostgreSQL DOW (0=dom) → etichette italiane (0=lun)
        dow_labels = {1: "Lun", 2: "Mar", 3: "Mer", 4: "Gio", 5: "Ven", 6: "Sab", 0: "Dom"}
        dow_order  = [1, 2, 3, 4, 5, 6, 0]  # Lun→Dom

        result = []
        all_vals = []
        for dow in dow_order:
            vals = dow_data.get(dow, [])
            media = round(sum(vals) / len(vals), 4) if vals else 0.0
            all_vals.append(media)
            result.append({
                "dow": dow,
                "label": dow_labels[dow],
                "kwh_mq_medio": media,
                "is_weekend": dow in (6, 0),
            })

        media_globale = round(sum(all_vals) / len(all_vals), 4) if all_vals else 0.0
        return {"data": result, "media_globale": media_globale}


    # ── P-8: Trend Mensile Portafoglio Anno su Anno ───────────────────────────
    @app.get("/api/efficiency/portfolio/trend_yoy", tags=["efficiency"])
    def get_portfolio_trend_yoy(mesi: int = 24,
                                _=Depends(get_utente_corrente),
                                db=Depends(get_db)):
        """P-8: Consumo mensile totale portafoglio (kWh e €) per gli ultimi N mesi.
        Supporta confronto anno su anno per Grouped Bar Chart."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)

        # Genera lista mesi da coprire
        mesi_list = []
        for i in range(mesi - 1, -1, -1):
            d = now.replace(day=1) - timedelta(days=1)
            for _ in range(i):
                d = d.replace(day=1) - timedelta(days=1)
            mesi_list.append(d.replace(day=1, hour=0, minute=0, second=0, microsecond=0))

        # Usa date_trunc per aggregare per mese
        data_inizio = now.replace(day=1) - timedelta(days=mesi * 31)

        # Telemetria (asset con IoT)
        cur.execute("""
            SELECT
                DATE_TRUNC('month', t.ts AT TIME ZONE 'Europe/Rome') AS mese,
                SUM(t.power_kw) * 0.25 AS kwh
            FROM telemetry t
            JOIN plants p ON p.plant_id = t.plant_id AND p.asset_id = t.asset_id
            WHERE t.ts >= %s AND t.ts <= %s
              AND p.tipo NOT IN ('contatore') AND t.power_kw IS NOT NULL
            GROUP BY mese
            ORDER BY mese
        """, (data_inizio, now))
        telem_rows = {str(r["mese"])[:7]: float(r["kwh"] or 0) for r in cur.fetchall()}

        # Energy readings (asset senza IoT)
        cur.execute("""
            SELECT
                DATE_TRUNC('month', r.ts AT TIME ZONE 'Europe/Rome') AS mese,
                SUM(r.valore) AS kwh
            FROM energy_readings r
            JOIN energy_meters m ON m.id = r.meter_id
            WHERE r.ts >= %s AND r.ts <= %s AND m.tipo = 'elettrico'
            GROUP BY mese
            ORDER BY mese
        """, (data_inizio, now))
        readings_rows = {str(r["mese"])[:7]: float(r["kwh"] or 0) for r in cur.fetchall()}

        # Costo medio portafoglio (approssimazione con default 0.285 €/kWh)
        unit_cost = 0.285

        result = []
        for ms in mesi_list:
            key = str(ms)[:7]
            kwh = (telem_rows.get(key, 0) + readings_rows.get(key, 0))
            result.append({
                "mese": key,
                "anno": ms.year,
                "mese_num": ms.month,
                "kwh": round(kwh, 1),
                "costo_eur": round(kwh * unit_cost, 2),
            })

        return {"data": result, "mesi": mesi}


    # ── P-9: Decomposizione Costo Portafoglio per Commodity ──────────────────
    @app.get("/api/efficiency/portfolio/commodity", tags=["efficiency"])
    def get_portfolio_commodity(mesi: int = 12,
                                _=Depends(get_utente_corrente),
                                db=Depends(get_db)):
        """P-9: Costo mensile totale portafoglio scomposto per commodity.
        Fonte primaria: tabella invoices.commodity.
        Commodity supportate: ELECTRICITY, GAS_METHANE, GAS_GPL, WATER, FUEL, OTHER."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        data_inizio = now.replace(day=1) - timedelta(days=mesi * 31)

        # Tutte le commodity possibili — codici allineati al frontend COMMODITY_META
        COMMODITY_DEF = [
            {"key": "ELECTRICITY",  "label": "Elettricità",           "unit": "kWh",   "color": "#00A3E0", "icon": "fa-bolt"},
            {"key": "GAS_METHANE",  "label": "Gas Metano",             "unit": "Smc",   "color": "#F39C12", "icon": "fa-fire"},
            {"key": "GAS_GPL",      "label": "GPL",                    "unit": "kg",    "color": "#E67E22", "icon": "fa-fire-alt"},
            {"key": "WATER",        "label": "Acqua",                  "unit": "m³",    "color": "#3498DB", "icon": "fa-tint"},
            {"key": "HEATING_OIL",  "label": "Gasolio riscaldamento",  "unit": "litri", "color": "#8E44AD", "icon": "fa-oil-can"},
            {"key": "DIESEL",       "label": "Gasolio autotrazione",   "unit": "litri", "color": "#7F8C8D", "icon": "fa-gas-pump"},
            {"key": "PETROL",       "label": "Benzina",                "unit": "litri", "color": "#27AE60", "icon": "fa-gas-pump"},
        ]

        # 1. Dati da invoices (fonte primaria — bollette reali)
        cur.execute("""
            SELECT
                commodity,
                DATE_TRUNC('month', issue_date) AS mese,
                SUM(total_amount_eur) AS totale_eur,
                SUM(consumption_quantity) AS quantita
            FROM invoices
            WHERE issue_date >= %s AND issue_date <= %s
              AND extraction_status IN ('ok','manual','validated')
            GROUP BY commodity, mese
            ORDER BY mese, commodity
        """, (data_inizio.date(), now.date()))
        invoice_rows = cur.fetchall()

        # 2. Fallback elettricità da telemetria (se non ci sono bollette elettriche)
        has_elec_invoices = any(r["commodity"] == "ELECTRICITY" for r in invoice_rows)
        elec_telem = {}
        if not has_elec_invoices:
            cur.execute("""
                SELECT DATE_TRUNC('month', t.ts AT TIME ZONE 'Europe/Rome') AS mese,
                       SUM(t.power_kw) * 0.25 AS kwh
                FROM telemetry t
                JOIN plants p ON p.plant_id = t.plant_id AND p.asset_id = t.asset_id
                WHERE t.ts >= %s AND t.ts <= %s
                  AND p.tipo NOT IN ('contatore') AND t.power_kw IS NOT NULL
                GROUP BY mese ORDER BY mese
            """, (data_inizio, now))
            cost_elec = 0.285
            for r in cur.fetchall():
                key = str(r["mese"])[:7]
                kwh = float(r["kwh"] or 0)
                elec_telem[key] = elec_telem.get(key, 0) + kwh * cost_elec

        # Costruisci dizionario {commodity: {mese_key: eur}}
        comm_data = {c["key"]: {} for c in COMMODITY_DEF}
        for r in invoice_rows:
            comm = r["commodity"] or "OTHER"
            if comm not in comm_data:
                comm_data[comm] = {}
            key = str(r["mese"])[:7]
            comm_data[comm][key] = comm_data[comm].get(key, 0) + float(r["totale_eur"] or 0)
        # Aggiungi fallback elettricità da telemetria
        for key, eur in elec_telem.items():
            comm_data["ELECTRICITY"][key] = comm_data["ELECTRICITY"].get(key, 0) + eur

        # Costruisci serie mensile
        result = []
        for i in range(mesi - 1, -1, -1):
            d = now.replace(day=1)
            for _ in range(i):
                d = (d - timedelta(days=1)).replace(day=1)
            key = str(d)[:7]
            row = {"mese": key, "mese_num": d.month, "anno": d.year}
            totale = 0.0
            for c in COMMODITY_DEF:
                eur = round(comm_data.get(c["key"], {}).get(key, 0), 2)
                row[c["key"].lower() + "_eur"] = eur
                totale += eur
            row["totale_eur"] = round(totale, 2)
            result.append(row)

        # Commodity presenti (con almeno un valore > 0)
        commodity_presenti = [
            c for c in COMMODITY_DEF
            if any(row.get(c["key"].lower() + "_eur", 0) > 0 for row in result)
        ]

        return {
            "data": result,
            "mesi": mesi,
            "commodity_def": COMMODITY_DEF,
            "commodity_presenti": [c["key"] for c in commodity_presenti]
        }


    # ── P-10: Costo Cumulato vs Budget Annuale Portafoglio ────────────────────
    @app.get("/api/efficiency/portfolio/budget", tags=["efficiency"])
    def get_portfolio_budget(_=Depends(get_utente_corrente), db=Depends(get_db)):
        """P-10: Costo energetico cumulato dall'inizio dell'anno vs budget annuale totale.
        Restituisce serie mensile per grafico a linee cumulato."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        anno_start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)

        # Budget totale portafoglio
        cur.execute("SELECT COALESCE(SUM(annual_energy_budget_eur), 0) AS budget FROM assets WHERE stato='attivo'")
        budget_totale = float(cur.fetchone()["budget"] or 0)

        # Costo mensile anno corrente (telemetria + readings)
        cur.execute("""
            SELECT DATE_TRUNC('month', t.ts AT TIME ZONE 'Europe/Rome') AS mese,
                   SUM(t.power_kw) * 0.25 * 0.285 AS costo_eur
            FROM telemetry t
            JOIN plants p ON p.plant_id = t.plant_id AND p.asset_id = t.asset_id
            WHERE t.ts >= %s AND t.ts <= %s
              AND p.tipo NOT IN ('contatore') AND t.power_kw IS NOT NULL
            GROUP BY mese ORDER BY mese
        """, (anno_start, now))
        telem_costi = {str(r["mese"])[:7]: float(r["costo_eur"] or 0) for r in cur.fetchall()}

        cur.execute("""
            SELECT DATE_TRUNC('month', r.ts AT TIME ZONE 'Europe/Rome') AS mese,
                   SUM(r.valore) * 0.285 AS costo_eur
            FROM energy_readings r JOIN energy_meters m ON m.id = r.meter_id
            WHERE r.ts >= %s AND r.ts <= %s AND m.tipo = 'elettrico'
            GROUP BY mese ORDER BY mese
        """, (anno_start, now))
        readings_costi = {str(r["mese"])[:7]: float(r["costo_eur"] or 0) for r in cur.fetchall()}

        # Costruisce serie cumulata mese per mese
        result = []
        cumulato = 0.0
        mese_corrente = anno_start
        while mese_corrente <= now:
            key = str(mese_corrente)[:7]
            costo_mese = (telem_costi.get(key, 0) + readings_costi.get(key, 0))
            cumulato += costo_mese
            mesi_trascorsi = mese_corrente.month
            budget_lineare = (budget_totale / 12) * mesi_trascorsi if budget_totale > 0 else None
            result.append({
                "mese": key,
                "costo_mese_eur": round(costo_mese, 2),
                "costo_cumulato_eur": round(cumulato, 2),
                "budget_lineare_eur": round(budget_lineare, 2) if budget_lineare else None,
                "delta_vs_budget": round(cumulato - budget_lineare, 2) if budget_lineare else None,
            })
            # Avanza al mese successivo
            if mese_corrente.month == 12:
                mese_corrente = mese_corrente.replace(year=mese_corrente.year + 1, month=1)
            else:
                mese_corrente = mese_corrente.replace(month=mese_corrente.month + 1)

        return {
            "data": result,
            "budget_totale_eur": round(budget_totale, 2),
            "costo_cumulato_ytd": round(cumulato, 2),
            "delta_vs_budget": round(cumulato - budget_totale * (now.month / 12), 2) if budget_totale > 0 else None,
            "has_budget": budget_totale > 0,
        }


    # ── E-11: kWh HVAC vs Temperatura Esterna ────────────────────────────────
    @app.get("/api/efficiency/{asset_id}/hvac_vs_temp", tags=["efficiency"])
    def get_hvac_vs_temp(asset_id: int,
                         giorni: int = 90,
                         _=Depends(get_utente_corrente),
                         db=Depends(get_db)):
        """E-11: Scatter plot kWh HVAC giornaliero vs temperatura esterna.
        Temperatura esterna: usa sensore esterno da telemetria (tipo='meteo')
        oppure stima sintetica stagionale se non disponibile."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        data_inizio = now - timedelta(days=giorni)

        # kWh HVAC giornaliero da telemetria
        cur.execute("""
            SELECT
                DATE_TRUNC('day', t.ts AT TIME ZONE 'Europe/Rome') AS giorno,
                SUM(t.power_kw) * 0.25 AS kwh_hvac
            FROM telemetry t
            JOIN plants p ON p.plant_id = t.plant_id AND p.asset_id = t.asset_id
            WHERE t.asset_id = %s AND t.ts >= %s AND t.ts <= %s
              AND p.tipo = 'hvac' AND t.power_kw IS NOT NULL
            GROUP BY giorno ORDER BY giorno
        """, (asset_id, data_inizio, now))
        hvac_rows = {str(r["giorno"])[:10]: float(r["kwh_hvac"] or 0) for r in cur.fetchall()}

        if not hvac_rows:
            return {"data": [], "message": "Dati HVAC non disponibili per questo asset"}

        # Temperatura esterna: cerca in telemetria (sensore tipo='meteo' o campo temp_c)
        cur.execute("""
            SELECT
                DATE_TRUNC('day', t.ts AT TIME ZONE 'Europe/Rome') AS giorno,
                AVG(t.temp_c) AS temp_media
            FROM telemetry t
            WHERE t.asset_id = %s AND t.ts >= %s AND t.ts <= %s
              AND t.temp_c IS NOT NULL
            GROUP BY giorno ORDER BY giorno
        """, (asset_id, data_inizio, now))
        temp_rows = {str(r["giorno"])[:10]: float(r["temp_media"]) for r in cur.fetchall() if r["temp_media"] is not None}

        # Se non ci sono dati temperatura reali, usa stima stagionale sintetica per Roma
        import math
        def _temp_sintetica(data_str: str) -> float:
            """Temperatura media giornaliera stimata per Roma (lat 41.9°N)."""
            from datetime import date as date_type
            d = date_type.fromisoformat(data_str)
            day_of_year = d.timetuple().tm_yday
            # Formula sinusoidale: Tmin=5°C gen, Tmax=30°C lug
            return round(17.5 + 12.5 * math.sin(2 * math.pi * (day_of_year - 80) / 365), 1)

        result = []
        for giorno_str, kwh in sorted(hvac_rows.items()):
            temp = temp_rows.get(giorno_str)
            temp_source = "reale"
            if temp is None:
                temp = _temp_sintetica(giorno_str)
                temp_source = "stimata"
            # Stagione per colore punto
            mese = int(giorno_str[5:7])
            if mese in (12, 1, 2):
                stagione = "inverno"
            elif mese in (6, 7, 8):
                stagione = "estate"
            else:
                stagione = "mezza_stagione"
            result.append({
                "data": giorno_str,
                "kwh_hvac": round(kwh, 2),
                "temp_c": temp,
                "temp_source": temp_source,
                "stagione": stagione,
            })

        # Regressione lineare semplice
        if len(result) >= 3:
            xs = [r["temp_c"] for r in result]
            ys = [r["kwh_hvac"] for r in result]
            n = len(xs)
            mx, my = sum(xs)/n, sum(ys)/n
            num = sum((x-mx)*(y-my) for x,y in zip(xs,ys))
            den = sum((x-mx)**2 for x in xs)
            slope = num/den if den != 0 else 0
            intercept = my - slope * mx
            # R²
            ss_res = sum((y - (slope*x + intercept))**2 for x,y in zip(xs,ys))
            ss_tot = sum((y - my)**2 for y in ys)
            r2 = round(1 - ss_res/ss_tot, 3) if ss_tot > 0 else 0
            regressione = {"slope": round(slope, 4), "intercept": round(intercept, 4), "r2": r2}
        else:
            regressione = None

        return {
            "data": result,
            "regressione": regressione,
            "giorni": giorni,
            "has_temp_reale": bool(temp_rows),
        }


    # ── E-14: Decomposizione Costo Mensile per Commodity (singolo asset) ──────
    @app.get("/api/efficiency/{asset_id}/commodity", tags=["efficiency"])
    def get_asset_commodity(asset_id: int,
                            mesi: int = 12,
                            _=Depends(get_utente_corrente),
                            db=Depends(get_db)):
        """E-14: Costo mensile scomposto per commodity per singolo asset.
        Fonte primaria: invoices. Fallback elettricità da telemetria/energy_readings."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc)
        data_inizio = now.replace(day=1) - timedelta(days=mesi * 31)

        # Stessa definizione commodity del portfolio
        COMMODITY_DEF = [
            {"key": "ELECTRICITY",  "label": "Elettricità",           "unit": "kWh",   "color": "#00A3E0"},
            {"key": "GAS_METHANE",  "label": "Gas Metano",             "unit": "Smc",   "color": "#F39C12"},
            {"key": "GAS_GPL",      "label": "GPL",                    "unit": "kg",    "color": "#E67E22"},
            {"key": "WATER",        "label": "Acqua",                  "unit": "m³",    "color": "#3498DB"},
            {"key": "HEATING_OIL",  "label": "Gasolio riscaldamento",  "unit": "litri", "color": "#8E44AD"},
            {"key": "DIESEL",       "label": "Gasolio autotrazione",   "unit": "litri", "color": "#7F8C8D"},
            {"key": "PETROL",       "label": "Benzina",                "unit": "litri", "color": "#27AE60"},
        ]

        # 1. Dati da invoices (fonte primaria)
        cur.execute("""
            SELECT commodity,
                   DATE_TRUNC('month', issue_date) AS mese,
                   SUM(total_amount_eur) AS totale_eur
            FROM invoices
            WHERE asset_id = %s AND issue_date >= %s AND issue_date <= %s
              AND extraction_status IN ('ok','manual','validated')
            GROUP BY commodity, mese ORDER BY mese, commodity
        """, (asset_id, data_inizio.date(), now.date()))
        invoice_rows = cur.fetchall()

        # 2. Fallback elettricità da telemetria o energy_readings
        has_elec_invoices = any(r["commodity"] == "ELECTRICITY" for r in invoice_rows)
        elec_fallback = {}
        use_telemetry = _telemetry_available(cur, asset_id)
        if not has_elec_invoices:
            unit_cost_elec = _get_unit_cost(cur, asset_id, "ELECTRICITY")
            if use_telemetry:
                cur.execute("""
                    SELECT DATE_TRUNC('month', t.ts AT TIME ZONE 'Europe/Rome') AS mese,
                           SUM(t.power_kw) * 0.25 AS kwh
                    FROM telemetry t
                    JOIN plants p ON p.plant_id = t.plant_id AND p.asset_id = t.asset_id
                    WHERE t.asset_id = %s AND t.ts >= %s AND t.ts <= %s
                      AND p.tipo NOT IN ('contatore') AND t.power_kw IS NOT NULL
                    GROUP BY mese ORDER BY mese
                """, (asset_id, data_inizio, now))
            else:
                cur.execute("""
                    SELECT DATE_TRUNC('month', r.ts AT TIME ZONE 'Europe/Rome') AS mese,
                           SUM(r.valore) AS kwh
                    FROM energy_readings r JOIN energy_meters m ON m.id = r.meter_id
                    WHERE r.asset_id = %s AND r.ts >= %s AND r.ts <= %s AND m.tipo = 'elettrico'
                    GROUP BY mese ORDER BY mese
                """, (asset_id, data_inizio, now))
            for r in cur.fetchall():
                key = str(r["mese"])[:7]
                elec_fallback[key] = float(r.get("kwh", 0) or 0) * unit_cost_elec

        # Costruisci dizionario {commodity: {mese_key: eur}}
        comm_data = {c["key"]: {} for c in COMMODITY_DEF}
        for r in invoice_rows:
            comm = r["commodity"] or "ELECTRICITY"
            if comm not in comm_data:
                comm_data[comm] = {}
            key = str(r["mese"])[:7]
            comm_data[comm][key] = comm_data[comm].get(key, 0) + float(r["totale_eur"] or 0)
        for key, eur in elec_fallback.items():
            comm_data["ELECTRICITY"][key] = comm_data["ELECTRICITY"].get(key, 0) + eur

        result = []
        for i in range(mesi - 1, -1, -1):
            d = now.replace(day=1)
            for _ in range(i):
                d = (d - timedelta(days=1)).replace(day=1)
            key = str(d)[:7]
            row = {"mese": key, "mese_num": d.month, "anno": d.year}
            totale = 0.0
            for c in COMMODITY_DEF:
                eur = round(comm_data.get(c["key"], {}).get(key, 0), 2)
                row[c["key"].lower() + "_eur"] = eur
                totale += eur
            row["totale_eur"] = round(totale, 2)
            result.append(row)

        commodity_presenti = [
            c["key"] for c in COMMODITY_DEF
            if any(row.get(c["key"].lower() + "_eur", 0) > 0 for row in result)
        ]

        return {
            "data": result,
            "mesi": mesi,
            "has_telemetry": use_telemetry,
            "commodity_def": COMMODITY_DEF,
            "commodity_presenti": commodity_presenti
        }

    # ── E-8: Baseline Energetica Oraria per Impianto ────────────────────────
    @app.get("/api/efficiency/{asset_id}/baseline_hourly", tags=["efficiency"])
    def get_baseline_hourly(
        asset_id: int,
        ore: int = 168,
        plant_id: str = None,
        _=Depends(get_utente_corrente),
        db=Depends(get_db)
    ):
        """
        E-8 — Baseline energetica per impianto.
        Confronta il consumo orario attuale con la baseline rolling (media stessa
        fascia oraria nelle ultime 4 settimane precedenti al periodo analizzato).
        """
        cur = db.cursor()
        plant_filter = "AND t.plant_id = %(plant_id)s" if plant_id else ""

        cur.execute(f"""
            WITH periodo AS (
                SELECT
                    DATE_TRUNC('hour', ts) AS ora,
                    t.plant_id,
                    AVG(power_kw) AS avg_kw
                FROM telemetry t
                WHERE t.asset_id = %(asset_id)s
                  AND t.plant_id IS NOT NULL AND t.plant_id != ''
                  AND t.power_kw IS NOT NULL
                  AND ts >= NOW() - INTERVAL '1 hour' * %(ore)s
                  {plant_filter}
                GROUP BY 1, 2
            ),
            storico AS (
                SELECT
                    EXTRACT(DOW  FROM ts)::int AS dow,
                    EXTRACT(HOUR FROM ts)::int AS ora_h,
                    t.plant_id,
                    AVG(power_kw)    AS media,
                    STDDEV(power_kw) AS stddev
                FROM telemetry t
                WHERE t.asset_id = %(asset_id)s
                  AND t.plant_id IS NOT NULL AND t.plant_id != ''
                  AND t.power_kw IS NOT NULL
                  AND ts >= NOW() - INTERVAL '1 hour' * %(ore)s - INTERVAL '4 weeks'
                  AND ts <  NOW() - INTERVAL '1 hour' * %(ore)s + INTERVAL '1 hour'
                  {plant_filter}
                GROUP BY 1, 2, 3
            )
            SELECT
                p.ora,
                p.plant_id,
                ROUND(p.avg_kw::numeric, 3)                                        AS kwh_attuale,
                ROUND(s.media::numeric, 3)                                          AS kwh_baseline,
                ROUND(s.stddev::numeric, 3)                                         AS stddev,
                ROUND(((p.avg_kw - s.media) / NULLIF(s.media, 0) * 100)::numeric, 1) AS delta_pct
            FROM periodo p
            LEFT JOIN storico s
                ON s.dow   = EXTRACT(DOW  FROM p.ora)::int
               AND s.ora_h = EXTRACT(HOUR FROM p.ora)::int
               AND s.plant_id = p.plant_id
            ORDER BY p.plant_id, p.ora
        """, {"asset_id": asset_id, "ore": ore, "plant_id": plant_id})

        rows = cur.fetchall()
        result = []
        for r in rows:
            result.append({
                "ts":           r["ora"].isoformat() if r["ora"] else None,
                "plant_id":     r["plant_id"],
                "kwh_attuale":  float(r["kwh_attuale"]) if r["kwh_attuale"] is not None else None,
                "kwh_baseline": float(r["kwh_baseline"]) if r["kwh_baseline"] is not None else None,
                "stddev":       float(r["stddev"]) if r["stddev"] is not None else None,
                "delta_pct":    float(r["delta_pct"]) if r["delta_pct"] is not None else None,
            })
        cur.close()
        return {"data": result, "ore": ore, "plant_id": plant_id}

    # ── E-10: Anomaly Detection per Impianto ─────────────────────────────────
    @app.get("/api/efficiency/{asset_id}/anomalies", tags=["efficiency"])
    def get_anomalies(
        asset_id: int,
        ore: int = 168,
        plant_id: str = None,
        z_threshold: float = 2.0,
        _=Depends(get_utente_corrente),
        db=Depends(get_db)
    ):
        """
        E-10 — Anomaly Detection per impianto.
        Rileva anomalie energetiche usando z-score rolling rispetto alla baseline
        delle ultime 4 settimane (stessa ora, stesso giorno settimana).
        """
        cur = db.cursor()
        plant_filter = "AND t.plant_id = %(plant_id)s" if plant_id else ""

        cur.execute(f"""
            WITH periodo AS (
                SELECT
                    DATE_TRUNC('hour', ts) AS ora,
                    t.plant_id,
                    AVG(power_kw) AS avg_kw
                FROM telemetry t
                WHERE t.asset_id = %(asset_id)s
                  AND t.plant_id IS NOT NULL AND t.plant_id != ''
                  AND t.power_kw IS NOT NULL
                  AND ts >= NOW() - INTERVAL '1 hour' * %(ore)s
                  {plant_filter}
                GROUP BY 1, 2
            ),
            storico AS (
                SELECT
                    EXTRACT(DOW  FROM ts)::int AS dow,
                    EXTRACT(HOUR FROM ts)::int AS ora_h,
                    t.plant_id,
                    AVG(power_kw)    AS media,
                    STDDEV(power_kw) AS stddev
                FROM telemetry t
                WHERE t.asset_id = %(asset_id)s
                  AND t.plant_id IS NOT NULL AND t.plant_id != ''
                  AND t.power_kw IS NOT NULL
                  AND ts >= NOW() - INTERVAL '1 hour' * %(ore)s - INTERVAL '4 weeks'
                  AND ts <  NOW() - INTERVAL '1 hour' * %(ore)s + INTERVAL '1 hour'
                  {plant_filter}
                GROUP BY 1, 2, 3
            ),
            scored AS (
                SELECT
                    p.ora,
                    p.plant_id,
                    p.avg_kw,
                    s.media,
                    s.stddev,
                    CASE WHEN s.stddev > 0
                         THEN ROUND(((p.avg_kw - s.media) / s.stddev)::numeric, 2)
                         ELSE 0
                    END AS z_score
                FROM periodo p
                LEFT JOIN storico s
                    ON s.dow   = EXTRACT(DOW  FROM p.ora)::int
                   AND s.ora_h = EXTRACT(HOUR FROM p.ora)::int
                   AND s.plant_id = p.plant_id
            )
            SELECT
                ora,
                plant_id,
                ROUND(avg_kw::numeric, 3)  AS kwh,
                ROUND(media::numeric, 3)   AS baseline,
                z_score,
                CASE
                    WHEN ABS(z_score) >= 3.0 THEN 'alta'
                    WHEN ABS(z_score) >= 2.5 THEN 'media'
                    WHEN ABS(z_score) >= %(z_thr)s THEN 'bassa'
                    ELSE NULL
                END AS severita,
                CASE WHEN z_score > 0 THEN 'consumo_elevato' ELSE 'consumo_basso' END AS tipo
            FROM scored
            WHERE ABS(z_score) >= %(z_thr)s
            ORDER BY plant_id, ora
        """, {"asset_id": asset_id, "ore": ore, "plant_id": plant_id, "z_thr": z_threshold})

        rows = cur.fetchall()
        anomalies = []
        for r in rows:
            anomalies.append({
                "ts":       r["ora"].isoformat() if r["ora"] else None,
                "plant_id": r["plant_id"],
                "kwh":      float(r["kwh"]) if r["kwh"] is not None else None,
                "baseline": float(r["baseline"]) if r["baseline"] is not None else None,
                "z_score":  float(r["z_score"]) if r["z_score"] is not None else None,
                "severita": r["severita"],
                "tipo":     r["tipo"],
            })

        summary = {}
        for a in anomalies:
            pid = a["plant_id"]
            if pid not in summary:
                summary[pid] = {"totale": 0, "alta": 0, "media": 0, "bassa": 0,
                                "consumo_elevato": 0, "consumo_basso": 0}
            summary[pid]["totale"] += 1
            if a["severita"]: summary[pid][a["severita"]] += 1
            if a["tipo"]:     summary[pid][a["tipo"]] += 1

        cur.close()
        return {
            "anomalies": anomalies,
            "summary":   summary,
            "totale":    len(anomalies),
            "ore":       ore,
            "z_threshold": z_threshold
        }

    # ── E-10b: Riepilogo anomalie per asset (tutti gli impianti) ─────────────
    @app.get("/api/efficiency/{asset_id}/anomalies/summary", tags=["efficiency"])
    def get_anomalies_summary(
        asset_id: int,
        giorni: int = 30,
        _=Depends(get_utente_corrente),
        db=Depends(get_db)
    ):
        """
        Riepilogo anomalie degli ultimi N giorni per tutti gli impianti dell'asset.
        Usato dalla pagina Anomaly Detection per la vista aggregata.
        """
        cur = db.cursor()
        ore = giorni * 24

        cur.execute("""
            WITH periodo AS (
                SELECT DATE_TRUNC('hour', ts) AS ora, t.plant_id, AVG(power_kw) AS avg_kw
                FROM telemetry t
                WHERE t.asset_id = %(asset_id)s
                  AND t.plant_id IS NOT NULL AND t.plant_id != ''
                  AND t.power_kw IS NOT NULL
                  AND ts >= NOW() - INTERVAL '1 hour' * %(ore)s
                GROUP BY 1, 2
            ),
            storico AS (
                SELECT
                    EXTRACT(DOW  FROM ts)::int AS dow,
                    EXTRACT(HOUR FROM ts)::int AS ora_h,
                    t.plant_id,
                    AVG(power_kw) AS media, STDDEV(power_kw) AS stddev
                FROM telemetry t
                WHERE t.asset_id = %(asset_id)s
                  AND t.plant_id IS NOT NULL AND t.plant_id != ''
                  AND t.power_kw IS NOT NULL
                  AND ts >= NOW() - INTERVAL '1 hour' * %(ore)s - INTERVAL '4 weeks'
                  AND ts <  NOW() - INTERVAL '1 hour' * %(ore)s + INTERVAL '1 hour'
                GROUP BY 1, 2, 3
            ),
            scored AS (
                SELECT p.ora, p.plant_id, p.avg_kw, s.media, s.stddev,
                    CASE WHEN s.stddev > 0
                         THEN (p.avg_kw - s.media) / s.stddev ELSE 0
                    END AS z_score
                FROM periodo p
                LEFT JOIN storico s
                    ON s.dow   = EXTRACT(DOW  FROM p.ora)::int
                   AND s.ora_h = EXTRACT(HOUR FROM p.ora)::int
                   AND s.plant_id = p.plant_id
            ),
            anomalie AS (
                SELECT plant_id, ora, avg_kw, media AS baseline,
                    ROUND(z_score::numeric, 2) AS z_score,
                    CASE WHEN ABS(z_score) >= 3.0 THEN 'alta'
                         WHEN ABS(z_score) >= 2.5 THEN 'media'
                         WHEN ABS(z_score) >= 2.0 THEN 'bassa' ELSE NULL END AS severita,
                    CASE WHEN z_score > 0 THEN 'consumo_elevato' ELSE 'consumo_basso' END AS tipo_anomalia
                FROM scored WHERE ABS(z_score) >= 2.0
            )
            SELECT
                a.plant_id,
                p.nome          AS plant_nome,
                p.tipo          AS plant_tipo,
                COUNT(*)        AS totale,
                COUNT(*) FILTER (WHERE severita = 'alta')  AS n_alta,
                COUNT(*) FILTER (WHERE severita = 'media') AS n_media,
                COUNT(*) FILTER (WHERE severita = 'bassa') AS n_bassa,
                COUNT(*) FILTER (WHERE tipo_anomalia = 'consumo_elevato') AS n_elevato,
                COUNT(*) FILTER (WHERE tipo_anomalia = 'consumo_basso')   AS n_basso,
                ROUND(MAX(ABS(z_score))::numeric, 2) AS z_max,
                MAX(ora)                             AS ultima_anomalia,
                ROUND(AVG(avg_kw)::numeric, 3)       AS avg_kwh_anomalia,
                ROUND(AVG(baseline)::numeric, 3)     AS avg_baseline
            FROM anomalie a
            LEFT JOIN plants p ON p.plant_id = a.plant_id AND p.asset_id = %(asset_id)s
            GROUP BY a.plant_id, p.nome, p.tipo
            ORDER BY n_alta DESC, totale DESC
        """, {"asset_id": asset_id, "ore": ore})

        rows = cur.fetchall()
        result = []
        for r in rows:
            result.append({
                "plant_id":         r["plant_id"],
                "plant_nome":       r["plant_nome"],
                "plant_tipo":       r["plant_tipo"],
                "totale":           int(r["totale"]),
                "n_alta":           int(r["n_alta"]),
                "n_media":          int(r["n_media"]),
                "n_bassa":          int(r["n_bassa"]),
                "n_elevato":        int(r["n_elevato"]),
                "n_basso":          int(r["n_basso"]),
                "z_max":            float(r["z_max"]) if r["z_max"] else None,
                "ultima_anomalia":  r["ultima_anomalia"].isoformat() if r["ultima_anomalia"] else None,
                "avg_kwh_anomalia": float(r["avg_kwh_anomalia"]) if r["avg_kwh_anomalia"] else None,
                "avg_baseline":     float(r["avg_baseline"]) if r["avg_baseline"] else None,
            })

        cur.close()
        return {
            "impianti":        result,
            "totale_anomalie": sum(r["totale"] for r in result),
            "totale_alta":     sum(r["n_alta"]  for r in result),
            "totale_media":    sum(r["n_media"] for r in result),
            "totale_bassa":    sum(r["n_bassa"] for r in result),
            "giorni":          giorni,
            "asset_id":        asset_id
        }
