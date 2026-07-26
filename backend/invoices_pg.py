"""
invoices_pg.py — Modulo Tariffe & Bollette
GIS Asset Manager v2.0 — KeyBiz

Gestisce:
  - suppliers        : anagrafica fornitori per asset
  - supply_points    : forniture (POD/PDR/matricola) per fornitore e commodity
  - invoices         : bollette caricate (PDF + dati estratti da LLM)
  - energy_unit_costs: costo unitario aggregato per asset e commodity

Pattern: stesso di energy_pg.py e occupancy_pg.py.
  migrate_invoices_schema(database_url)
  seed_invoices_demo(database_url)
  register_invoices_routes(app, get_db, get_utente_corrente)
"""

import os
import uuid
import json
import asyncio
import logging
from datetime import datetime, date
from typing import Optional

import psycopg2
import psycopg2.extras
from fastapi import Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ── Costanti ────────────────────────────────────────────────────────────────
INVOICES_STORAGE_PATH   = os.environ.get("INVOICES_STORAGE_PATH", "/app/uploads/invoices")
MAX_INVOICE_FILE_MB     = int(os.environ.get("MAX_INVOICE_FILE_SIZE_MB", "10"))
LLM_INVOICE_MODEL       = os.environ.get("LLM_INVOICE_MODEL", "gpt-4o-mini")
UNIT_COST_ROLLING_N     = int(os.environ.get("UNIT_COST_ROLLING_INVOICES", "3"))
LLM_EXTRACTION_TIMEOUT  = int(os.environ.get("LLM_EXTRACTION_TIMEOUT_SEC", "30"))

COMMODITIES = (
    "ELECTRICITY",
    "GAS_METHANE",
    "GAS_GPL",
    "WATER",
    "HEATING_OIL",
    "DIESEL",
    "PETROL",
)
COMMODITY_LABELS = {
    "ELECTRICITY":  "Elettricità",
    "GAS_METHANE":  "Gas Metano",
    "GAS_GPL":      "GPL",
    "WATER":        "Acqua",
    "HEATING_OIL":  "Gasolio riscaldamento",
    "DIESEL":       "Gasolio autotrazione",
    "PETROL":       "Benzina",
}
COMMODITY_UNITS = {
    "ELECTRICITY":  "kWh",
    "GAS_METHANE":  "Smc",
    "GAS_GPL":      "kg",
    "WATER":        "m³",
    "HEATING_OIL":  "litri",
    "DIESEL":       "litri",
    "PETROL":       "litri",
}

# ── Migrazione schema ────────────────────────────────────────────────────────

def migrate_invoices_schema(database_url: str = None):
    """Crea le tabelle del modulo Tariffe & Bollette se non esistono."""
    db_url = database_url or os.environ.get("DATABASE_URL")
    try:
        conn = psycopg2.connect(db_url)
        conn.autocommit = True
        cur = conn.cursor()

        # Estensione UUID
        cur.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto;")

        # ── suppliers ────────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS suppliers (
                supplier_id   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
                asset_id      INTEGER      NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
                name          VARCHAR(255) NOT NULL,
                vat_number    VARCHAR(20),
                notes         TEXT,
                created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
            );
        """)

        # ── supply_points ────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS supply_points (
                supply_point_id UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                asset_id        INTEGER     NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
                supplier_id     UUID        NOT NULL REFERENCES suppliers(supplier_id) ON DELETE RESTRICT,
                commodity       VARCHAR(20) NOT NULL CHECK (commodity IN ('ELECTRICITY','GAS_METHANE','GAS_GPL','WATER','HEATING_OIL','DIESEL','PETROL')),
                point_code      VARCHAR(50),
                description     VARCHAR(255),
                is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
                activated_on    DATE,
                deactivated_on  DATE,
                notes           TEXT,
                created_at      TIMESTAMP   NOT NULL DEFAULT NOW()
            );
        """)
        # Vincolo unicità POD per asset
        cur.execute("""
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'uq_supply_point_code_asset'
                ) THEN
                    ALTER TABLE supply_points
                    ADD CONSTRAINT uq_supply_point_code_asset
                    UNIQUE (asset_id, point_code);
                END IF;
            END $$;
        """)

        # ── invoices ─────────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS invoices (
                invoice_id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
                supply_point_id         UUID          REFERENCES supply_points(supply_point_id) ON DELETE SET NULL,
                asset_id                INTEGER       NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
                commodity               VARCHAR(20)   NOT NULL CHECK (commodity IN ('ELECTRICITY','GAS_METHANE','GAS_GPL','WATER','HEATING_OIL','DIESEL','PETROL')),
                invoice_number          VARCHAR(100),
                issue_date              DATE,
                period_from             DATE,
                period_to               DATE,
                total_amount_eur        NUMERIC(10,2),
                quota_oneri_eur         NUMERIC(10,2),
                consumption_quantity    NUMERIC(12,4),
                consumption_unit        VARCHAR(10),
                unit_cost_eur           NUMERIC(10,6),
                extraction_method       VARCHAR(20)   NOT NULL DEFAULT 'MANUAL'
                                        CHECK (extraction_method IN ('LLM_EXTRACTED','MANUAL','LLM_CORRECTED')),
                extraction_confidence   FLOAT,
                extraction_status       VARCHAR(20)   NOT NULL DEFAULT 'ready'
                                        CHECK (extraction_status IN ('processing','ready','needs_disambiguation','wrong_asset','error')),
                file_path               VARCHAR(500),
                original_filename       VARCHAR(255),
                is_multiutility_source  BOOLEAN       NOT NULL DEFAULT FALSE,
                sibling_invoice_ids     JSONB,
                raw_llm_response        JSONB,
                llm_notes               TEXT,
                created_at              TIMESTAMP     NOT NULL DEFAULT NOW(),
                updated_at              TIMESTAMP     NOT NULL DEFAULT NOW()
            );
        """)

        # ── energy_unit_costs ─────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS energy_unit_costs (
                asset_id                INTEGER     NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
                commodity               VARCHAR(20) NOT NULL CHECK (commodity IN ('ELECTRICITY','GAS_METHANE','GAS_GPL','WATER','HEATING_OIL','DIESEL','PETROL')),
                unit_cost_eur           NUMERIC(10,6) NOT NULL DEFAULT 0,
                last_updated            TIMESTAMP   NOT NULL DEFAULT NOW(),
                active_supply_points    INTEGER     NOT NULL DEFAULT 0,
                source_invoice_ids      JSONB       NOT NULL DEFAULT '[]',
                PRIMARY KEY (asset_id, commodity)
            );
        """)

        # Migrazioni per DB già esistenti
        for col_sql in [
            "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS quota_oneri_eur NUMERIC(10,2)",
        ]:
            try:
                cur.execute(col_sql)
            except Exception:
                pass
        # Aggiorna il CHECK constraint extraction_status per aggiungere wrong_asset
        try:
            cur.execute("""
                ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_extraction_status_check;
                ALTER TABLE invoices ADD CONSTRAINT invoices_extraction_status_check
                    CHECK (extraction_status IN ('processing','ready','needs_disambiguation','wrong_asset','error'));
            """)
        except Exception:
            pass
        # Migrazione commodity GAS -> GAS_METHANE
        # ORDINE CRITICO: prima drop constraint (che blocca l'UPDATE),
        # poi UPDATE dati, poi ricrea constraint con set esteso.
        commodity_check = "('ELECTRICITY','GAS_METHANE','GAS_GPL','WATER','HEATING_OIL','DIESEL','PETROL')"
        for tbl, cname in [
            ('supply_points',    'supply_points_commodity_check'),
            ('invoices',         'invoices_commodity_check'),
            ('energy_unit_costs','energy_unit_costs_commodity_check'),
        ]:
            try:
                cur.execute(f"ALTER TABLE {tbl} DROP CONSTRAINT IF EXISTS {cname}")
            except Exception:
                pass
        for tbl in ['supply_points', 'invoices', 'energy_unit_costs']:
            try:
                cur.execute(f"UPDATE {tbl} SET commodity='GAS_METHANE' WHERE commodity='GAS'")
            except Exception:
                pass
        for tbl, cname in [
            ('supply_points',    'supply_points_commodity_check'),
            ('invoices',         'invoices_commodity_check'),
            ('energy_unit_costs','energy_unit_costs_commodity_check'),
        ]:
            try:
                cur.execute(f"""
                    ALTER TABLE {tbl} ADD CONSTRAINT {cname}
                        CHECK (commodity IN {commodity_check});
                """)
            except Exception:
                pass

        cur.close()
        conn.close()
        print("[invoices] Schema Tariffe & Bollette OK")
    except Exception as e:
        print(f"[invoices] Errore migrazione schema: {e}")


# ── Seed dati demo ────────────────────────────────────────────────────────────

def seed_invoices_demo(database_url: str = None):
    """Inserisce dati demo per i primi 3 asset se non esistono già fornitori."""
    db_url = database_url or os.environ.get("DATABASE_URL")
    try:
        conn = psycopg2.connect(db_url)
        conn.autocommit = True
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Controlla se esistono già dati
        cur.execute("SELECT COUNT(*) AS n FROM suppliers")
        if cur.fetchone()["n"] > 0:
            cur.close(); conn.close(); return

        # Prendi i primi 3 asset
        cur.execute("SELECT id, nome FROM assets ORDER BY id LIMIT 3")
        assets = cur.fetchall()
        if not assets:
            cur.close(); conn.close(); return

        demo = [
            {
                "supplier_name": "Enel Energia S.p.A.",
                "vat": "05779711000",
                "supply_points": [
                    {"commodity": "ELECTRICITY", "point_code": "IT001E12345678",
                     "description": "Quadro generale piano terra",
                     "unit_cost": 0.2850, "consumption": 3200.0, "amount": 912.0},
                ]
            },
            {
                "supplier_name": "Eni Plenitude S.p.A.",
                "vat": "01741720150",
                "supply_points": [
                    {"commodity": "GAS_METHANE", "point_code": "IT-PDR-0012345",
                     "description": "Centrale termica",
                     "unit_cost": 0.9800, "consumption": 420.0, "amount": 411.6},
                ]
            },
            {
                "supplier_name": "Acquedotto Metropolitano",
                "vat": None,
                "supply_points": [
                    {"commodity": "WATER", "point_code": "MAT-00456",
                     "description": "Contatore principale",
                     "unit_cost": 2.1500, "consumption": 85.0, "amount": 182.75},
                ]
            },
        ]

        for i, asset in enumerate(assets):
            asset_id = asset["id"]
            d = demo[i % len(demo)]

            # Fornitore
            cur.execute("""
                INSERT INTO suppliers (asset_id, name, vat_number)
                VALUES (%s, %s, %s)
                RETURNING supplier_id
            """, (asset_id, d["supplier_name"], d["vat"]))
            supplier_id = cur.fetchone()["supplier_id"]

            for sp in d["supply_points"]:
                # Supply point
                cur.execute("""
                    INSERT INTO supply_points
                        (asset_id, supplier_id, commodity, point_code, description, activated_on)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING supply_point_id
                """, (asset_id, supplier_id, sp["commodity"], sp["point_code"],
                      sp["description"], date(2024, 1, 1)))
                sp_id = cur.fetchone()["supply_point_id"]

                # Bolletta demo
                inv_id = str(uuid.uuid4())
                cur.execute("""
                    INSERT INTO invoices (
                        invoice_id, supply_point_id, asset_id, commodity,
                        invoice_number, issue_date, period_from, period_to,
                        total_amount_eur, consumption_quantity, consumption_unit,
                        unit_cost_eur, extraction_method, extraction_confidence,
                        extraction_status, original_filename
                    ) VALUES (
                        %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, %s,
                        %s, %s
                    )
                """, (
                    inv_id, sp_id, asset_id, sp["commodity"],
                    f"DEMO-{inv_id[:8].upper()}", date(2026, 6, 30),
                    date(2026, 6, 1), date(2026, 6, 30),
                    sp["amount"], sp["consumption"],
                    COMMODITY_UNITS[sp["commodity"]],
                    sp["unit_cost"], "MANUAL", None,
                    "ready", "bolletta_demo.pdf"
                ))

                # Costo unitario aggregato
                cur.execute("""
                    INSERT INTO energy_unit_costs
                        (asset_id, commodity, unit_cost_eur, active_supply_points, source_invoice_ids)
                    VALUES (%s, %s, %s, 1, %s)
                    ON CONFLICT (asset_id, commodity) DO UPDATE
                        SET unit_cost_eur = EXCLUDED.unit_cost_eur,
                            last_updated  = NOW(),
                            source_invoice_ids = EXCLUDED.source_invoice_ids
                """, (asset_id, sp["commodity"], sp["unit_cost"], json.dumps([inv_id])))

        cur.close(); conn.close()
        print("[invoices] Seed demo Tariffe & Bollette OK")
    except Exception as e:
        print(f"[invoices] Errore seed demo: {e}")


# ── Utility ──────────────────────────────────────────────────────────────────

def _ensure_storage_dir(asset_id: int, year: int) -> str:
    """Crea e restituisce la directory di storage per un asset/anno."""
    path = os.path.join(INVOICES_STORAGE_PATH, str(asset_id), str(year))
    os.makedirs(path, exist_ok=True)
    return path


def _ricalcola_unit_cost(cur, asset_id: int, commodity: str):
    """
    Ricalcola il costo unitario aggregato per asset+commodity
    usando media ponderata per quantità sulle ultime N bollette per supply_point.
    """
    cur.execute("""
        WITH bollette_recenti AS (
            SELECT
                i.supply_point_id,
                i.unit_cost_eur,
                i.consumption_quantity,
                i.invoice_id,
                ROW_NUMBER() OVER (
                    PARTITION BY i.supply_point_id
                    ORDER BY COALESCE(i.period_to, i.issue_date, i.created_at) DESC
                ) AS rn
            FROM invoices i
            JOIN supply_points sp ON sp.supply_point_id = i.supply_point_id
            WHERE i.asset_id = %s
              AND i.commodity = %s
              AND sp.is_active = TRUE
              AND i.unit_cost_eur IS NOT NULL
              AND i.consumption_quantity IS NOT NULL
              AND i.consumption_quantity > 0
              AND i.extraction_status = 'ready'
        ),
        selezionate AS (
            SELECT * FROM bollette_recenti WHERE rn <= %s
        )
        SELECT
            CASE WHEN SUM(consumption_quantity) > 0
                 THEN SUM(unit_cost_eur * consumption_quantity) / SUM(consumption_quantity)
                 ELSE 0
            END AS costo_medio,
            COUNT(DISTINCT supply_point_id) AS n_supply_points,
            ARRAY_AGG(invoice_id::TEXT) AS invoice_ids
        FROM selezionate
    """, (asset_id, commodity, UNIT_COST_ROLLING_N))

    row = cur.fetchone()
    if not row or row[0] is None:
        return

    costo_medio   = float(row[0])
    n_sp          = int(row[1])
    invoice_ids   = row[2] or []

    cur.execute("""
        INSERT INTO energy_unit_costs
            (asset_id, commodity, unit_cost_eur, active_supply_points, source_invoice_ids, last_updated)
        VALUES (%s, %s, %s, %s, %s, NOW())
        ON CONFLICT (asset_id, commodity) DO UPDATE
            SET unit_cost_eur        = EXCLUDED.unit_cost_eur,
                active_supply_points = EXCLUDED.active_supply_points,
                source_invoice_ids   = EXCLUDED.source_invoice_ids,
                last_updated         = NOW()
    """, (asset_id, commodity, costo_medio, n_sp, json.dumps(invoice_ids)))


# ── Estrazione LLM ────────────────────────────────────────────────────────────

async def _estrai_dati_bolletta(testo_pdf: str, asset_id: int, invoice_id: str, db_url: str):
    """
    Chiama l'LLM per estrarre i dati dalla bolletta e aggiorna il record invoice.
    Eseguita in background tramite BackgroundTasks.
    """
    try:
        from openai import OpenAI
        client = OpenAI()  # legge OPENAI_API_KEY e OPENAI_API_BASE dall'ambiente

        system_prompt = (
            "Sei un assistente specializzato nell'analisi di bollette energetiche italiane. "
            "Il tuo compito è estrarre informazioni economiche precise dal documento fornito.\n\n"
            "ISTRUZIONI CRITICHE:\n"
            "- total_amount_eur: importo TOTALE della bolletta (IVA inclusa). "
            "È la somma di tutte le voci presenti in fattura, incluse materia prima, "
            "trasporto, oneri di sistema, accise e IVA.\n"
            "- quota_oneri_eur: importo relativo agli oneri di sistema e alle componenti "
            "diverse dalla quota materia prima (es. trasporto, distribuzione, oneri generali, "
            "accise, imposte). Se non identificabile separatamente, imposta null.\n"
            "- unit_cost_eur: costo TOTALE per unità consumata, ottenuto dividendo "
            "total_amount_eur per la quantità consumata. Deve includere TUTTE le voci. "
            "NON usare solo il prezzo della materia energia.\n"
            "- commodity: uno tra ELECTRICITY, GAS_METHANE, GAS_GPL, WATER, HEATING_OIL, DIESEL, PETROL.\n"
            "- point_code: codice POD (elettricità), PDR (gas metano/GPL) o matricola contatore (acqua/gasolio/benzina).\n"
            "- Se il documento contiene più commodity (es. elettricità E gas nella stessa fattura), "
            "restituisci un oggetto separato nell'array items per ciascuna commodity.\n"
            "- Se non riesci a determinare un valore con certezza, imposta confidence < 0.60 "
            "e spiega il motivo in notes.\n"
            "- Rispondi ESCLUSIVAMENTE con il JSON richiesto, senza testo aggiuntivo."
        )

        schema = {
            "type": "json_schema",
            "json_schema": {
                "name": "invoice_extraction",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "items": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "commodity":            {"type": "string"},
                                    "supplier_name":        {"type": ["string", "null"]},
                                    "point_code":           {"type": ["string", "null"]},
                                    "invoice_number":       {"type": ["string", "null"]},
                                    "issue_date":           {"type": ["string", "null"]},
                                    "period_from":          {"type": ["string", "null"]},
                                    "period_to":            {"type": ["string", "null"]},
                                    "total_amount_eur":     {"type": ["number", "null"]},
                                    "quota_oneri_eur":      {"type": ["number", "null"]},
                                    "consumption_quantity": {"type": ["number", "null"]},
                                    "consumption_unit":     {"type": ["string", "null"]},
                                    "unit_cost_eur":        {"type": ["number", "null"]},
                                    "confidence":           {"type": ["number", "null"]},
                                    "notes":                {"type": ["string", "null"]},
                                },
                                "required": [
                                    "commodity", "supplier_name", "point_code",
                                    "invoice_number", "issue_date", "period_from", "period_to",
                                    "total_amount_eur", "quota_oneri_eur",
                                    "consumption_quantity", "consumption_unit",
                                    "unit_cost_eur", "confidence", "notes"
                                ],
                                "additionalProperties": False,
                            }
                        }
                    },
                    "required": ["items"],
                    "additionalProperties": False,
                }
            }
        }

        resp = client.chat.completions.create(
            model=LLM_INVOICE_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": f"Analizza questa bolletta:\n\n{testo_pdf[:12000]}"},
            ],
            response_format=schema,
            timeout=LLM_EXTRACTION_TIMEOUT,
        )

        raw = json.loads(resp.choices[0].message.content)
        items = raw.get("items", [])

        conn = psycopg2.connect(db_url)
        conn.autocommit = True
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        if not items:
            cur.execute("""
                UPDATE invoices SET extraction_status='error', llm_notes='Nessun dato estratto',
                    raw_llm_response=%s, updated_at=NOW()
                WHERE invoice_id=%s
            """, (json.dumps(raw), invoice_id))
            cur.close(); conn.close(); return

        # Recupera il record invoice originale per il file_path
        cur.execute("SELECT * FROM invoices WHERE invoice_id=%s", (invoice_id,))
        inv_orig = cur.fetchone()
        if not inv_orig:
            cur.close(); conn.close(); return

        # Recupera i dati dell'asset per la validazione cross-asset
        cur.execute("SELECT id, nome, codice FROM assets WHERE id=%s", (asset_id,))
        asset_row = cur.fetchone()

        # Recupera le supply_points attive dell'asset per il matching
        cur.execute("""
            SELECT sp.supply_point_id, sp.commodity, sp.point_code
            FROM supply_points sp
            WHERE sp.asset_id=%s AND sp.is_active=TRUE
        """, (asset_id,))
        sp_list = cur.fetchall()

        def _check_cross_asset(point_code: str):
            """Verifica se il POD/PDR appartiene già a un altro asset. Restituisce (asset_id_altro, nome_altro) o (None, None)."""
            if not point_code:
                return None, None
            cur.execute("""
                SELECT sp.asset_id, a.nome, a.codice
                FROM supply_points sp
                JOIN assets a ON a.id = sp.asset_id
                WHERE sp.point_code = %s AND sp.asset_id != %s AND sp.is_active = TRUE
                LIMIT 1
            """, (point_code.strip(), asset_id))
            row = cur.fetchone()
            if row:
                return row["asset_id"], f"{row['codice']} - {row['nome']}"
            return None, None

        def _auto_crea_supply_point(commodity: str, point_code: str, supplier_name: str):
            """Crea automaticamente fornitura e fornitore se non esistono. Restituisce supply_point_id."""
            # Trova o crea il fornitore
            sup_name = (supplier_name or "Fornitore sconosciuto").strip()[:200]
            cur.execute("SELECT supplier_id FROM suppliers WHERE asset_id=%s AND name=%s",
                        (asset_id, sup_name))
            sup_row = cur.fetchone()
            if sup_row:
                supplier_id = sup_row["supplier_id"]
            else:
                cur.execute("""
                    INSERT INTO suppliers (asset_id, name, notes)
                    VALUES (%s, %s, 'Creato automaticamente da estrazione bolletta')
                    RETURNING supplier_id
                """, (asset_id, sup_name))
                supplier_id = cur.fetchone()["supplier_id"]
            # Crea supply_point
            cur.execute("""
                INSERT INTO supply_points (asset_id, supplier_id, commodity, point_code,
                    description, is_active)
                VALUES (%s, %s, %s, %s, 'Creata automaticamente da estrazione bolletta', TRUE)
                RETURNING supply_point_id
            """, (asset_id, supplier_id, commodity, point_code))
            new_sp_id = cur.fetchone()["supply_point_id"]
            # Aggiorna sp_list locale
            sp_list.append({"supply_point_id": new_sp_id, "commodity": commodity,
                             "point_code": point_code})
            return new_sp_id

        def _match_or_create_sp(commodity: str, point_code: str, supplier_name: str):
            """
            Logica di matching:
            1. POD su altro asset -> (None, 'wrong_asset', messaggio)
            2. POD su questo asset -> (supply_point_id, 'ready', None)
            3. POD nuovo -> auto-crea fornitura -> (supply_point_id, 'ready', None)
            4. Unica fornitura attiva per commodity -> abbina -> (supply_point_id, 'ready', None)
            5. Nessun match -> (None, 'needs_disambiguation', None)
            """
            # Controllo cross-asset
            other_asset_id, other_asset_label = _check_cross_asset(point_code)
            if other_asset_id:
                return None, 'wrong_asset', (
                    f"Il codice {point_code} risulta già associato all'asset {other_asset_label}. "
                    "Verificare prima di procedere."
                )
            # Match per point_code su questo asset
            if point_code:
                for sp in sp_list:
                    if sp["point_code"] and sp["point_code"].strip() == point_code.strip():
                        return sp["supply_point_id"], 'ready', None
                # POD nuovo su questo asset: auto-crea fornitura
                new_sp_id = _auto_crea_supply_point(commodity, point_code, supplier_name)
                return new_sp_id, 'ready', None
            # Nessun POD estratto: unica fornitura attiva per commodity
            matches = [sp for sp in sp_list if sp["commodity"] == commodity]
            if len(matches) == 1:
                return matches[0]["supply_point_id"], 'ready', None
            return None, 'needs_disambiguation', None

        is_multiutility = len(items) > 1
        sibling_ids = []
        new_invoice_ids = []

        for idx, item in enumerate(items):
            commodity = item.get("commodity", "").upper()
            if commodity not in COMMODITIES:
                continue

            sp_id, status, cross_note = _match_or_create_sp(
                commodity, item.get("point_code"), item.get("supplier_name")
            )
            # Combina note LLM con eventuale nota cross-asset
            llm_notes = item.get("notes") or ""
            if cross_note:
                llm_notes = (cross_note + ("\n" + llm_notes if llm_notes else "")).strip()

            if idx == 0:
                # Aggiorna il record originale
                cur.execute("""
                    UPDATE invoices SET
                        supply_point_id       = %s,
                        commodity             = %s,
                        invoice_number        = %s,
                        issue_date            = %s,
                        period_from           = %s,
                        period_to             = %s,
                        total_amount_eur      = %s,
                        quota_oneri_eur       = %s,
                        consumption_quantity  = %s,
                        consumption_unit      = %s,
                        unit_cost_eur         = %s,
                        extraction_method     = 'LLM_EXTRACTED',
                        extraction_confidence = %s,
                        extraction_status     = %s,
                        is_multiutility_source= %s,
                        raw_llm_response      = %s,
                        llm_notes             = %s,
                        updated_at            = NOW()
                    WHERE invoice_id = %s
                """, (
                    sp_id, commodity,
                    item.get("invoice_number"),
                    item.get("issue_date"),
                    item.get("period_from"),
                    item.get("period_to"),
                    item.get("total_amount_eur"),
                    item.get("quota_oneri_eur"),
                    item.get("consumption_quantity"),
                    item.get("consumption_unit"),
                    item.get("unit_cost_eur"),
                    item.get("confidence"),
                    status,
                    is_multiutility,
                    json.dumps(raw),
                    llm_notes,
                    invoice_id,
                ))
                new_invoice_ids.append(invoice_id)
            else:
                # Crea record aggiuntivo per commodity extra (multi-utility)
                new_id = str(uuid.uuid4())
                cur.execute("""
                    INSERT INTO invoices (
                        invoice_id, supply_point_id, asset_id, commodity,
                        invoice_number, issue_date, period_from, period_to,
                        total_amount_eur, quota_oneri_eur,
                        consumption_quantity, consumption_unit,
                        unit_cost_eur, extraction_method, extraction_confidence,
                        extraction_status, file_path, original_filename,
                        is_multiutility_source, raw_llm_response, llm_notes
                    ) VALUES (
                        %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s,
                        %s, %s,
                        %s, 'LLM_EXTRACTED', %s,
                        %s, %s, %s,
                        TRUE, %s, %s
                    )
                """, (
                    new_id, sp_id, asset_id, commodity,
                    item.get("invoice_number"),
                    item.get("issue_date"),
                    item.get("period_from"),
                    item.get("period_to"),
                    item.get("total_amount_eur"),
                    item.get("quota_oneri_eur"),
                    item.get("consumption_quantity"),
                    item.get("consumption_unit"),
                    item.get("unit_cost_eur"),
                    item.get("confidence"),
                    status,
                    inv_orig["file_path"],
                    inv_orig["original_filename"],
                    json.dumps(raw),
                    llm_notes,
                ))
                new_invoice_ids.append(new_id)
                sibling_ids.append(new_id)

        # Aggiorna sibling_ids su tutti i record multi-utility
        if is_multiutility and len(new_invoice_ids) > 1:
            for nid in new_invoice_ids:
                others = [x for x in new_invoice_ids if x != nid]
                cur.execute("""
                    UPDATE invoices SET sibling_invoice_ids=%s WHERE invoice_id=%s
                """, (json.dumps(others), nid))

        # Ricalcola costi unitari per le commodity estratte
        for item in items:
            commodity = item.get("commodity", "").upper()
            if commodity in COMMODITIES:
                _ricalcola_unit_cost(cur, asset_id, commodity)

        cur.close(); conn.close()

    except Exception as e:
        logger.error(f"[invoices] Errore estrazione LLM invoice {invoice_id}: {e}")
        try:
            conn2 = psycopg2.connect(db_url)
            conn2.autocommit = True
            cur2 = conn2.cursor()
            cur2.execute("""
                UPDATE invoices SET extraction_status='error', llm_notes=%s, updated_at=NOW()
                WHERE invoice_id=%s
            """, (str(e)[:500], invoice_id))
            cur2.close(); conn2.close()
        except Exception:
            pass


# ── Registrazione route ───────────────────────────────────────────────────────

def register_invoices_routes(app, get_db, get_utente_corrente):
    """Registra tutti gli endpoint del modulo Tariffe & Bollette."""

    # ── Pydantic models ───────────────────────────────────────────────────────

    class SupplierCreate(BaseModel):
        name:       str
        vat_number: Optional[str] = None
        notes:      Optional[str] = None

    class SupplierUpdate(BaseModel):
        name:       Optional[str] = None
        vat_number: Optional[str] = None
        notes:      Optional[str] = None

    class SupplyPointCreate(BaseModel):
        supplier_id:  str
        commodity:    str
        point_code:   Optional[str] = None
        description:  Optional[str] = None
        activated_on: Optional[str] = None
        notes:        Optional[str] = None

    class SupplyPointUpdate(BaseModel):
        description:  Optional[str] = None
        point_code:   Optional[str] = None
        notes:        Optional[str] = None

    class InvoiceUpdate(BaseModel):
        supply_point_id:      Optional[str]   = None
        commodity:            Optional[str]   = None
        invoice_number:       Optional[str]   = None
        issue_date:           Optional[str]   = None
        period_from:          Optional[str]   = None
        period_to:            Optional[str]   = None
        total_amount_eur:     Optional[float] = None
        quota_oneri_eur:      Optional[float] = None
        consumption_quantity: Optional[float] = None
        consumption_unit:     Optional[str]   = None
        unit_cost_eur:        Optional[float] = None

    class DisambiguationConfirm(BaseModel):
        assignments: list  # [{invoice_id, supply_point_id}]

    class UnitCostOverride(BaseModel):
        unit_cost_eur: float

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _get_asset_or_404(cur, asset_id: int):
        cur.execute("SELECT id FROM assets WHERE id=%s", (asset_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Asset non trovato")

    # ── Fornitori ─────────────────────────────────────────────────────────────

    @app.get("/api/bems/buildings/{asset_id}/suppliers", tags=["invoices"])
    def lista_fornitori(asset_id: int, db=Depends(get_db), _=Depends(get_utente_corrente)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        _get_asset_or_404(cur, asset_id)
        cur.execute("""
            SELECT s.*,
                   COUNT(sp.supply_point_id) AS n_supply_points
            FROM suppliers s
            LEFT JOIN supply_points sp ON sp.supplier_id = s.supplier_id
            WHERE s.asset_id = %s
            GROUP BY s.supplier_id
            ORDER BY s.name
        """, (asset_id,))
        return {"suppliers": [dict(r) for r in cur.fetchall()]}

    @app.post("/api/bems/buildings/{asset_id}/suppliers", tags=["invoices"])
    def crea_fornitore(asset_id: int, body: SupplierCreate, db=Depends(get_db), _=Depends(get_utente_corrente)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        _get_asset_or_404(cur, asset_id)
        cur.execute("""
            INSERT INTO suppliers (asset_id, name, vat_number, notes)
            VALUES (%s, %s, %s, %s)
            RETURNING *
        """, (asset_id, body.name, body.vat_number, body.notes))
        db.commit()
        return {"supplier": dict(cur.fetchone())}

    @app.put("/api/bems/buildings/{asset_id}/suppliers/{supplier_id}", tags=["invoices"])
    def modifica_fornitore(asset_id: int, supplier_id: str, body: SupplierUpdate, db=Depends(get_db), _=Depends(get_utente_corrente)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM suppliers WHERE supplier_id=%s AND asset_id=%s",
                    (supplier_id, asset_id))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Fornitore non trovato")
        updates = {k: v for k, v in body.dict().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
        set_clause = ", ".join(f"{k}=%s" for k in updates)
        cur.execute(f"UPDATE suppliers SET {set_clause} WHERE supplier_id=%s RETURNING *",
                    list(updates.values()) + [supplier_id])
        db.commit()
        return {"supplier": dict(cur.fetchone())}

    @app.delete("/api/bems/buildings/{asset_id}/suppliers/{supplier_id}", tags=["invoices"])
    def elimina_fornitore(asset_id: int, supplier_id: str, db=Depends(get_db), _=Depends(get_utente_corrente)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT COUNT(*) AS n FROM supply_points WHERE supplier_id=%s", (supplier_id,))
        if cur.fetchone()["n"] > 0:
            raise HTTPException(status_code=409,
                detail="Impossibile eliminare: il fornitore ha forniture associate")
        cur.execute("DELETE FROM suppliers WHERE supplier_id=%s AND asset_id=%s",
                    (supplier_id, asset_id))
        db.commit()
        return {"ok": True}

    # ── Forniture (Supply Points) ─────────────────────────────────────────────

    @app.get("/api/bems/buildings/{asset_id}/supply-points", tags=["invoices"])
    def lista_forniture(asset_id: int, commodity: Optional[str] = None,
                        is_active: Optional[bool] = None, db=Depends(get_db), _=Depends(get_utente_corrente)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        _get_asset_or_404(cur, asset_id)
        where = ["sp.asset_id=%s"]
        params = [asset_id]
        if commodity:
            where.append("sp.commodity=%s"); params.append(commodity.upper())
        if is_active is not None:
            where.append("sp.is_active=%s"); params.append(is_active)
        cur.execute(f"""
            SELECT sp.*, s.name AS supplier_name,
                   (SELECT i.unit_cost_eur FROM invoices i
                    WHERE i.supply_point_id=sp.supply_point_id
                      AND i.extraction_status='ready'
                    ORDER BY COALESCE(i.period_to, i.created_at) DESC LIMIT 1
                   ) AS last_unit_cost_eur
            FROM supply_points sp
            JOIN suppliers s ON s.supplier_id = sp.supplier_id
            WHERE {' AND '.join(where)}
            ORDER BY sp.commodity, s.name
        """, params)
        return {"supply_points": [dict(r) for r in cur.fetchall()]}

    @app.post("/api/bems/buildings/{asset_id}/supply-points", tags=["invoices"])
    def crea_fornitura(asset_id: int, body: SupplyPointCreate, db=Depends(get_db), _=Depends(get_utente_corrente)):
        if body.commodity.upper() not in COMMODITIES:
            raise HTTPException(status_code=400, detail=f"Commodity non valida: {body.commodity}")
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        _get_asset_or_404(cur, asset_id)
        try:
            cur.execute("""
                INSERT INTO supply_points
                    (asset_id, supplier_id, commodity, point_code, description, activated_on, notes)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (asset_id, body.supplier_id, body.commodity.upper(),
                  body.point_code, body.description, body.activated_on, body.notes))
            db.commit()
            return {"supply_point": dict(cur.fetchone())}
        except psycopg2.errors.UniqueViolation:
            db.rollback()
            raise HTTPException(status_code=409,
                detail="Il codice POD/PDR è già associato a un'altra fornitura di questo asset")

    @app.put("/api/bems/buildings/{asset_id}/supply-points/{sp_id}", tags=["invoices"])
    def modifica_fornitura(asset_id: int, sp_id: str, body: SupplyPointUpdate, db=Depends(get_db), _=Depends(get_utente_corrente)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM supply_points WHERE supply_point_id=%s AND asset_id=%s",
                    (sp_id, asset_id))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Fornitura non trovata")
        updates = {k: v for k, v in body.dict().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
        set_clause = ", ".join(f"{k}=%s" for k in updates)
        cur.execute(f"UPDATE supply_points SET {set_clause} WHERE supply_point_id=%s RETURNING *",
                    list(updates.values()) + [sp_id])
        db.commit()
        return {"supply_point": dict(cur.fetchone())}

    @app.patch("/api/bems/buildings/{asset_id}/supply-points/{sp_id}/deactivate", tags=["invoices"])
    def disattiva_fornitura(asset_id: int, sp_id: str, db=Depends(get_db), _=Depends(get_utente_corrente)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            UPDATE supply_points
            SET is_active=FALSE, deactivated_on=NOW()
            WHERE supply_point_id=%s AND asset_id=%s
            RETURNING *
        """, (sp_id, asset_id))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Fornitura non trovata")
        db.commit()
        return {"ok": True}

    # ── Bollette ──────────────────────────────────────────────────────────────

    @app.get("/api/bems/buildings/{asset_id}/invoices", tags=["invoices"])
    def lista_bollette(asset_id: int, commodity: Optional[str] = None,
                       supply_point_id: Optional[str] = None,
                       year: Optional[int] = None, db=Depends(get_db), _=Depends(get_utente_corrente)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        _get_asset_or_404(cur, asset_id)
        where = ["i.asset_id=%s"]
        params = [asset_id]
        if commodity:
            where.append("i.commodity=%s"); params.append(commodity.upper())
        if supply_point_id:
            where.append("i.supply_point_id=%s"); params.append(supply_point_id)
        if year:
            where.append("EXTRACT(YEAR FROM COALESCE(i.period_from, i.issue_date))=%s")
            params.append(year)
        cur.execute(f"""
            SELECT i.*,
                   s.name AS supplier_name,
                   sp.description AS supply_point_description,
                   sp.point_code
            FROM invoices i
            LEFT JOIN supply_points sp ON sp.supply_point_id = i.supply_point_id
            LEFT JOIN suppliers s ON s.supplier_id = sp.supplier_id
            WHERE {' AND '.join(where)}
            ORDER BY COALESCE(i.period_to, i.issue_date, i.created_at) DESC
        """, params)
        rows = cur.fetchall()
        # Serializza UUID e date
        result = []
        for r in rows:
            d = dict(r)
            for k, v in d.items():
                if isinstance(v, (uuid.UUID,)):
                    d[k] = str(v)
                elif isinstance(v, (date, datetime)):
                    d[k] = v.isoformat()
            result.append(d)
        return {"invoices": result}

    @app.post("/api/bems/buildings/{asset_id}/invoices/upload", tags=["invoices"])
    async def upload_bolletta(
        asset_id: int,
        background_tasks: BackgroundTasks,
        file: UploadFile = File(...),
        supply_point_id: Optional[str] = Form(None),
        db=Depends(get_db), _=Depends(get_utente_corrente)
    ):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        _get_asset_or_404(cur, asset_id)

        # Validazione file
        if not file.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Il file deve essere in formato PDF.")
        content = await file.read()
        if len(content) > MAX_INVOICE_FILE_MB * 1024 * 1024:
            raise HTTPException(status_code=400,
                detail=f"Il file supera la dimensione massima consentita ({MAX_INVOICE_FILE_MB} MB).")

        # Salvataggio file
        invoice_id = str(uuid.uuid4())
        year = datetime.now().year
        storage_dir = _ensure_storage_dir(asset_id, year)
        safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in file.filename)
        file_name = f"{invoice_id}_{safe_name}"
        file_path = os.path.join(storage_dir, file_name)
        relative_path = os.path.join(str(asset_id), str(year), file_name)

        with open(file_path, "wb") as f:
            f.write(content)

        # Determina commodity iniziale dalla supply_point se fornita
        commodity_init = "ELECTRICITY"
        if supply_point_id:
            cur.execute("SELECT commodity FROM supply_points WHERE supply_point_id=%s AND asset_id=%s",
                        (supply_point_id, asset_id))
            sp_row = cur.fetchone()
            if sp_row:
                commodity_init = sp_row["commodity"]

        # Crea record invoice in stato "processing"
        cur.execute("""
            INSERT INTO invoices (
                invoice_id, asset_id, commodity, supply_point_id,
                extraction_status, file_path, original_filename
            ) VALUES (%s, %s, %s, %s, 'processing', %s, %s)
        """, (invoice_id, asset_id, commodity_init, supply_point_id,
              relative_path, file.filename))
        db.commit()

        # Estrai testo PDF per l'LLM
        testo_pdf = ""
        try:
            import pdfplumber
            with pdfplumber.open(file_path) as pdf:
                testo_pdf = "\n".join(
                    page.extract_text() or "" for page in pdf.pages
                )
            if len(testo_pdf.strip()) < 100:
                raise ValueError("PDF non leggibile (testo insufficiente)")
        except ImportError:
            # pdfplumber non installato: imposta errore con form manuale
            cur.execute("""
                UPDATE invoices SET extraction_status='error',
                    llm_notes='Libreria pdfplumber non disponibile. Inserire i dati manualmente.',
                    updated_at=NOW()
                WHERE invoice_id=%s
            """, (invoice_id,))
            db.commit()
            return {"invoice_id": invoice_id, "status": "error",
                    "message": "Estrazione automatica non disponibile. Inserire i dati manualmente."}
        except Exception as e:
            cur.execute("""
                UPDATE invoices SET extraction_status='error',
                    llm_notes=%s, updated_at=NOW()
                WHERE invoice_id=%s
            """, (f"Il documento sembra essere una scansione o non è leggibile: {str(e)[:200]}",
                  invoice_id))
            db.commit()
            return {"invoice_id": invoice_id, "status": "error",
                    "message": "Il documento sembra essere una scansione. Inserire i dati manualmente."}

        # Avvia estrazione LLM in background
        db_url = os.environ.get("DATABASE_URL")
        background_tasks.add_task(_estrai_dati_bolletta, testo_pdf, asset_id, invoice_id, db_url)

        return {"invoice_id": invoice_id, "status": "processing"}

    @app.get("/api/bems/buildings/{asset_id}/invoices/{invoice_id}", tags=["invoices"])
    def dettaglio_bolletta(asset_id: int, invoice_id: str, db=Depends(get_db), _=Depends(get_utente_corrente)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT i.*,
                   s.name AS supplier_name,
                   sp.description AS supply_point_description,
                   sp.point_code, sp.commodity AS sp_commodity
            FROM invoices i
            LEFT JOIN supply_points sp ON sp.supply_point_id = i.supply_point_id
            LEFT JOIN suppliers s ON s.supplier_id = sp.supplier_id
            WHERE i.invoice_id=%s AND i.asset_id=%s
        """, (invoice_id, asset_id))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Bolletta non trovata")
        d = dict(row)
        for k, v in d.items():
            if isinstance(v, (uuid.UUID,)):
                d[k] = str(v)
            elif isinstance(v, (date, datetime)):
                d[k] = v.isoformat()
        return {"invoice": d, "status": d.get("extraction_status")}

    @app.put("/api/bems/buildings/{asset_id}/invoices/{invoice_id}", tags=["invoices"])
    def aggiorna_bolletta(asset_id: int, invoice_id: str, body: InvoiceUpdate, db=Depends(get_db), _=Depends(get_utente_corrente)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM invoices WHERE invoice_id=%s AND asset_id=%s",
                    (invoice_id, asset_id))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Bolletta non trovata")
        updates = {k: v for k, v in body.dict().items() if v is not None}
        # Se i dati erano LLM_EXTRACTED e vengono modificati → LLM_CORRECTED
        updates["extraction_method"] = "LLM_CORRECTED"
        updates["extraction_status"] = "ready"
        updates["updated_at"] = "NOW()"
        set_parts = []
        vals = []
        for k, v in updates.items():
            if v == "NOW()":
                set_parts.append(f"{k}=NOW()")
            else:
                set_parts.append(f"{k}=%s")
                vals.append(v)
        cur.execute(f"UPDATE invoices SET {', '.join(set_parts)} WHERE invoice_id=%s RETURNING *",
                    vals + [invoice_id])
        db.commit()
        inv = dict(cur.fetchone())
        # Ricalcola costo unitario
        _ricalcola_unit_cost(cur, asset_id, inv["commodity"])
        db.commit()
        return {"ok": True}

    @app.post("/api/bems/buildings/{asset_id}/invoices/{invoice_id}/confirm-disambiguation",
              tags=["invoices"])
    def conferma_disambiguazione(asset_id: int, invoice_id: str,
                                 body: DisambiguationConfirm, db=Depends(get_db), _=Depends(get_utente_corrente)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        for assignment in body.assignments:
            iid = assignment.get("invoice_id")
            spid = assignment.get("supply_point_id")
            if not iid or not spid:
                continue
            cur.execute("""
                UPDATE invoices SET supply_point_id=%s, extraction_status='ready', updated_at=NOW()
                WHERE invoice_id=%s AND asset_id=%s
            """, (spid, iid, asset_id))
            cur.execute("SELECT commodity FROM invoices WHERE invoice_id=%s", (iid,))
            row = cur.fetchone()
            if row:
                _ricalcola_unit_cost(cur, asset_id, row["commodity"])
        db.commit()
        return {"ok": True}

    @app.delete("/api/bems/buildings/{asset_id}/invoices/{invoice_id}", tags=["invoices"])
    def elimina_bolletta(asset_id: int, invoice_id: str, db=Depends(get_db), _=Depends(get_utente_corrente)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM invoices WHERE invoice_id=%s AND asset_id=%s",
                    (invoice_id, asset_id))
        inv = cur.fetchone()
        if not inv:
            raise HTTPException(status_code=404, detail="Bolletta non trovata")

        commodity = inv["commodity"]
        file_path = inv["file_path"]

        # Elimina file solo se non condiviso con sibling
        if file_path and not inv["is_multiutility_source"]:
            abs_path = os.path.join(INVOICES_STORAGE_PATH, file_path)
            if os.path.exists(abs_path):
                try:
                    os.remove(abs_path)
                except Exception:
                    pass

        cur.execute("DELETE FROM invoices WHERE invoice_id=%s", (invoice_id,))
        db.commit()
        _ricalcola_unit_cost(cur, asset_id, commodity)
        db.commit()
        return {"ok": True}

    @app.get("/api/bems/buildings/{asset_id}/invoices/{invoice_id}/file", tags=["invoices"])
    def download_bolletta(asset_id: int, invoice_id: str, db=Depends(get_db), _=Depends(get_utente_corrente)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT file_path, original_filename FROM invoices WHERE invoice_id=%s AND asset_id=%s",
                    (invoice_id, asset_id))
        row = cur.fetchone()
        if not row or not row["file_path"]:
            raise HTTPException(status_code=404, detail="File non trovato")
        abs_path = os.path.join(INVOICES_STORAGE_PATH, row["file_path"])
        if not os.path.exists(abs_path):
            raise HTTPException(status_code=404, detail="File non trovato sul volume")
        return FileResponse(
            abs_path,
            media_type="application/pdf",
            filename=row["original_filename"] or "bolletta.pdf"
        )

    # ── Costi unitari aggregati ───────────────────────────────────────────────

    @app.get("/api/bems/buildings/{asset_id}/energy-costs", tags=["invoices"])
    def costi_unitari(asset_id: int, db=Depends(get_db), _=Depends(get_utente_corrente)):
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        _get_asset_or_404(cur, asset_id)
        cur.execute("""
            SELECT commodity, unit_cost_eur, last_updated,
                   active_supply_points, source_invoice_ids
            FROM energy_unit_costs
            WHERE asset_id=%s
            ORDER BY commodity
        """, (asset_id,))
        rows = cur.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["commodity_label"] = COMMODITY_LABELS.get(d["commodity"], d["commodity"])
            d["unit"] = COMMODITY_UNITS.get(d["commodity"], "")
            if isinstance(d.get("last_updated"), (date, datetime)):
                d["last_updated"] = d["last_updated"].isoformat()
            result.append(d)
        return {"energy_costs": result}

    @app.get("/api/bems/buildings/{asset_id}/energy-costs/{commodity}", tags=["invoices"])
    def costo_unitario_commodity(asset_id: int, commodity: str, db=Depends(get_db), _=Depends(get_utente_corrente)):
        commodity = commodity.upper()
        if commodity not in COMMODITIES:
            raise HTTPException(status_code=400, detail="Commodity non valida")
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT euc.*,
                   sp.supply_point_id, sp.description AS sp_description,
                   sp.point_code, s.name AS supplier_name,
                   (SELECT i.unit_cost_eur FROM invoices i
                    WHERE i.supply_point_id=sp.supply_point_id
                      AND i.extraction_status='ready'
                    ORDER BY COALESCE(i.period_to, i.created_at) DESC LIMIT 1
                   ) AS sp_last_unit_cost
            FROM energy_unit_costs euc
            LEFT JOIN supply_points sp ON sp.asset_id=euc.asset_id
                AND sp.commodity=euc.commodity AND sp.is_active=TRUE
            LEFT JOIN suppliers s ON s.supplier_id=sp.supplier_id
            WHERE euc.asset_id=%s AND euc.commodity=%s
        """, (asset_id, commodity))
        rows = cur.fetchall()
        if not rows:
            return {"commodity": commodity, "unit_cost_eur": None, "supply_points": []}
        first = dict(rows[0])
        return {
            "commodity":          commodity,
            "commodity_label":    COMMODITY_LABELS.get(commodity, commodity),
            "unit":               COMMODITY_UNITS.get(commodity, ""),
            "unit_cost_eur":      float(first["unit_cost_eur"]) if first["unit_cost_eur"] else None,
            "last_updated":       first["last_updated"].isoformat() if first.get("last_updated") else None,
            "active_supply_points": first["active_supply_points"],
            "supply_points": [
                {
                    "supply_point_id": str(r["supply_point_id"]) if r["supply_point_id"] else None,
                    "supplier_name":   r["supplier_name"],
                    "description":     r["sp_description"],
                    "point_code":      r["point_code"],
                    "last_unit_cost":  float(r["sp_last_unit_cost"]) if r["sp_last_unit_cost"] else None,
                }
                for r in rows if r["supply_point_id"]
            ]
        }

    @app.put("/api/bems/buildings/{asset_id}/energy-costs/{commodity}", tags=["invoices"])
    def override_costo_unitario(asset_id: int, commodity: str, body: UnitCostOverride, db=Depends(get_db), _=Depends(get_utente_corrente)):
        commodity = commodity.upper()
        if commodity not in COMMODITIES:
            raise HTTPException(status_code=400, detail="Commodity non valida")
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            INSERT INTO energy_unit_costs (asset_id, commodity, unit_cost_eur, last_updated)
            VALUES (%s, %s, %s, NOW())
            ON CONFLICT (asset_id, commodity) DO UPDATE
                SET unit_cost_eur=EXCLUDED.unit_cost_eur, last_updated=NOW()
        """, (asset_id, commodity, body.unit_cost_eur))
        db.commit()
        return {"ok": True}

    # ── Dashboard aggregata asset ─────────────────────────────────────────────

    @app.get("/api/bems/assets/energy-costs", tags=["invoices"])
    def costi_asset(commodity: Optional[str] = None, db=Depends(get_db), _=Depends(get_utente_corrente)):
        """Restituisce i costi unitari aggregati per tutti gli asset degli asset."""
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        where = []
        params = []
        if commodity:
            where.append("euc.commodity=%s"); params.append(commodity.upper())
        where_sql = f"WHERE {' AND '.join(where)}" if where else ""
        cur.execute(f"""
            SELECT a.id AS asset_id, a.nome, a.tipo, a.citta,
                   euc.commodity, euc.unit_cost_eur, euc.last_updated,
                   euc.active_supply_points
            FROM energy_unit_costs euc
            JOIN assets a ON a.id = euc.asset_id
            {where_sql}
            ORDER BY a.nome, euc.commodity
        """, params)
        rows = cur.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["commodity_label"] = COMMODITY_LABELS.get(d["commodity"], d["commodity"])
            d["unit"] = COMMODITY_UNITS.get(d["commodity"], "")
            if isinstance(d.get("last_updated"), (date, datetime)):
                d["last_updated"] = d["last_updated"].isoformat()
            result.append(d)
        return {"asset_costs": result}

    print("[invoices] Route Tariffe & Bollette registrate OK")
