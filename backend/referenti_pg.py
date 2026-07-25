"""
referenti_pg.py — Gestione referenti asset per GAM

Tabelle:
  referenti        — anagrafica referente (nome, cognome, email, telefono, ruolo_default, note)
  asset_referenti  — relazione N:N tra asset e referenti (ruolo specifico per asset)

Ruoli supportati (is_obbligatorio = True per i primi 3):
  responsabile_asset       — ex campo legacy "referente" (obbligatorio)
  responsabile_manutenzione — coordina WO e contratti manutenzione (obbligatorio)
  responsabile_sicurezza   — RSPP / preposto D.Lgs. 81/08 (obbligatorio)
  facility_manager         — gestione integrata asset (facoltativo)
  responsabile_it          — infrastruttura tecnologica (facoltativo)
  responsabile_energia     — energy manager L. 10/91 (facoltativo)
  proprietario             — titolare immobile (facoltativo)
  locatore                 — referente contratto affitto (facoltativo)
  fornitore_manutenzione   — azienda esterna manutenzione (facoltativo)
  referente_legale         — ufficio legale / avvocato (facoltativo)
  referente_emergenze      — VVF / antincendio (facoltativo)
"""

import psycopg2
import psycopg2.extras
import random
from datetime import datetime
from typing import Optional

from fastapi import HTTPException, Depends
from pydantic import BaseModel

# ── Label leggibili per ruolo ────────────────────────────────────────────────
RUOLI_LABEL = {
    "responsabile_asset":        "Responsabile asset",
    "responsabile_manutenzione": "Responsabile manutenzione",
    "responsabile_sicurezza":    "Responsabile sicurezza",
    "facility_manager":          "Facility Manager",
    "responsabile_it":           "Responsabile IT",
    "responsabile_energia":      "Responsabile energia",
    "proprietario":              "Proprietario",
    "locatore":                  "Locatore",
    "fornitore_manutenzione":    "Fornitore manutenzione",
    "referente_legale":          "Referente legale",
    "referente_emergenze":       "Referente emergenze",
}

RUOLI_OBBLIGATORI = {
    "responsabile_asset",
    "responsabile_manutenzione",
    "responsabile_sicurezza",
}

# Ordine di visualizzazione
RUOLI_ORDINE = [
    "responsabile_asset",
    "responsabile_manutenzione",
    "responsabile_sicurezza",
    "facility_manager",
    "responsabile_it",
    "responsabile_energia",
    "proprietario",
    "locatore",
    "fornitore_manutenzione",
    "referente_legale",
    "referente_emergenze",
]


# ── Modelli Pydantic ─────────────────────────────────────────────────────────
class ReferenteCreate(BaseModel):
    nome: str
    cognome: str
    email: Optional[str] = None
    telefono: Optional[str] = None
    ruolo_default: Optional[str] = None
    note: Optional[str] = None


class ReferenteUpdate(BaseModel):
    nome: Optional[str] = None
    cognome: Optional[str] = None
    email: Optional[str] = None
    telefono: Optional[str] = None
    ruolo_default: Optional[str] = None
    note: Optional[str] = None


class AssetReferenteCreate(BaseModel):
    referente_id: int
    ruolo: str
    note: Optional[str] = None


class AssetReferenteUpdate(BaseModel):
    ruolo: Optional[str] = None
    note: Optional[str] = None


# ── Migrazione schema ────────────────────────────────────────────────────────
def migrate_referenti_schema(database_url: str):
    """Crea le tabelle referenti e asset_referenti se non esistono."""
    conn = psycopg2.connect(database_url)
    cur = conn.cursor()
    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS referenti (
                id            SERIAL PRIMARY KEY,
                nome          TEXT NOT NULL,
                cognome       TEXT NOT NULL,
                email         TEXT,
                telefono      TEXT,
                ruolo_default TEXT,
                note          TEXT,
                created_at    TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS asset_referenti (
                id           SERIAL PRIMARY KEY,
                asset_id     INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
                referente_id INTEGER NOT NULL REFERENCES referenti(id) ON DELETE CASCADE,
                ruolo        TEXT NOT NULL,
                note         TEXT,
                created_at   TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(asset_id, ruolo)
            );

            CREATE INDEX IF NOT EXISTS idx_asset_referenti_asset
                ON asset_referenti(asset_id);
            CREATE INDEX IF NOT EXISTS idx_asset_referenti_referente
                ON asset_referenti(referente_id);
        """)
        conn.commit()
        print("[referenti] Schema migrato OK")
    except Exception as e:
        conn.rollback()
        print(f"[referenti] Errore migrazione schema: {e}")
        raise
    finally:
        cur.close()
        conn.close()


# ── Seed dati demo ───────────────────────────────────────────────────────────
def seed_referenti(database_url: str):
    """
    Popola referenti demo e li associa agli asset esistenti.
    Idempotente: non reinserisce se i referenti esistono già.
    Migra anche il campo legacy assets.referente → responsabile_asset.
    """
    conn = psycopg2.connect(database_url)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        # Controlla se il seed è già stato eseguito
        cur.execute("SELECT COUNT(*) AS n FROM referenti")
        if cur.fetchone()["n"] > 0:
            print("[referenti] Seed già eseguito, skip.")
            conn.close()
            return

        # ── Pool di referenti condivisi ──────────────────────────────────────
        # Ogni referente può essere associato a più asset con ruoli diversi
        referenti_pool = [
            # (nome, cognome, email, telefono, ruolo_default, note)
            ("Marco",     "Ferretti",    "m.ferretti@abc.it",       "02-2456789",  "responsabile_asset",        "Responsabile impianti Nord"),
            ("Laura",     "Bianchi",     "l.bianchi@abc.it",        "011-3456789", "responsabile_asset",        "Responsabile impianti Torino"),
            ("Giorgio",   "Mancini",     "g.mancini@abc.it",        "030-5678901", "responsabile_asset",        "Responsabile impianti Brescia"),
            ("Carla",     "Esposito",    "c.esposito@abc.it",       "081-7654321", "responsabile_asset",        "Responsabile impianti Napoli"),
            ("Antonio",   "Russo",       "a.russo@abc.it",          "080-4567890", "responsabile_asset",        "Responsabile impianti Bari"),
            ("Alessia",   "Conti",       "a.conti@abc.it",          "06-12345678", "responsabile_asset",        "Responsabile sede Roma"),
            ("Luca",      "Marini",      "l.marini@abc.it",         "02-98765432", "responsabile_asset",        "Responsabile uffici Nord"),
            ("Sara",      "Gallo",       "s.gallo@abc.it",          "011-2345678", "responsabile_asset",        "Responsabile uffici Torino"),
            ("Paolo",     "Ricci",       "p.ricci@abc.it",          "051-3456789", "responsabile_asset",        "Responsabile uffici Bologna"),
            ("Giovanna",  "Sorrentino",  "g.sorrentino@abc.it",     "081-2345678", "responsabile_asset",        "Responsabile uffici Sud"),
            ("Francesco", "Lombardo",    "f.lombardo@abc.it",       "091-3456789", "responsabile_asset",        "Responsabile uffici Palermo"),
            ("Roberto",   "Fabbri",      "r.fabbri@abc.it",         "0523-456789", "responsabile_asset",        "Responsabile magazzini Nord"),
            ("Monica",    "Trentini",    "m.trentini@abc.it",       "045-5678901", "responsabile_asset",        "Responsabile magazzini NE"),
            ("Daniele",   "Moretti",     "d.moretti@abc.it",        "06-9876543",  "responsabile_asset",        "Responsabile magazzini Centro"),
            ("Salvatore", "Grasso",      "s.grasso@abc.it",         "095-4567890", "responsabile_asset",        "Responsabile magazzini Sicilia"),
            ("Elena",     "Marchetti",   "e.marchetti@abc.it",      "071-3456789", "responsabile_asset",        "Responsabile magazzini Ancona"),
            ("Maurizio",  "Colombo",     "m.colombo@abc.it",        "02-3456789",  "responsabile_asset",        "Responsabile depositi Nord"),
            ("Claudio",   "Ferrara",     "c.ferrara@abc.it",        "06-8765432",  "responsabile_asset",        "Responsabile depositi Centro"),
            ("Vincenzo",  "Marino",      "v.marino@abc.it",         "081-5678901", "responsabile_asset",        "Responsabile depositi Sud"),
            ("Paola",     "Sanna",       "p.sanna@abc.it",          "070-3456789", "responsabile_asset",        "Responsabile depositi Sardegna"),
            # Responsabili manutenzione (condivisi tra più asset)
            ("Stefano",   "Colombo",     "s.colombo.man@abc.it",    "02-1111222",  "responsabile_manutenzione", "RSPP e manutenzione Nord"),
            ("Federica",  "Neri",        "f.neri.man@abc.it",       "06-2222333",  "responsabile_manutenzione", "Manutenzione Centro-Sud"),
            ("Gianluca",  "Rossi",       "g.rossi.man@abc.it",      "081-3333444", "responsabile_manutenzione", "Manutenzione Sud Italia"),
            # Responsabili sicurezza (RSPP)
            ("Andrea",    "Vitale",      "a.vitale.rspp@abc.it",    "02-4444555",  "responsabile_sicurezza",    "RSPP Nord Italia"),
            ("Cristina",  "Ferraro",     "c.ferraro.rspp@abc.it",   "06-5555666",  "responsabile_sicurezza",    "RSPP Centro-Sud Italia"),
            # Facility Manager
            ("Matteo",    "Gentile",     "m.gentile.fm@abc.it",     "02-6666777",  "facility_manager",          "FM Nord Italia"),
            ("Silvia",    "Pellegrini",  "s.pellegrini.fm@abc.it",  "06-7777888",  "facility_manager",          "FM Centro-Sud Italia"),
            # Responsabili IT
            ("Davide",    "Coppola",     "d.coppola.it@abc.it",     "02-8888999",  "responsabile_it",           "IT Manager"),
            # Responsabili energia
            ("Enrico",    "Barbieri",    "e.barbieri.en@abc.it",    "02-9999000",  "responsabile_energia",      "Energy Manager certificato"),
            # Proprietario (unico per tutti gli asset demo)
            ("ABC",       "Holding SpA", "holding@abc.it",          "02-0000111",  "proprietario",              "Società capogruppo"),
        ]

        # Inserisci il pool di referenti
        ref_ids = []
        for r in referenti_pool:
            cur.execute("""
                INSERT INTO referenti (nome, cognome, email, telefono, ruolo_default, note)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
            """, r)
            ref_ids.append(cur.fetchone()["id"])

        # Mappa nome→id per i referenti condivisi
        # I primi 20 sono i responsabili_asset (uno per asset, in ordine ASS-0001..ASS-0020)
        # Dal 21° in poi sono i ruoli condivisi
        man_nord_id   = ref_ids[20]  # Stefano Colombo — manutenzione Nord
        man_centro_id = ref_ids[21]  # Federica Neri — manutenzione Centro-Sud
        man_sud_id    = ref_ids[22]  # Gianluca Rossi — manutenzione Sud
        rspp_nord_id  = ref_ids[23]  # Andrea Vitale — RSPP Nord
        rspp_sud_id   = ref_ids[24]  # Cristina Ferraro — RSPP Centro-Sud
        fm_nord_id    = ref_ids[25]  # Matteo Gentile — FM Nord
        fm_sud_id     = ref_ids[26]  # Silvia Pellegrini — FM Centro-Sud
        it_id         = ref_ids[27]  # Davide Coppola — IT
        en_id         = ref_ids[28]  # Enrico Barbieri — Energia
        prop_id       = ref_ids[29]  # ABC Holding SpA — Proprietario

        # Recupera gli asset in ordine codice
        cur.execute("SELECT id, codice, tipo FROM assets ORDER BY codice")
        assets = cur.fetchall()

        # Mappa codice→indice (0-based) per assegnare il responsabile_asset corretto
        codice_to_idx = {a["codice"]: i for i, a in enumerate(assets)}

        for asset in assets:
            aid   = asset["id"]
            codice = asset["codice"]
            tipo  = asset["tipo"]
            idx   = codice_to_idx.get(codice, 0)

            # Responsabile asset: uno per asset, in ordine
            resp_id = ref_ids[min(idx, 19)]

            # Manutenzione: Nord per stabilimenti/magazzini Nord, Sud per gli altri
            if tipo in ("stabilimento", "magazzino") and idx < 10:
                man_id = man_nord_id
            elif tipo in ("deposito", "ufficio") and idx < 10:
                man_id = man_nord_id
            else:
                man_id = man_centro_id if idx < 15 else man_sud_id

            # RSPP: Nord per asset nelle prime 10 posizioni, Sud per gli altri
            rspp_id = rspp_nord_id if idx < 10 else rspp_sud_id

            # FM: Nord per asset nelle prime 10 posizioni, Sud per gli altri
            fm_id = fm_nord_id if idx < 10 else fm_sud_id

            # Associazioni obbligatorie
            associazioni = [
                (aid, resp_id, "responsabile_asset",        None),
                (aid, man_id,  "responsabile_manutenzione", None),
                (aid, rspp_id, "responsabile_sicurezza",    None),
            ]

            # Associazioni facoltative (non tutti gli asset le hanno)
            # FM: solo uffici e stabilimenti
            if tipo in ("ufficio", "stabilimento"):
                associazioni.append((aid, fm_id, "facility_manager", None))

            # IT: solo uffici e sede centrale
            if tipo == "ufficio":
                associazioni.append((aid, it_id, "responsabile_it", None))

            # Energia: tutti gli asset con superficie > 5000 mq (grandi consumatori)
            # Per il demo: stabilimenti e magazzini grandi
            if tipo in ("stabilimento", "magazzino"):
                associazioni.append((aid, en_id, "responsabile_energia", None))

            # Proprietario: tutti gli asset
            associazioni.append((aid, prop_id, "proprietario", "ABC Holding SpA — proprietà diretta"))

            for assoc in associazioni:
                cur.execute("""
                    INSERT INTO asset_referenti (asset_id, referente_id, ruolo, note)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (asset_id, ruolo) DO NOTHING
                """, assoc)

        conn.commit()
        print(f"[referenti] Seed completato: {len(referenti_pool)} referenti, {len(assets)} asset associati.")

    except Exception as e:
        conn.rollback()
        print(f"[referenti] Errore seed: {e}")
        raise
    finally:
        cur.close()
        conn.close()


# ── Registrazione endpoint ───────────────────────────────────────────────────
def register_referenti_routes(app, get_db, get_utente_corrente, richiedi_permesso):
    """Registra tutti gli endpoint per la gestione referenti."""

    # ── GET /api/referenti — lista tutti i referenti (per il selettore) ──────
    @app.get("/api/referenti")
    def lista_referenti(db=Depends(get_db), _=Depends(get_utente_corrente)):
        """Lista tutti i referenti disponibili (per il selettore nella modale)."""
        rows = db.execute("""
            SELECT id, nome, cognome, email, telefono, ruolo_default, note
            FROM referenti
            ORDER BY cognome, nome
        """).fetchall()
        return [dict(r) for r in rows]

    # ── GET /api/referenti/{id} — dettaglio referente ────────────────────────
    @app.get("/api/referenti/{ref_id}")
    def dettaglio_referente(ref_id: int, db=Depends(get_db), _=Depends(get_utente_corrente)):
        row = db.execute(
            "SELECT * FROM referenti WHERE id=%s", (ref_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Referente non trovato")
        return dict(row)

    # ── POST /api/referenti — crea nuovo referente ───────────────────────────
    @app.post("/api/referenti", status_code=201)
    def crea_referente(
        payload: ReferenteCreate,
        db=Depends(get_db),
        _=Depends(richiedi_permesso("assets.update"))
    ):
        cur = db.execute("""
            INSERT INTO referenti (nome, cognome, email, telefono, ruolo_default, note)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (payload.nome, payload.cognome, payload.email,
              payload.telefono, payload.ruolo_default, payload.note))
        new_id = cur.fetchone()["id"]
        db.commit()
        return {"id": new_id, "messaggio": "Referente creato"}

    # ── PUT /api/referenti/{id} — modifica referente ─────────────────────────
    @app.put("/api/referenti/{ref_id}")
    def modifica_referente(
        ref_id: int,
        payload: ReferenteUpdate,
        db=Depends(get_db),
        _=Depends(richiedi_permesso("assets.update"))
    ):
        row = db.execute("SELECT id FROM referenti WHERE id=%s", (ref_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Referente non trovato")
        campi = {k: v for k, v in payload.dict().items() if v is not None}
        if not campi:
            raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
        set_clause = ", ".join(f"{k}=%s" for k in campi)
        db.execute(
            f"UPDATE referenti SET {set_clause} WHERE id=%s",
            (*campi.values(), ref_id)
        )
        db.commit()
        return {"messaggio": "Referente aggiornato"}

    # ── DELETE /api/referenti/{id} — elimina referente ───────────────────────
    @app.delete("/api/referenti/{ref_id}", status_code=204)
    def elimina_referente(
        ref_id: int,
        db=Depends(get_db),
        _=Depends(richiedi_permesso("assets.update"))
    ):
        row = db.execute("SELECT id FROM referenti WHERE id=%s", (ref_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Referente non trovato")
        db.execute("DELETE FROM referenti WHERE id=%s", (ref_id,))
        db.commit()
        return None

    # ── GET /api/assets/{id}/referenti — referenti di un asset ───────────────
    @app.get("/api/assets/{asset_id}/referenti")
    def lista_referenti_asset(
        asset_id: int,
        db=Depends(get_db),
        _=Depends(get_utente_corrente)
    ):
        """
        Restituisce i referenti associati all'asset, ordinati per ruolo.
        Include anche i ruoli non ancora assegnati (con referente null)
        per permettere alla UI di mostrare tutti gli slot.
        """
        asset = db.execute("SELECT id FROM assets WHERE id=%s", (asset_id,)).fetchone()
        if not asset:
            raise HTTPException(status_code=404, detail="Asset non trovato")

        # Referenti assegnati
        rows = db.execute("""
            SELECT
                ar.id          AS assoc_id,
                ar.ruolo,
                ar.note        AS assoc_note,
                r.id           AS referente_id,
                r.nome,
                r.cognome,
                r.email,
                r.telefono,
                r.note         AS referente_note
            FROM asset_referenti ar
            JOIN referenti r ON r.id = ar.referente_id
            WHERE ar.asset_id = %s
            ORDER BY ar.ruolo
        """, (asset_id,)).fetchall()

        # Costruisce mappa ruolo→dati
        assegnati = {r["ruolo"]: dict(r) for r in rows}

        # Restituisce tutti i ruoli nell'ordine canonico
        risultato = []
        for ruolo in RUOLI_ORDINE:
            if ruolo in assegnati:
                entry = assegnati[ruolo]
                entry["label"] = RUOLI_LABEL.get(ruolo, ruolo)
                entry["obbligatorio"] = ruolo in RUOLI_OBBLIGATORI
                risultato.append(entry)
            else:
                risultato.append({
                    "assoc_id": None,
                    "ruolo": ruolo,
                    "label": RUOLI_LABEL.get(ruolo, ruolo),
                    "obbligatorio": ruolo in RUOLI_OBBLIGATORI,
                    "referente_id": None,
                    "nome": None,
                    "cognome": None,
                    "email": None,
                    "telefono": None,
                    "assoc_note": None,
                    "referente_note": None,
                })
        return risultato

    # ── POST /api/assets/{id}/referenti — associa referente a asset ──────────
    @app.post("/api/assets/{asset_id}/referenti", status_code=201)
    def associa_referente(
        asset_id: int,
        payload: AssetReferenteCreate,
        db=Depends(get_db),
        _=Depends(richiedi_permesso("assets.update"))
    ):
        asset = db.execute("SELECT id FROM assets WHERE id=%s", (asset_id,)).fetchone()
        if not asset:
            raise HTTPException(status_code=404, detail="Asset non trovato")
        ref = db.execute("SELECT id FROM referenti WHERE id=%s", (payload.referente_id,)).fetchone()
        if not ref:
            raise HTTPException(status_code=404, detail="Referente non trovato")
        if payload.ruolo not in RUOLI_LABEL:
            raise HTTPException(status_code=400, detail=f"Ruolo non valido: {payload.ruolo}")

        # Upsert: se esiste già l'associazione per questo ruolo, aggiorna
        db.execute("""
            INSERT INTO asset_referenti (asset_id, referente_id, ruolo, note)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (asset_id, ruolo)
            DO UPDATE SET referente_id=%s, note=%s
        """, (asset_id, payload.referente_id, payload.ruolo, payload.note,
              payload.referente_id, payload.note))
        db.commit()
        return {"messaggio": "Referente associato"}

    # ── PUT /api/assets/{id}/referenti/{ruolo} — aggiorna associazione ────────
    @app.put("/api/assets/{asset_id}/referenti/{ruolo}")
    def aggiorna_referente_asset(
        asset_id: int,
        ruolo: str,
        payload: AssetReferenteUpdate,
        db=Depends(get_db),
        _=Depends(richiedi_permesso("assets.update"))
    ):
        row = db.execute(
            "SELECT id FROM asset_referenti WHERE asset_id=%s AND ruolo=%s",
            (asset_id, ruolo)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Associazione non trovata")
        campi = {k: v for k, v in payload.dict().items() if v is not None}
        if not campi:
            raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
        set_clause = ", ".join(f"{k}=%s" for k in campi)
        db.execute(
            f"UPDATE asset_referenti SET {set_clause} WHERE asset_id=%s AND ruolo=%s",
            (*campi.values(), asset_id, ruolo)
        )
        db.commit()
        return {"messaggio": "Associazione aggiornata"}

    # ── DELETE /api/assets/{id}/referenti/{ruolo} — rimuovi associazione ──────
    @app.delete("/api/assets/{asset_id}/referenti/{ruolo}", status_code=204)
    def rimuovi_referente_asset(
        asset_id: int,
        ruolo: str,
        db=Depends(get_db),
        _=Depends(richiedi_permesso("assets.update"))
    ):
        row = db.execute(
            "SELECT id FROM asset_referenti WHERE asset_id=%s AND ruolo=%s",
            (asset_id, ruolo)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Associazione non trovata")
        db.execute(
            "DELETE FROM asset_referenti WHERE asset_id=%s AND ruolo=%s",
            (asset_id, ruolo)
        )
        db.commit()
        return None

    print("[referenti] Endpoint referenti registrati OK")
