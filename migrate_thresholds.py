"""
migrate_thresholds.py - v1.0
Migra le soglie allarme da valori assoluti a percentuali.

Logica:
- is_percentage=1 + campo_totale: il ricalcolo calcola pct = valore/totale*100
  e confronta con warning_value/alarm_value (entrambi in %)
- is_percentage=1 + campo_totale=None: il campo è già una percentuale (es. saturazione_pct)
- is_percentage=0: confronto diretto valore vs soglia (legacy, non più usato)

Soglie ridefinite per tipo asset:
  ufficio:
    - occupancy (dipendenti/capienza): warn 70%, alarm 90%
    - sale_riunioni_occupate/sale_riunioni_totali: warn 75%, alarm 95%
  stabilimento:
    - linee attive/totali: warn <60% (inverso), alarm <40% (inverso)
    - personale_attivo/capienza_personale: warn 90%, alarm 100%
  magazzino:
    - saturazione_stoccaggio_pct (già %): warn 80%, alarm 92%
    - mezzi_operativi/mezzi_totali: warn <50% (inverso), alarm <30% (inverso)
  deposito:
    - mezzi_disponibili/mezzi_totali: warn <50% (inverso), alarm <30% (inverso)
    - mezzi_in_manutenzione/mezzi_totali: warn 30%, alarm 50%

Nota: per i campi "inverso" (basso = brutto), warning_value > alarm_value
e la logica di confronto è invertita (valore < soglia).
"""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "assets.db")


def migra(conn):
    # Cancella soglie precedenti e reinserisce tutto in modalità percentuale
    conn.execute("DELETE FROM thresholds")

    nuove_soglie = [
        # (asset_tipo, campo, label, warning_value, alarm_value, unita,
        #  is_percentage, campo_totale, inverso)
        # ── Uffici ────────────────────────────────────────────────────────────
        # Occupancy: dipendenti_presenti / capienza_massima
        # Alto = brutto (sovraffollamento)
        ("ufficio", "dipendenti_presenti",
         "Occupancy ufficio", 70.0, 90.0, "%",
         1, "capienza_massima", 0),

        # Sale riunioni: sale_riunioni_occupate / sale_riunioni_totali
        # Alto = brutto (saturazione sale)
        ("ufficio", "sale_riunioni_occupate",
         "Sale riunioni occupate", 75.0, 95.0, "%",
         1, "sale_riunioni_totali", 0),

        # ── Stabilimenti ──────────────────────────────────────────────────────
        # Linee attive / totali: basso = brutto (fermi produzione) → inverso
        ("stabilimento", "linee_produzione_attive",
         "Linee produzione attive", 60.0, 40.0, "%",
         1, "linee_produzione_totali", 1),

        # Personale attivo / capienza_personale: alto = brutto (sovraccarico)
        ("stabilimento", "personale_attivo",
         "Personale attivo", 85.0, 100.0, "%",
         1, "capienza_personale", 0),

        # ── Magazzini ─────────────────────────────────────────────────────────
        # Saturazione stoccaggio (già %): alto = brutto
        ("magazzino", "saturazione_stoccaggio_pct",
         "Saturazione stoccaggio", 80.0, 92.0, "%",
         1, None, 0),

        # Mezzi operativi / mezzi_totali: basso = brutto → inverso
        ("magazzino", "mezzi_operativi",
         "Mezzi operativi", 50.0, 30.0, "%",
         1, "mezzi_totali", 1),

        # ── Depositi ──────────────────────────────────────────────────────────
        # Mezzi disponibili / mezzi_totali: basso = brutto → inverso
        ("deposito", "mezzi_disponibili",
         "Mezzi disponibili", 50.0, 30.0, "%",
         1, "mezzi_totali", 1),

        # Mezzi in manutenzione / mezzi_totali: alto = brutto
        ("deposito", "mezzi_in_manutenzione",
         "Mezzi in manutenzione", 30.0, 50.0, "%",
         1, "mezzi_totali", 0),
    ]

    # Aggiunge colonna inverso se non esiste
    try:
        conn.execute("ALTER TABLE thresholds ADD COLUMN inverso INTEGER NOT NULL DEFAULT 0")
        print("Colonna inverso aggiunta")
    except Exception as e:
        print(f"inverso: {e}")

    for s in nuove_soglie:
        conn.execute("""
            INSERT INTO thresholds
            (asset_tipo, campo, label, warning_value, alarm_value, unita,
             is_percentage, campo_totale, inverso)
            VALUES (?,?,?,?,?,?,?,?,?)
        """, s)

    conn.commit()
    rows = conn.execute("SELECT * FROM thresholds").fetchall()
    print(f"\nSoglie inserite: {len(rows)}")
    for r in rows:
        d = dict(r)
        inv = " [INVERSO]" if d.get("inverso") else ""
        print(f"  [{d['id']}] {d['asset_tipo']}.{d['campo']}: "
              f"warn={d['warning_value']}% alarm={d['alarm_value']}% "
              f"totale={d['campo_totale']}{inv}")


def ricalcola_allarmi(conn):
    """
    Ricalcola tutti gli allarmi usando soglie percentuali.
    Per ogni soglia:
    - Se is_percentage=1 e campo_totale: pct = valore/totale*100
    - Se is_percentage=1 e campo_totale=None: il campo è già una %
    - Se inverso=1: warn se pct < warning_value, alarm se pct < alarm_value
    - Se inverso=0: warn se pct >= warning_value, alarm se pct >= alarm_value
    """
    conn.execute("DELETE FROM alarms")
    thresholds = conn.execute("SELECT * FROM thresholds").fetchall()

    from datetime import datetime
    now = datetime.utcnow().isoformat()
    inseriti = 0

    for t in thresholds:
        t = dict(t)
        assets = conn.execute(
            "SELECT id FROM assets WHERE tipo=?", (t["asset_tipo"],)
        ).fetchall()

        for asset in assets:
            mon = conn.execute(
                "SELECT * FROM monitoraggio WHERE asset_id=?", (asset["id"],)
            ).fetchone()
            if not mon:
                continue
            mon = dict(mon)

            try:
                valore = mon.get(t["campo"])
                if valore is None:
                    continue
                valore = float(valore)
            except (KeyError, TypeError, ValueError):
                continue

            # Calcola percentuale
            if t["is_percentage"] and t["campo_totale"]:
                totale = mon.get(t["campo_totale"])
                if not totale or float(totale) == 0:
                    continue
                pct = (valore / float(totale)) * 100.0
            elif t["is_percentage"]:
                # Il campo è già una percentuale
                pct = valore
            else:
                # Confronto diretto (legacy)
                pct = valore

            # Determina livello
            livello = None
            if t.get("inverso"):
                # Basso = brutto: alarm se pct < alarm_value, warn se pct < warning_value
                if pct < float(t["alarm_value"]):
                    livello = "alarm"
                elif pct < float(t["warning_value"]):
                    livello = "warning"
            else:
                # Alto = brutto: alarm se pct >= alarm_value, warn se pct >= warning_value
                if pct >= float(t["alarm_value"]):
                    livello = "alarm"
                elif pct >= float(t["warning_value"]):
                    livello = "warning"

            if livello:
                conn.execute("""
                    INSERT INTO alarms (asset_id, campo, valore, livello, stato, created_at)
                    VALUES (?,?,?,?,?,?)
                """, (asset["id"], t["campo"], round(pct, 1), livello, livello, now))
                inseriti += 1

    conn.commit()
    print(f"Allarmi ricalcolati: {inseriti}")

    # Riepilogo per livello
    for livello in ("alarm", "warning"):
        n = conn.execute(
            "SELECT COUNT(*) FROM alarms WHERE livello=?", (livello,)
        ).fetchone()[0]
        print(f"  {livello}: {n}")


if __name__ == "__main__":
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    migra(conn)
    ricalcola_allarmi(conn)
    conn.close()
    print("\nMigrazione completata.")
