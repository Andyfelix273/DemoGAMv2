"""
GIS Asset Manager - Backend FastAPI
Versione: 2.1
Autore: Felix / KeyBiz

Endpoint:
  POST /auth/login              - login, restituisce JWT
  GET  /auth/me                 - profilo utente corrente

  GET  /api/assets              - lista asset in GeoJSON
  GET  /api/assets/{id}         - dettaglio asset + monitoraggio
  POST /api/assets              - crea asset (admin)
  PUT  /api/assets/{id}         - modifica asset (admin)
  DELETE /api/assets/{id}       - elimina asset (admin)

  GET  /api/stats               - KPI aggregati per dashboard
  GET  /api/thresholds          - lista soglie allarme
  PUT  /api/thresholds/{id}     - modifica soglia (admin)
  GET  /api/alarms              - lista allarmi attivi
  POST /api/alarms/{id}/ack     - acknowledge allarme (operator+)

  GET  /api/config              - configurazione applicazione
  PUT  /api/config              - aggiorna configurazione (admin)

  POST /api/assets/import       - import da Excel (admin)

Ruoli (dal meno al più privilegiato):
  viewer    - sola lettura su tutto
  operator  - lettura + acknowledge allarmi + gestione work order assegnati
  manager   - operator + documenti + scadenze + export report
  admin     - manager + CRUD asset/soglie/config + tutti i work order
  superadmin- admin + gestione utenti
"""

import os
import psycopg2
import psycopg2.extras
import io
import asyncio
import random
from datetime import datetime, timedelta, timezone, date
from typing import Optional

from fastapi import FastAPI, HTTPException, Depends, status, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, StreamingResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from jose import JWTError, jwt

# Workaround per compatibilità bcrypt/passlib su versioni Python recenti
import bcrypt
if not hasattr(bcrypt, "__about__"):
    bcrypt.__about__ = type('About', (object,), {'__version__': bcrypt.__version__})

from passlib.context import CryptContext

from pydantic import BaseModel
# ── Modulo Referenti ────────────────────────────────────────────────────────
from referenti_pg import (
    migrate_referenti_schema,
    seed_referenti,
    register_referenti_routes,
)

# ── Moduli Asset Efficiency (energy + occupancy) ─────────────────────────────
from energy_pg import (
    migrate_bems_studio_schema,
    migrate_energy_schema,
    seed_energy_meters,
    seed_energy_history,
    run_energy_simulator,
    register_energy_routes,
)
from occupancy_pg import (
    migrate_occupancy_schema,
    seed_occupancy_config,
    seed_occupancy_history,
    run_occupancy_simulator,
    register_occupancy_routes,
)

# ── Configurazione ──────────────────────────────────────────────────────────
SECRET_KEY  = "gis-asset-manager-secret-key-2026"
ALGORITHM   = "HS256"
TOKEN_EXPIRE_MINUTES = 480  # 8 ore

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://gamuser:gampassword@db:5432/gamdb")

# ── Controllo Cartelle Statiche ──────────────────────────────────────────────
# Assicura che la struttura delle cartelle statiche esista al primo avvio
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
SUBDIRS = ["css", "js", "img", "data", "pages"]

for sd in SUBDIRS:
    path = os.path.join(STATIC_DIR, sd)
    if not os.path.exists(path):
        os.makedirs(path, exist_ok=True)
        print(f"[setup] creata cartella: {path}")


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

app = FastAPI(title="GIS Asset Manager API", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Middleware: disabilita la cache del browser per i file HTML statici
class NoCacheHTMLMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.url.path.endswith(('.html', '.js', '.css')):
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
        return response

app.add_middleware(NoCacheHTMLMiddleware)


# ── Utilità database ─────────────────────────────────────────────────────────
class _CompatRow(dict):
    """Riga compatibile sia con accesso per chiave (dict) che per indice numerico (tuple)."""
    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


class _CompatCursor:
    """Cursore wrapper che restituisce _CompatRow invece di RealDictRow."""
    def __init__(self, cur):
        self._cur = cur

    def fetchone(self):
        row = self._cur.fetchone()
        return _CompatRow(row) if row is not None else None

    def fetchall(self):
        return [_CompatRow(r) for r in (self._cur.fetchall() or [])]

    def __iter__(self):
        return (_CompatRow(r) for r in self._cur)

    def __getattr__(self, name):
        return getattr(self._cur, name)


class _PgConnWrapper:
    """Wrapper che aggiunge .execute() e .row_factory compatibili con sqlite3.Row a una connessione psycopg2."""
    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql, params=None):
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if params:
            cur.execute(sql, params)
        else:
            cur.execute(sql)
        return _CompatCursor(cur)

    def cursor(self, **kwargs):
        return self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    def commit(self):
        return self._conn.commit()

    def rollback(self):
        return self._conn.rollback()

    def close(self):
        return self._conn.close()

    def __getattr__(self, name):
        return getattr(self._conn, name)


def get_db():
    conn = psycopg2.connect(DATABASE_URL)
    wrapper = _PgConnWrapper(conn)
    try:
        yield wrapper
    finally:
        conn.close()


# ── Modelli Pydantic ─────────────────────────────────────────────────────────
class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    role: str
    nome_completo: Optional[str] = None
    permissions: Optional[list] = None

class AssetCreate(BaseModel):
    codice: str
    nome: str
    tipo: str
    indirizzo: Optional[str] = None
    citta: Optional[str] = None
    provincia: Optional[str] = None
    cap: Optional[str] = None
    lat: float
    lon: float
    referente: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None
    superficie_mq: Optional[int] = None
    anno_costruzione: Optional[int] = None
    stato: Optional[str] = "attivo"
    note: Optional[str] = None

class AssetUpdate(BaseModel):
    nome: Optional[str] = None
    tipo: Optional[str] = None
    indirizzo: Optional[str] = None
    citta: Optional[str] = None
    provincia: Optional[str] = None
    cap: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    referente: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None
    superficie_mq: Optional[int] = None
    anno_costruzione: Optional[int] = None
    stato: Optional[str] = None
    note: Optional[str] = None

class ThresholdUpdate(BaseModel):
    warning_value: float
    alarm_value: float
    is_percentage: Optional[int] = None   # 1 = soglie in %, 0 = valore assoluto
    campo_totale: Optional[str] = None    # campo denominatore per il calcolo %
    inverso: Optional[int] = None         # 1 = basso è brutto (es. mezzi disponibili)

class ConfigUpdate(BaseModel):
    tema: Optional[str] = None
    lingua: Optional[str] = None
    rotte_marittime: Optional[str] = None

class DeadlineCreate(BaseModel):
    asset_id: int
    titolo: str
    descrizione: Optional[str] = None
    tipo: Optional[str] = "scadenza"
    data_scadenza: str
    priorita: Optional[str] = "media"
    assegnatario: Optional[str] = None
    note: Optional[str] = None

class DeadlineUpdate(BaseModel):
    titolo: Optional[str] = None
    descrizione: Optional[str] = None
    tipo: Optional[str] = None
    data_scadenza: Optional[str] = None
    stato: Optional[str] = None
    priorita: Optional[str] = None
    assegnatario: Optional[str] = None
    note: Optional[str] = None


# ── RBAC: dizionario centralizzato permessi per ruolo ────────────────────────
# Per aggiungere un nuovo permesso: aggiungerlo ai ruoli che devono averlo.
# Per aggiungere un nuovo ruolo: aggiungere una chiave con il set di permessi.
# I ruoli sono cumulativi (ogni ruolo include i permessi dei ruoli precedenti).

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "viewer": {
        "assets.read",
        "alarms.read",
        "work_orders.read",
        "documents.read",
        "deadlines.read",
        "reports.read",
        "settings.read",
        "planimetrie.read",
        "stats.read",
        "thresholds.read",
        "esg.read",
    },
    "operator": {
        "assets.read",
        "alarms.read",
        "alarms.acknowledge",
        "work_orders.read",
        "work_orders.create",
        "work_orders.update",
        "work_orders.close",
        "documents.read",
        "deadlines.read",
        "reports.read",
        "settings.read",
        "planimetrie.read",
        "stats.read",
        "thresholds.read",
        "esg.read",
    },
    "manager": {
        "assets.read",
        "alarms.read",
        "alarms.acknowledge",
        "work_orders.read",
        "work_orders.create",
        "work_orders.update",
        "work_orders.close",
        "work_orders.delete",
        "documents.read",
        "documents.upload",
        "documents.delete",
        "deadlines.read",
        "deadlines.create",
        "deadlines.update",
        "deadlines.delete",
        "reports.read",
        "reports.export",
        "settings.read",
        "planimetrie.read",
        "stats.read",
        "thresholds.read",
        "esg.read",
    },
    "admin": {
        "assets.read",
        "assets.create",
        "assets.update",
        "assets.delete",
        "assets.import",
        "alarms.read",
        "alarms.acknowledge",
        "work_orders.read",
        "work_orders.create",
        "work_orders.update",
        "work_orders.close",
        "work_orders.delete",
        "documents.read",
        "documents.upload",
        "documents.delete",
        "deadlines.read",
        "deadlines.create",
        "deadlines.update",
        "deadlines.delete",
        "reports.read",
        "reports.export",
        "settings.read",
        "settings.update",
        "planimetrie.read",
        "stats.read",
        "thresholds.read",
        "thresholds.update",
        "esg.read",
    },
    "superadmin": {
        "assets.read",
        "assets.create",
        "assets.update",
        "assets.delete",
        "assets.import",
        "alarms.read",
        "alarms.acknowledge",
        "work_orders.read",
        "work_orders.create",
        "work_orders.update",
        "work_orders.close",
        "work_orders.delete",
        "documents.read",
        "documents.upload",
        "documents.delete",
        "deadlines.read",
        "deadlines.create",
        "deadlines.update",
        "deadlines.delete",
        "reports.read",
        "reports.export",
        "settings.read",
        "settings.update",
        "planimetrie.read",
        "stats.read",
        "thresholds.read",
        "thresholds.update",
        "esg.read",
        "users.read",
        "users.create",
        "users.update",
        "users.delete",
    },
}

# Retrocompatibilità: 'user' è un alias di 'viewer' (ruolo legacy)
ROLE_PERMISSIONS["user"] = ROLE_PERMISSIONS["viewer"]


def ha_permesso(utente: dict, permesso: str) -> bool:
    """Verifica se l'utente ha il permesso specificato."""
    ruolo = utente.get("role", "viewer")
    return permesso in ROLE_PERMISSIONS.get(ruolo, set())


def richiedi_permesso(permesso: str):
    """Factory di dependency FastAPI: verifica il permesso e restituisce l'utente corrente.
    Uso: _=Depends(richiedi_permesso('assets.create'))
    """
    def _check(utente=Depends(get_utente_corrente)):
        if not ha_permesso(utente, permesso):
            raise HTTPException(
                status_code=403,
                detail=f"Permesso '{permesso}' richiesto per questa operazione"
            )
        return utente
    return _check


# ── Autenticazione JWT ───────────────────────────────────────────────────────
def crea_token(data: dict) -> str:
    payload = data.copy()
    payload["exp"] = datetime.now(timezone.utc) + timedelta(minutes=TOKEN_EXPIRE_MINUTES)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_utente_corrente(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        role     = payload.get("role")
        if not username:
            raise HTTPException(status_code=401, detail="Token non valido")
        return {"username": username, "role": role}
    except JWTError:
        raise HTTPException(status_code=401, detail="Token non valido o scaduto")


# Mantenuto per retrocompatibilità — usa richiedi_permesso() per nuovo codice
def richiedi_admin(utente=Depends(get_utente_corrente)):
    if not ha_permesso(utente, "settings.update"):
        raise HTTPException(status_code=403, detail="Accesso riservato agli amministratori")
    return utente


# ── Asset Efficiency: migrazione schema, seed dati, registrazione endpoint ────
# IMPORTANTE: deve essere a livello di modulo (non dentro startup event)
# perche FastAPI registra le route prima di avviare l'app.
migrate_bems_studio_schema(DATABASE_URL)
migrate_energy_schema(DATABASE_URL)
migrate_occupancy_schema(DATABASE_URL)
seed_energy_meters(DATABASE_URL)
seed_energy_history(DATABASE_URL, giorni=30)
seed_occupancy_config(DATABASE_URL)
seed_occupancy_history(DATABASE_URL, giorni=30)
register_energy_routes(app, get_db, get_utente_corrente)
register_occupancy_routes(app, get_db, get_utente_corrente)
print("[main] Asset Efficiency routes registered OK")

# ── Migrazione codice documents e deadlines ──────────────────────────────────────────
def _migrate_codice_documents_deadlines(database_url: str):
    """Aggiunge il campo codice a documents e deadlines se non esiste,
    e assegna un codice retroattivo ai record esistenti."""
    import psycopg2 as _pg
    conn = _pg.connect(database_url)
    cur = conn.cursor()
    try:
        # ─ documents ────────────────────────────────────────────────────────────────────────
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='documents' AND column_name='codice'")
        if not cur.fetchone():
            cur.execute("ALTER TABLE documents ADD COLUMN codice TEXT UNIQUE")
            # Assegna codici retroattivi ai record esistenti
            cur.execute("SELECT id, created_at FROM documents ORDER BY id")
            docs = cur.fetchall()
            for i, (doc_id, created_at) in enumerate(docs, 1):
                anno = created_at.year if created_at else 2026
                codice = f"DOC-{anno}-{i:04d}"
                cur.execute("UPDATE documents SET codice=%s WHERE id=%s", (codice, doc_id))
            print(f"[migrate] Campo codice aggiunto a documents ({len(docs)} record aggiornati)")
        # ─ deadlines ──────────────────────────────────────────────────────────────────────
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='deadlines' AND column_name='codice'")
        if not cur.fetchone():
            cur.execute("ALTER TABLE deadlines ADD COLUMN codice TEXT UNIQUE")
            cur.execute("SELECT id, created_at FROM deadlines ORDER BY id")
            dls = cur.fetchall()
            for i, (dl_id, created_at) in enumerate(dls, 1):
                anno = created_at.year if created_at else 2026
                codice = f"SCA-{anno}-{i:04d}"
                cur.execute("UPDATE deadlines SET codice=%s WHERE id=%s", (codice, dl_id))
            print(f"[migrate] Campo codice aggiunto a deadlines ({len(dls)} record aggiornati)")
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"[migrate] Errore migrazione codice: {e}")
    finally:
        cur.close()
        conn.close()

_migrate_codice_documents_deadlines(DATABASE_URL)

# ── Modulo Referenti ────────────────────────────────────────────────────────
migrate_referenti_schema(DATABASE_URL)
seed_referenti(DATABASE_URL)
register_referenti_routes(app, get_db, get_utente_corrente, richiedi_permesso)
print("[main] Referenti routes registered OK")


# ── Endpoint autenticazione ──────────────────────────────────────────────────
@app.post("/auth/login", response_model=TokenResponse)
def login(form: OAuth2PasswordRequestForm = Depends(), db=Depends(get_db)):
    utente = db.execute(
        "SELECT * FROM users WHERE username=%s", (form.username,)
    ).fetchone()
    if not utente or not pwd_context.verify(form.password, utente["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenziali non valide")
    ruolo = utente["role"]
    permessi = sorted(ROLE_PERMISSIONS.get(ruolo, set()))
    token = crea_token({"sub": utente["username"], "role": ruolo})
    return {
        "access_token": token,
        "token_type": "bearer",
        "role": ruolo,
        "nome_completo": utente["nome_completo"],
        "permissions": permessi
    }


@app.get("/auth/me")
def profilo(utente=Depends(get_utente_corrente), db=Depends(get_db)):
    row = db.execute(
        "SELECT username, role, nome_completo, email FROM users WHERE username=%s",
        (utente["username"],)
    ).fetchone()
    dati = dict(row)
    dati["permissions"] = sorted(ROLE_PERMISSIONS.get(dati["role"], set()))
    return dati


# ── Endpoint asset ───────────────────────────────────────────────────────────
@app.get("/api/assets")
def lista_assets(db=Depends(get_db), _=Depends(get_utente_corrente)):
    """
    Recupera la lista di tutti gli asset in formato GeoJSON FeatureCollection.
    Utilizzato dalla mappa Leaflet per renderizzare i marker.
    """
    rows = db.execute("SELECT * FROM assets ORDER BY codice").fetchall()
    features = []
    for r in rows:
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
            "properties": {k: r[k] for k in r.keys() if k not in ("lat", "lon")}
        })
    return {"type": "FeatureCollection", "features": features}


@app.get("/api/assets/{asset_id}")
def dettaglio_asset(asset_id: int, db=Depends(get_db), _=Depends(get_utente_corrente)):
    """
    Recupera i dettagli completi di un singolo asset, inclusi telemetria e KPI ESG.
    
    Args:
        asset_id (int): ID univoco dell'asset.
        
    Returns:
        dict: Dati completi dell'asset, telemetria corrente e metriche ESG.
        
    Raises:
        HTTPException (404): Se l'asset non viene trovato nel database.
    """
    asset = db.execute("SELECT * FROM assets WHERE id=%s", (asset_id,)).fetchone()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset non trovato")
    mon = db.execute(
        "SELECT * FROM monitoraggio WHERE asset_id=%s", (asset_id,)
    ).fetchone()
    allarmi = db.execute(
        "SELECT * FROM alarms WHERE asset_id=%s AND ack_at IS NULL ORDER BY created_at DESC",
        (asset_id,)
    ).fetchall()
    esg = db.execute(
        "SELECT * FROM esg WHERE asset_id=%s", (asset_id,)
    ).fetchone()
    return {
        "asset": dict(asset),
        "monitoraggio": dict(mon) if mon else {},
        "allarmi": [dict(a) for a in allarmi],
        "esg": dict(esg) if esg else {}
    }


@app.post("/api/assets", status_code=201)
def crea_asset(payload: AssetCreate, db=Depends(get_db), _=Depends(richiedi_permesso("assets.create"))):
    """Crea un nuovo asset (solo admin)."""
    try:
        cur = db.execute("""
            INSERT INTO assets
            (codice,nome,tipo,indirizzo,citta,provincia,cap,lat,lon,
             referente,telefono,email,superficie_mq,anno_costruzione,stato,note)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (payload.codice, payload.nome, payload.tipo, payload.indirizzo,
              payload.citta, payload.provincia, payload.cap, payload.lat, payload.lon,
              payload.referente, payload.telefono, payload.email,
              payload.superficie_mq, payload.anno_costruzione, payload.stato, payload.note))
        db.commit()
        return {"id": cur.fetchone()["id"], "messaggio": "Asset creato"}
    except psycopg2.errors.UniqueViolation:
        raise HTTPException(status_code=409, detail="Codice asset già esistente")


@app.put("/api/assets/{asset_id}")
def modifica_asset(asset_id: int, payload: AssetUpdate, db=Depends(get_db), _=Depends(richiedi_permesso("assets.update"))):
    """Modifica un asset esistente (solo admin)."""
    asset = db.execute("SELECT id FROM assets WHERE id=%s", (asset_id,)).fetchone()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset non trovato")
    campi = {k: v for k, v in payload.dict().items() if v is not None}
    if not campi:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    set_clause = ", ".join(f"{k}=%s" for k in campi)
    db.execute(f"UPDATE assets SET {set_clause} WHERE id=%s", (*campi.values(), asset_id))
    db.commit()
    return {"messaggio": "Asset aggiornato"}


@app.delete("/api/assets/{asset_id}")
def elimina_asset(asset_id: int, db=Depends(get_db), _=Depends(richiedi_permesso("assets.delete"))):
    """Elimina un asset (solo admin)."""
    asset = db.execute("SELECT id FROM assets WHERE id=%s", (asset_id,)).fetchone()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset non trovato")
    db.execute("DELETE FROM monitoraggio WHERE asset_id=%s", (asset_id,))
    db.execute("DELETE FROM alarms WHERE asset_id=%s", (asset_id,))
    db.execute("DELETE FROM assets WHERE id=%s", (asset_id,))
    db.commit()
    return {"messaggio": "Asset eliminato"}


# ── Endpoint ESG aggregato ──────────────────────────────────────────────────
@app.get("/api/stats/esg")
def statistiche_esg(db=Depends(get_db), _=Depends(get_utente_corrente)):
    """Restituisce KPI ESG aggregati per la panoramica operativa."""
    row = db.execute("""
        SELECT
            SUM(e.co2_totale_kg_giorno)      AS co2_tot_kg,
            AVG(e.consumo_kwh_giorno)         AS kwh_medio,
            SUM(e.consumo_kwh_giorno)         AS kwh_tot,
            AVG(e.consumo_m3_acqua_giorno)    AS m3_medio,
            SUM(e.consumo_m3_acqua_giorno)    AS m3_tot,
            COUNT(CASE WHEN e.rating_esg='A' THEN 1 END) AS rating_a,
            COUNT(CASE WHEN e.rating_esg='B' THEN 1 END) AS rating_b,
            COUNT(CASE WHEN e.rating_esg='C' THEN 1 END) AS rating_c,
            COUNT(CASE WHEN e.rating_esg='D' THEN 1 END) AS rating_d,
            COUNT(*) AS n_asset
        FROM esg e
    """).fetchone()
    if not row or not row["n_asset"]:
        return {}
    co2_anno_t = round((row["co2_tot_kg"] or 0) * 365 / 1000, 1)
    # Rating flotta: media ponderata A=4, B=3, C=2, D=1
    punteggio = (row["rating_a"]*4 + row["rating_b"]*3 + row["rating_c"]*2 + row["rating_d"]*1) / row["n_asset"]
    if punteggio >= 3.5:
        rating_flotta = "A"
    elif punteggio >= 2.5:
        rating_flotta = "B"
    elif punteggio >= 1.5:
        rating_flotta = "C"
    else:
        rating_flotta = "D"
    return {
        "co2_totale_kg_giorno": round(row["co2_tot_kg"] or 0, 1),
        "co2_anno_tonnellate": co2_anno_t,
        "kwh_medio_giorno": round(row["kwh_medio"] or 0, 1),
        "kwh_totale_giorno": round(row["kwh_tot"] or 0, 1),
        "m3_medio_giorno": round(row["m3_medio"] or 0, 2),
        "m3_totale_giorno": round(row["m3_tot"] or 0, 1),
        "rating_flotta": rating_flotta,
        "distribuzione_rating": {
            "A": row["rating_a"], "B": row["rating_b"],
            "C": row["rating_c"], "D": row["rating_d"]
        }
    }


# ── Endpoint statistiche ─────────────────────────────────────────────────────
@app.get("/api/stats")
def statistiche(db=Depends(get_db), _=Depends(get_utente_corrente)):
    """
    Calcola le statistiche aggregate per la dashboard operativa (HUD e pannello laterale).
    
    Aggrega i dati di tutti gli asset per fornire KPI globali: numero totale di asset,
    allarmi attivi, work orders aperti e stato di disponibilità dei mezzi.
    
    Returns:
        dict: Statistiche aggregate e KPI globali.
    """
    totale = db.execute("SELECT COUNT(*) FROM assets").fetchone()[0]
    per_tipo = {
        r["tipo"]: r["cnt"]
        for r in db.execute("SELECT tipo, COUNT(*) as cnt FROM assets GROUP BY tipo").fetchall()
    }

    # Legge soglie dal DB per i KPI principali (evita valori hardcoded)
    def get_soglie(tipo, campo):
        t = db.execute(
            "SELECT warning_value, alarm_value, inverso FROM thresholds WHERE asset_tipo=%s AND campo=%s",
            (tipo, campo)
        ).fetchone()
        if t:
            return {"soglia_warning": t["warning_value"], "soglia_alarm": t["alarm_value"],
                    "inverso": t["inverso"] or 0}
        return {"soglia_warning": 70.0, "soglia_alarm": 90.0, "inverso": 0}

    # KPI uffici: occupancy media (dipendenti/capienza * 100)
    uffici = db.execute("""
        SELECT AVG(CAST(m.dipendenti_presenti AS REAL)/m.capienza_massima*100) as occ
        FROM monitoraggio m JOIN assets a ON a.id=m.asset_id
        WHERE a.tipo='ufficio' AND m.capienza_massima > 0
    """).fetchone()
    s_uff = get_soglie('ufficio', 'dipendenti_presenti')
    occ_pct = round(uffici["occ"] or 0, 1)

    # KPI stabilimenti: linee attive / totali (percentuale)
    stab = db.execute("""
        SELECT SUM(m.linee_produzione_attive) as att, SUM(m.linee_produzione_totali) as tot
        FROM monitoraggio m JOIN assets a ON a.id=m.asset_id
        WHERE a.tipo='stabilimento'
    """).fetchone()
    s_stab = get_soglie('stabilimento', 'linee_produzione_attive')
    stab_att = int(stab["att"] or 0)
    stab_tot = int(stab["tot"] or 0)
    stab_pct = round((stab_att / stab_tot * 100) if stab_tot > 0 else 0, 1)

    # KPI magazzini: saturazione media (già %)
    mag = db.execute("""
        SELECT AVG(m.saturazione_stoccaggio_pct) as sat
        FROM monitoraggio m JOIN assets a ON a.id=m.asset_id
        WHERE a.tipo='magazzino' AND m.saturazione_stoccaggio_pct IS NOT NULL
    """).fetchone()
    s_mag = get_soglie('magazzino', 'saturazione_stoccaggio_pct')
    sat_pct = round(mag["sat"] or 0, 1)

    # KPI depositi: mezzi disponibili / totali (percentuale)
    dep = db.execute("""
        SELECT SUM(m.mezzi_disponibili) as disp, SUM(m.mezzi_totali) as tot
        FROM monitoraggio m JOIN assets a ON a.id=m.asset_id
        WHERE a.tipo='deposito'
    """).fetchone()
    s_dep = get_soglie('deposito', 'mezzi_disponibili')
    dep_disp = int(dep["disp"] or 0)
    dep_tot  = int(dep["tot"] or 0)
    dep_pct  = round((dep_disp / dep_tot * 100) if dep_tot > 0 else 0, 1)

    # Allarmi attivi
    allarmi_attivi = db.execute(
        "SELECT COUNT(*) FROM alarms WHERE ack_at IS NULL"
    ).fetchone()[0]
    allarmi_alarm = db.execute(
        "SELECT COUNT(*) FROM alarms WHERE livello='alarm' AND ack_at IS NULL"
    ).fetchone()[0]

    # Asset da monitorare (con allarmi attivi)
    da_monitorare = db.execute("""
        SELECT DISTINCT a.id, a.nome, a.tipo, a.citta,
               MAX(al.livello) as livello_max
        FROM alarms al JOIN assets a ON a.id=al.asset_id
        WHERE al.ack_at IS NULL
        GROUP BY a.id ORDER BY livello_max DESC LIMIT 5
    """).fetchall()

    return {
        "totale_asset": totale,
        "per_tipo": per_tipo,
        "kpi": {
            "uffici": {
                "label": "Occupancy uffici",
                "valore": occ_pct,
                "unita": "%",
                **s_uff
            },
            "stabilimenti": {
                "label": "Linee produzione attive",
                "valore": stab_att,
                "totale": stab_tot,
                "pct": stab_pct,
                "unita": "linee",
                **s_stab
            },
            "magazzini": {
                "label": "Saturazione stoccaggio",
                "valore": sat_pct,
                "unita": "%",
                **s_mag
            },
            "depositi": {
                "label": "Mezzi disponibili",
                "valore": dep_disp,
                "totale": dep_tot,
                "pct": dep_pct,
                "unita": "mezzi",
                **s_dep
            }
        },
        "allarmi": {
            "totale_attivi": allarmi_attivi,
            "livello_alarm": allarmi_alarm
        },
        "da_monitorare": [dict(r) for r in da_monitorare],
        "aggiornato_il": datetime.now().strftime("%d/%m/%Y %H:%M")
    }




# ── Funzione interna: ricalcolo allarmi ─────────────────────────────────────
def _ricalcola_allarmi_db(db):
    """
    Ricalcola tutti gli allarmi usando le soglie percentuali.
    - is_percentage=1 + campo_totale: pct = valore/totale*100
    - is_percentage=1 + campo_totale=None: il campo è già una percentuale
    - inverso=1: basso = brutto (alarm se pct < alarm_value)
    - inverso=0: alto = brutto (alarm se pct >= alarm_value)
    Il valore salvato in alarms.valore è sempre la percentuale calcolata.
    """
    db.execute("DELETE FROM alarms WHERE ack_at IS NULL")
    thresholds = db.execute("SELECT * FROM thresholds").fetchall()
    now = datetime.now().isoformat()
    for t in thresholds:
        t = dict(t)
        assets = db.execute(
            "SELECT id FROM assets WHERE tipo=%s", (t["asset_tipo"],)
        ).fetchall()
        for asset in assets:
            mon = db.execute(
                "SELECT * FROM monitoraggio WHERE asset_id=%s", (asset["id"],)
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
                pct = valore
            else:
                pct = valore
            # Determina livello
            livello = None
            if t.get("inverso"):
                if pct < float(t["alarm_value"]):
                    livello = "alarm"
                elif pct < float(t["warning_value"]):
                    livello = "warning"
            else:
                if pct >= float(t["alarm_value"]):
                    livello = "alarm"
                elif pct >= float(t["warning_value"]):
                    livello = "warning"
            if livello:
                db.execute("""
                    INSERT INTO alarms (asset_id, campo, valore, livello, stato, created_at)
                    VALUES (%s,%s,%s,%s,%s,%s)
                """, (asset["id"], t["campo"], round(pct, 1), livello, livello, now))
    db.commit()

# ── Endpoint soglie ──────────────────────────────────────────────────────────
@app.get("/api/thresholds")
def lista_soglie(db=Depends(get_db), _=Depends(get_utente_corrente)):
    rows = db.execute("SELECT * FROM thresholds ORDER BY asset_tipo, campo").fetchall()
    return [dict(r) for r in rows]


@app.put("/api/thresholds/{threshold_id}")
def modifica_soglia(threshold_id: int, payload: ThresholdUpdate,
                    db=Depends(get_db), _=Depends(richiedi_permesso("thresholds.update"))):
    soglia = db.execute("SELECT * FROM thresholds WHERE id=%s", (threshold_id,)).fetchone()
    if not soglia:
        raise HTTPException(status_code=404, detail="Soglia non trovata")
    # Per soglie inverse (basso = brutto) warning_value > alarm_value: non bloccare
    is_inv = payload.inverso if payload.inverso is not None else soglia["inverso"]
    if not is_inv and payload.warning_value >= payload.alarm_value:
        raise HTTPException(status_code=400, detail="Il valore warning deve essere inferiore all'alarm")
    if is_inv and payload.warning_value <= payload.alarm_value:
        raise HTTPException(status_code=400, detail="Per soglie inverse il warning deve essere superiore all'alarm")
    # Aggiorna solo i campi forniti
    is_pct = payload.is_percentage if payload.is_percentage is not None else soglia["is_percentage"]
    ct = payload.campo_totale if payload.campo_totale is not None else soglia["campo_totale"]
    inv = is_inv
    db.execute(
        "UPDATE thresholds SET warning_value=%s, alarm_value=%s, is_percentage=%s, campo_totale=%s, inverso=%s WHERE id=%s",
        (payload.warning_value, payload.alarm_value, is_pct, ct, inv, threshold_id)
    )
    db.commit()
    # Ricalcola allarmi dopo modifica soglia
    _ricalcola_allarmi_db(db)
    return {"messaggio": "Soglia aggiornata e allarmi ricalcolati"}


# ── Endpoint allarmi ─────────────────────────────────────────────────────────
@app.get("/api/alarms")
def lista_allarmi(db=Depends(get_db), _=Depends(get_utente_corrente)):
    rows = db.execute("""
        SELECT al.*, a.nome as asset_nome, a.tipo as asset_tipo, a.citta
        FROM alarms al JOIN assets a ON a.id=al.asset_id
        ORDER BY al.livello DESC, al.created_at DESC
    """).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/alarms/{alarm_id}/ack")
def acknowledge_allarme(alarm_id: int, db=Depends(get_db), _=Depends(richiedi_permesso("alarms.acknowledge"))):
    allarme = db.execute("SELECT id FROM alarms WHERE id=%s", (alarm_id,)).fetchone()
    if not allarme:
        raise HTTPException(status_code=404, detail="Allarme non trovato")
    db.execute(
        "UPDATE alarms SET ack_at=%s WHERE id=%s",
        (datetime.now().isoformat(), alarm_id)
    )
    db.commit()
    return {"messaggio": "Allarme confermato"}


# ── Endpoint configurazione ──────────────────────────────────────────────────
@app.get("/api/config")
def leggi_config(db=Depends(get_db), _=Depends(get_utente_corrente)):
    rows = db.execute("SELECT chiave, valore FROM config").fetchall()
    return {r["chiave"]: r["valore"] for r in rows}


@app.put("/api/config")
def aggiorna_config(payload: ConfigUpdate, db=Depends(get_db), _=Depends(richiedi_permesso("settings.update"))):
    campi = {k: v for k, v in payload.dict().items() if v is not None}
    for chiave, valore in campi.items():
        db.execute(
            "INSERT OR REPLACE INTO config (chiave, valore) VALUES (%s,%s)",
            (chiave, valore)
        )
    db.commit()
    return {"messaggio": "Configurazione aggiornata"}


# ── Endpoint import Excel ────────────────────────────────────────────────────
@app.post("/api/assets/import")
async def importa_excel(file: UploadFile = File(...),
                        db=Depends(get_db), _=Depends(richiedi_permesso("assets.import"))):
    """
    Importa asset da file Excel (.xlsx).
    Colonne attese: codice, nome, tipo, indirizzo, citta, provincia, cap,
                    lat, lon, referente, telefono, email,
                    superficie_mq, anno_costruzione, stato, note
    """
    try:
        import openpyxl
    except ImportError:
        raise HTTPException(status_code=500, detail="openpyxl non installato")

    contenuto = await file.read()
    wb = openpyxl.load_workbook(io.BytesIO(contenuto))
    ws = wb.active

    intestazioni = [cell.value for cell in ws[1]]
    campi_attesi = ["codice","nome","tipo","indirizzo","citta","provincia","cap",
                    "lat","lon","referente","telefono","email",
                    "superficie_mq","anno_costruzione","stato","note"]

    inseriti = 0
    aggiornati = 0
    errori = []

    for i, riga in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if not any(riga):
            continue
        dati = dict(zip(intestazioni, riga))
        try:
            codice = str(dati.get("codice", "")).strip()
            if not codice:
                errori.append(f"Riga {i}: codice mancante")
                continue
            esistente = db.execute(
                "SELECT id FROM assets WHERE codice=%s", (codice,)
            ).fetchone()
            if esistente:
                db.execute("""
                    UPDATE assets SET nome=%s,tipo=%s,indirizzo=%s,citta=%s,provincia=%s,cap=%s,
                    lat=%s,lon=%s,referente=%s,telefono=%s,email=%s,superficie_mq=%s,
                    anno_costruzione=%s,stato=%s,note=%s WHERE codice=%s
                """, (dati.get("nome"), dati.get("tipo"), dati.get("indirizzo"),
                      dati.get("citta"), dati.get("provincia"), dati.get("cap"),
                      dati.get("lat"), dati.get("lon"), dati.get("referente"),
                      dati.get("telefono"), dati.get("email"), dati.get("superficie_mq"),
                      dati.get("anno_costruzione"), dati.get("stato","attivo"),
                      dati.get("note"), codice))
                aggiornati += 1
            else:
                db.execute("""
                    INSERT INTO assets
                    (codice,nome,tipo,indirizzo,citta,provincia,cap,lat,lon,
                     referente,telefono,email,superficie_mq,anno_costruzione,stato,note)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """, (codice, dati.get("nome"), dati.get("tipo"), dati.get("indirizzo"),
                      dati.get("citta"), dati.get("provincia"), dati.get("cap"),
                      dati.get("lat"), dati.get("lon"), dati.get("referente"),
                      dati.get("telefono"), dati.get("email"), dati.get("superficie_mq"),
                      dati.get("anno_costruzione"), dati.get("stato","attivo"),
                      dati.get("note")))
                inseriti += 1
        except Exception as e:
            errori.append(f"Riga {i}: {str(e)}")

    db.commit()
    return {
        "inseriti": inseriti,
        "aggiornati": aggiornati,
        "errori": errori
    }


# ── Endpoint work order ────────────────────────────────────────────────────

class WorkOrderCreate(BaseModel):
    asset_id: int
    tipo: Optional[str] = "correttivo"
    priorita: Optional[str] = "media"
    titolo: str
    descrizione: Optional[str] = None
    assegnatario: Optional[str] = None
    allarme_id: Optional[int] = None
    data_pianificata: Optional[str] = None

class WorkOrderUpdate(BaseModel):
    tipo: Optional[str] = None
    priorita: Optional[str] = None
    stato: Optional[str] = None
    titolo: Optional[str] = None
    descrizione: Optional[str] = None
    assegnatario: Optional[str] = None
    data_pianificata: Optional[str] = None
    note_chiusura: Optional[str] = None


def _wo_row_to_dict(row) -> dict:
    """Converte una riga work_order in dict con campi asset inclusi."""
    d = dict(row)
    return d


@app.get("/api/assets/{asset_id}/work-orders")
def work_orders_per_asset(asset_id: int, db=Depends(get_db), _=Depends(richiedi_permesso("work_orders.read"))):
    """Restituisce i work order di un singolo asset, ordinati per data apertura decrescente."""
    rows = db.execute("""
        SELECT wo.*,
               a.nome   AS asset_nome,
               a.tipo   AS asset_tipo,
               a.citta  AS asset_citta
        FROM work_orders wo
        JOIN assets a ON a.id = wo.asset_id
        WHERE wo.asset_id = %s
        ORDER BY wo.data_apertura DESC
    """, (asset_id,)).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/assets/{asset_id}/deadlines")
def deadlines_per_asset(asset_id: int, db=Depends(get_db), _=Depends(richiedi_permesso("deadlines.read"))):
    """Restituisce le scadenze di un singolo asset, ordinate per data scadenza."""
    rows = db.execute("""
        SELECT * FROM deadlines
        WHERE asset_id = %s
        ORDER BY data_scadenza ASC
    """, (asset_id,)).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/work-orders")
def lista_work_orders(
    stato: Optional[str] = None,
    tipo: Optional[str] = None,
    priorita: Optional[str] = None,
    asset_id: Optional[int] = None,
    db=Depends(get_db),
    _=Depends(richiedi_permesso("work_orders.read"))
):
    """Lista work order con filtri opzionali e join con assets."""
    query = """
        SELECT wo.*,
               a.nome   AS asset_nome,
               a.tipo   AS asset_tipo,
               a.citta  AS asset_citta
        FROM work_orders wo
        JOIN assets a ON a.id = wo.asset_id
        WHERE 1=1
    """
    params = []
    if stato:
        query += " AND wo.stato = %s"
        params.append(stato)
    if tipo:
        query += " AND wo.tipo = %s"
        params.append(tipo)
    if priorita:
        query += " AND wo.priorita = %s"
        params.append(priorita)
    if asset_id:
        query += " AND wo.asset_id = %s"
        params.append(asset_id)
    query += " ORDER BY wo.data_apertura DESC"
    rows = db.execute(query, params).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/work-orders/stats")
def stats_work_orders(db=Depends(get_db), _=Depends(richiedi_permesso("work_orders.read"))):
    """KPI aggregati work order per la dashboard."""
    from datetime import date
    oggi = date.today().isoformat()
    rows = db.execute("""
        SELECT
            COUNT(*) FILTER (WHERE stato = 'aperto')                          AS aperti,
            COUNT(*) FILTER (WHERE stato = 'in_corso')                        AS in_corso,
            COUNT(*) FILTER (WHERE stato = 'completato')                      AS completati,
            COUNT(*) FILTER (WHERE stato = 'annullato')                       AS annullati,
            COUNT(*) FILTER (WHERE stato NOT IN ('completato','annullato')
                             AND data_pianificata IS NOT NULL
                             AND data_pianificata < %s)                        AS scaduti,
            COUNT(*) FILTER (WHERE stato NOT IN ('completato','annullato')
                             AND priorita IN ('alta','critica'))               AS urgenti
        FROM work_orders
    """, (oggi,)).fetchone()
    return dict(rows)


@app.get("/api/work-orders/{wo_id}")
def dettaglio_work_order(wo_id: int, db=Depends(get_db), _=Depends(richiedi_permesso("work_orders.read"))):
    row = db.execute("""
        SELECT wo.*, a.nome AS asset_nome, a.tipo AS asset_tipo, a.citta AS asset_citta
        FROM work_orders wo JOIN assets a ON a.id = wo.asset_id
        WHERE wo.id = %s
    """, (wo_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Work order non trovato")
    return dict(row)


@app.post("/api/work-orders", status_code=201)
def crea_work_order(
    payload: WorkOrderCreate,
    db=Depends(get_db),
    utente=Depends(richiedi_permesso("work_orders.create"))
):
    # Genera codice progressivo
    ultimo = db.execute("SELECT codice FROM work_orders ORDER BY id DESC LIMIT 1").fetchone()
    if ultimo:
        try:
            n = int(ultimo["codice"].split("-")[1]) + 1
        except (IndexError, ValueError):
            n = 1
    else:
        n = 1
    codice = f"WO-{n:04d}"
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db.execute("""
        INSERT INTO work_orders
        (codice, asset_id, tipo, priorita, stato, titolo, descrizione,
         assegnatario, allarme_id, data_apertura, data_pianificata, creato_da)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """, (
        codice,
        payload.asset_id,
        payload.tipo or "correttivo",
        payload.priorita or "media",
        "aperto",
        payload.titolo,
        payload.descrizione,
        payload.assegnatario,
        payload.allarme_id,
        now,
        payload.data_pianificata,
        utente["username"]
    ))
    db.commit()
    wo_id = db.execute("SELECT id FROM work_orders WHERE codice=%s", (codice,)).fetchone()[0]
    return dettaglio_work_order(wo_id, db, utente)


@app.put("/api/work-orders/{wo_id}")
def aggiorna_work_order(
    wo_id: int,
    payload: WorkOrderUpdate,
    db=Depends(get_db),
    utente=Depends(richiedi_permesso("work_orders.update"))
):
    wo = db.execute("SELECT * FROM work_orders WHERE id=%s", (wo_id,)).fetchone()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order non trovato")

    campi = {k: v for k, v in payload.dict().items() if v is not None}
    if not campi:
        return dettaglio_work_order(wo_id, db, utente)

    # Se si chiude il WO, imposta data_chiusura
    if campi.get("stato") in ("completato", "annullato") and not wo["data_chiusura"]:
        campi["data_chiusura"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    set_clause = ", ".join(f"{k}=%s" for k in campi)
    values = list(campi.values()) + [wo_id]
    db.execute(f"UPDATE work_orders SET {set_clause} WHERE id=%s", values)
    db.commit()
    return dettaglio_work_order(wo_id, db, utente)


@app.delete("/api/work-orders/{wo_id}", status_code=204)
def elimina_work_order(
    wo_id: int,
    db=Depends(get_db),
    _=Depends(richiedi_permesso("work_orders.delete"))
):
    wo = db.execute("SELECT id FROM work_orders WHERE id=%s", (wo_id,)).fetchone()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order non trovato")
    db.execute("DELETE FROM work_orders WHERE id=%s", (wo_id,))
    db.commit()
    return None


# ── Documenti allegati agli asset ──────────────────────────────────────────
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

from fastapi.responses import FileResponse

@app.get("/api/documents")
def lista_documenti_globale(
    asset_id: int = None,
    tipo: str = None,
    anno: int = None,
    caricato_da: str = None,
    q: str = None,
    limit: int = 200,
    offset: int = 0,
    db=Depends(get_db),
    _=Depends(richiedi_permesso("documents.read"))
):
    """Lista globale documenti con filtri opzionali."""
    sql = """
        SELECT d.*, a.codice AS asset_codice, a.nome AS asset_nome, a.tipo AS asset_tipo
        FROM documents d
        LEFT JOIN assets a ON a.id = d.asset_id
        WHERE 1=1
    """
    params = []
    if asset_id:
        sql += " AND d.asset_id = %s"; params.append(asset_id)
    if tipo:
        sql += " AND d.tipo_mime ILIKE %s"; params.append(f"%{tipo}%")
    if anno:
        sql += " AND d.codice LIKE %s"; params.append(f"DOC-{anno}-%")
    if caricato_da:
        sql += " AND d.caricato_da ILIKE %s"; params.append(f"%{caricato_da}%")
    if q:
        sql += " AND (d.nome_file ILIKE %s OR d.codice ILIKE %s)"
        params.extend([f"%{q}%", f"%{q}%"])
    sql += " ORDER BY d.created_at DESC LIMIT %s OFFSET %s"
    params.extend([limit, offset])
    rows = db.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/documents/stats")
def stats_documenti(
    db=Depends(get_db),
    _=Depends(richiedi_permesso("documents.read"))
):
    """Statistiche globali documenti."""
    totale = db.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
    questo_mese = db.execute(
        "SELECT COUNT(*) FROM documents WHERE created_at >= date_trunc('month', now())"
    ).fetchone()[0]
    asset_con_docs = db.execute(
        "SELECT COUNT(DISTINCT asset_id) FROM documents"
    ).fetchone()[0]
    anni = db.execute(
        "SELECT DISTINCT EXTRACT(YEAR FROM created_at)::int AS anno FROM documents ORDER BY anno DESC"
    ).fetchall()
    caricatori = db.execute(
        "SELECT DISTINCT caricato_da FROM documents WHERE caricato_da IS NOT NULL ORDER BY caricato_da"
    ).fetchall()
    return {
        "totale": totale,
        "questo_mese": questo_mese,
        "asset_con_docs": asset_con_docs,
        "anni": [r[0] for r in anni],
        "caricatori": [r[0] for r in caricatori],
    }


@app.get("/api/assets/{asset_id}/documents")
def lista_documenti(asset_id: int, db=Depends(get_db), _=Depends(richiedi_permesso("documents.read"))):
    """Lista documenti allegati a un asset."""
    rows = db.execute(
        "SELECT * FROM documents WHERE asset_id=%s ORDER BY created_at DESC",
        (asset_id,)
    ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/assets/{asset_id}/documents", status_code=201)
async def carica_documento(
    asset_id: int,
    file: UploadFile = File(...),
    db=Depends(get_db),
    utente=Depends(richiedi_permesso("documents.upload"))
):
    """Carica un documento allegato a un asset."""
    asset = db.execute("SELECT id FROM assets WHERE id=%s", (asset_id,)).fetchone()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset non trovato")

    # Sanitizza il nome file
    import re
    nome_sicuro = re.sub(r'[^\w.\-]', '_', file.filename or "documento")
    # Aggiungi timestamp per evitare collisioni
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    nome_finale = f"{asset_id}_{ts}_{nome_sicuro}"
    percorso = os.path.join(UPLOAD_DIR, nome_finale)

    contenuto = await file.read()
    with open(percorso, "wb") as f:
        f.write(contenuto)

    # Genera codice progressivo DOC-YYYY-NNNN
    anno = datetime.now().year
    ultimo_doc = db.execute(
        "SELECT codice FROM documents WHERE codice LIKE %s ORDER BY id DESC LIMIT 1",
        (f"DOC-{anno}-%",)
    ).fetchone()
    if ultimo_doc:
        try:
            n_doc = int(ultimo_doc["codice"].split("-")[2]) + 1
        except (IndexError, ValueError):
            n_doc = 1
    else:
        n_doc = 1
    codice_doc = f"DOC-{anno}-{n_doc:04d}"

    db.execute(
        "INSERT INTO documents (asset_id, nome_file, tipo_mime, dimensione, percorso, caricato_da, codice) VALUES (%s,%s,%s,%s,%s,%s,%s)",
        (asset_id, file.filename, file.content_type, len(contenuto), nome_finale, utente["username"], codice_doc)
    )
    db.commit()
    row = db.execute("SELECT * FROM documents WHERE asset_id=%s AND nome_file=%s ORDER BY id DESC LIMIT 1", (asset_id, file.filename)).fetchone()
    return dict(row)


@app.get("/api/documents/{doc_id}/download")
def scarica_documento(doc_id: int, db=Depends(get_db), _=Depends(richiedi_permesso("documents.read"))):
    """Scarica un documento per ID."""
    row = db.execute("SELECT * FROM documents WHERE id=%s", (doc_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Documento non trovato")
    percorso = os.path.join(UPLOAD_DIR, row["percorso"])
    if not os.path.exists(percorso):
        raise HTTPException(status_code=404, detail="File non trovato sul server")
    return FileResponse(
        path=percorso,
        filename=row["nome_file"],
        media_type=row["tipo_mime"] or "application/octet-stream"
    )


@app.delete("/api/documents/{doc_id}", status_code=204)
def elimina_documento(doc_id: int, db=Depends(get_db), _=Depends(richiedi_permesso("documents.delete"))):
    """Elimina un documento."""
    row = db.execute("SELECT * FROM documents WHERE id=%s", (doc_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Documento non trovato")
    percorso = os.path.join(UPLOAD_DIR, row["percorso"])
    if os.path.exists(percorso):
        os.remove(percorso)
    db.execute("DELETE FROM documents WHERE id=%s", (doc_id,))
    db.commit()
    return None


# ── Scadenze ───────────────────────────────────────────────────────────────

@app.get("/api/deadlines")
def lista_scadenze(
    stato: Optional[str] = None,
    tipo: Optional[str] = None,
    priorita: Optional[str] = None,
    asset_id: Optional[int] = None,
    db=Depends(get_db),
    _=Depends(richiedi_permesso("deadlines.read"))
):
    """Lista scadenze con filtri opzionali e join con assets."""
    query = """
        SELECT d.*, a.nome AS asset_nome, a.tipo AS asset_tipo, a.citta AS asset_citta
        FROM deadlines d
        JOIN assets a ON a.id = d.asset_id
        WHERE 1=1
    """
    params = []
    if stato:
        query += " AND d.stato = %s"
        params.append(stato)
    if tipo:
        query += " AND d.tipo = %s"
        params.append(tipo)
    if priorita:
        query += " AND d.priorita = %s"
        params.append(priorita)
    if asset_id:
        query += " AND d.asset_id = %s"
        params.append(asset_id)
    query += " ORDER BY d.data_scadenza ASC"
    rows = db.execute(query, params).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/deadlines/stats")
def stats_scadenze(db=Depends(get_db), _=Depends(richiedi_permesso("deadlines.read"))):
    """KPI aggregati scadenze."""
    from datetime import date
    oggi = date.today().isoformat()
    rows = db.execute("""
        SELECT
            COUNT(*) FILTER (WHERE stato = 'aperta')                              AS aperte,
            COUNT(*) FILTER (WHERE stato = 'chiusa')                              AS chiuse,
            COUNT(*) FILTER (WHERE stato = 'scaduta')                             AS scadute,
            COUNT(*) FILTER (WHERE stato = 'aperta' AND data_scadenza < %s)        AS in_ritardo,
            COUNT(*) FILTER (WHERE stato = 'aperta'
                             AND data_scadenza BETWEEN %s AND (%s::date + interval '7 days'))   AS in_scadenza_7gg,
            COUNT(*) FILTER (WHERE stato NOT IN ('chiusa') AND priorita IN ('alta','critica')) AS urgenti
        FROM deadlines
    """, (oggi, oggi, oggi)).fetchone()
    return dict(rows)


@app.get("/api/deadlines/{dl_id}")
def dettaglio_scadenza(dl_id: int, db=Depends(get_db), _=Depends(richiedi_permesso("deadlines.read"))):
    row = db.execute("""
        SELECT d.*, a.nome AS asset_nome, a.tipo AS asset_tipo, a.citta AS asset_citta
        FROM deadlines d JOIN assets a ON a.id = d.asset_id
        WHERE d.id = %s
    """, (dl_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Scadenza non trovata")
    return dict(row)


@app.post("/api/deadlines", status_code=201)
def crea_scadenza(
    payload: DeadlineCreate,
    db=Depends(get_db),
    utente=Depends(richiedi_permesso("deadlines.create"))
):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    # Genera codice progressivo SCA-YYYY-NNNN
    anno = datetime.now().year
    ultimo_sca = db.execute(
        "SELECT codice FROM deadlines WHERE codice LIKE %s ORDER BY id DESC LIMIT 1",
        (f"SCA-{anno}-%",)
    ).fetchone()
    if ultimo_sca:
        try:
            n_sca = int(ultimo_sca["codice"].split("-")[2]) + 1
        except (IndexError, ValueError):
            n_sca = 1
    else:
        n_sca = 1
    codice_sca = f"SCA-{anno}-{n_sca:04d}"
    db.execute("""
        INSERT INTO deadlines
        (asset_id, titolo, descrizione, tipo, data_scadenza, stato, priorita, assegnatario, note, creato_da, created_at, codice)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """, (
        payload.asset_id, payload.titolo, payload.descrizione,
        payload.tipo or "scadenza", payload.data_scadenza, "aperta",
        payload.priorita or "media", payload.assegnatario, payload.note,
        utente["username"], now, codice_sca
    ))
    db.commit()
    row = db.execute("SELECT id FROM deadlines WHERE asset_id=%s AND titolo=%s ORDER BY id DESC LIMIT 1", (payload.asset_id, payload.titolo)).fetchone()
    dl_id = row[0]
    return dettaglio_scadenza(dl_id, db, utente)


@app.put("/api/deadlines/{dl_id}")
def aggiorna_scadenza(
    dl_id: int,
    payload: DeadlineUpdate,
    db=Depends(get_db),
    utente=Depends(richiedi_permesso("deadlines.update"))
):
    dl = db.execute("SELECT * FROM deadlines WHERE id=%s", (dl_id,)).fetchone()
    if not dl:
        raise HTTPException(status_code=404, detail="Scadenza non trovata")
    campi = {k: v for k, v in payload.dict().items() if v is not None}
    if not campi:
        return dettaglio_scadenza(dl_id, db, utente)
    if campi.get("stato") == "chiusa" and not dl["closed_at"]:
        campi["closed_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    set_clause = ", ".join(f"{k}=%s" for k in campi)
    values = list(campi.values()) + [dl_id]
    db.execute(f"UPDATE deadlines SET {set_clause} WHERE id=%s", values)
    db.commit()
    return dettaglio_scadenza(dl_id, db, utente)


@app.delete("/api/deadlines/{dl_id}", status_code=204)
def elimina_scadenza(
    dl_id: int,
    db=Depends(get_db),
    _=Depends(richiedi_permesso("deadlines.delete"))
):
    dl = db.execute("SELECT id FROM deadlines WHERE id=%s", (dl_id,)).fetchone()
    if not dl:
        raise HTTPException(status_code=404, detail="Scadenza non trovata")
    db.execute("DELETE FROM deadlines WHERE id=%s", (dl_id,))
    db.commit()
    return None


# ── Export Report ───────────────────────────────────────────────────────────────

@app.get("/api/export/assets/excel")
def export_assets_excel(
    db=Depends(get_db),
    _=Depends(richiedi_permesso("assets.read"))
):
    """Export anagrafica asset in formato Excel."""
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Anagrafica Asset"

    # Stile intestazione
    hdr_fill = PatternFill("solid", fgColor="1A2B4A")
    hdr_font = Font(bold=True, color="FFFFFF", size=11)
    thin = Side(style="thin", color="CCCCCC")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    headers = ["Codice", "Nome", "Tipo", "Indirizzo", "Citta", "Provincia",
               "CAP", "Stato", "Superficie (mq)", "Anno costruzione",
               "Referente", "Telefono", "Email", "Lat", "Lon", "Note"]
    col_widths = [12, 35, 15, 30, 20, 10, 8, 15, 14, 16, 25, 15, 30, 10, 10, 40]

    for ci, (h, w) in enumerate(zip(headers, col_widths), 1):
        cell = ws.cell(row=1, column=ci, value=h)
        cell.font = hdr_font
        cell.fill = hdr_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border
        ws.column_dimensions[get_column_letter(ci)].width = w
    ws.row_dimensions[1].height = 22

    rows = db.execute("SELECT * FROM assets ORDER BY codice").fetchall()
    for ri, row in enumerate(rows, 2):
        vals = [row["codice"], row["nome"], row["tipo"], row["indirizzo"],
                row["citta"], row["provincia"], row["cap"], row["stato"],
                row["superficie_mq"], row["anno_costruzione"],
                row["referente"], row["telefono"], row["email"],
                row["lat"], row["lon"], row["note"]]
        for ci, v in enumerate(vals, 1):
            cell = ws.cell(row=ri, column=ci, value=v)
            cell.border = border
            if ri % 2 == 0:
                cell.fill = PatternFill("solid", fgColor="F5F7FA")

    ws.auto_filter.ref = ws.dimensions
    ws.freeze_panes = "A2"

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"asset_export_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@app.get("/api/export/workorders/excel")
def export_workorders_excel(
    db=Depends(get_db),
    _=Depends(richiedi_permesso("work_orders.read"))
):
    """Export work order in formato Excel."""
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Work Order"

    hdr_fill = PatternFill("solid", fgColor="1A2B4A")
    hdr_font = Font(bold=True, color="FFFFFF", size=11)
    thin = Side(style="thin", color="CCCCCC")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    headers = ["Codice", "Titolo", "Asset", "Tipo", "Priorita", "Stato",
               "Assegnatario", "Data apertura", "Data pianificata", "Data chiusura",
               "Descrizione", "Note chiusura"]
    col_widths = [12, 35, 30, 15, 10, 15, 25, 14, 14, 14, 40, 30]

    for ci, (h, w) in enumerate(zip(headers, col_widths), 1):
        cell = ws.cell(row=1, column=ci, value=h)
        cell.font = hdr_font
        cell.fill = hdr_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border
        ws.column_dimensions[get_column_letter(ci)].width = w
    ws.row_dimensions[1].height = 22

    rows = db.execute("""
        SELECT wo.*, a.nome AS asset_nome
        FROM work_orders wo
        LEFT JOIN assets a ON a.id = wo.asset_id
        ORDER BY wo.data_apertura DESC
    """).fetchall()
    for ri, row in enumerate(rows, 2):
        vals = [row["codice"], row["titolo"], row["asset_nome"], row["tipo"],
                row["priorita"], row["stato"], row["assegnatario"],
                row["data_apertura"], row["data_pianificata"], row["data_chiusura"],
                row["descrizione"], row["note_chiusura"]]
        for ci, v in enumerate(vals, 1):
            cell = ws.cell(row=ri, column=ci, value=v)
            cell.border = border
            if ri % 2 == 0:
                cell.fill = PatternFill("solid", fgColor="F5F7FA")

    ws.auto_filter.ref = ws.dimensions
    ws.freeze_panes = "A2"

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"workorders_export_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@app.get("/api/export/deadlines/excel")
def export_deadlines_excel(
    db=Depends(get_db),
    _=Depends(richiedi_permesso("deadlines.read"))
):
    """Export scadenze in formato Excel."""
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Scadenze"

    hdr_fill = PatternFill("solid", fgColor="1A2B4A")
    hdr_font = Font(bold=True, color="FFFFFF", size=11)
    thin = Side(style="thin", color="CCCCCC")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    headers = ["ID", "Asset", "Titolo", "Tipo", "Priorita", "Stato",
               "Data scadenza", "Assegnatario", "Descrizione", "Creato da", "Creato il"]
    col_widths = [6, 30, 35, 15, 10, 12, 14, 25, 40, 15, 18]

    for ci, (h, w) in enumerate(zip(headers, col_widths), 1):
        cell = ws.cell(row=1, column=ci, value=h)
        cell.font = hdr_font
        cell.fill = hdr_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border
        ws.column_dimensions[get_column_letter(ci)].width = w
    ws.row_dimensions[1].height = 22

    rows = db.execute("""
        SELECT d.*, a.nome AS asset_nome
        FROM deadlines d JOIN assets a ON a.id = d.asset_id
        ORDER BY d.data_scadenza ASC
    """).fetchall()
    for ri, row in enumerate(rows, 2):
        vals = [row["id"], row["asset_nome"], row["titolo"], row["tipo"],
                row["priorita"], row["stato"], row["data_scadenza"],
                row["assegnatario"], row["descrizione"],
                row["creato_da"], row["created_at"]]
        for ci, v in enumerate(vals, 1):
            cell = ws.cell(row=ri, column=ci, value=v)
            cell.border = border
            if ri % 2 == 0:
                cell.fill = PatternFill("solid", fgColor="F5F7FA")

    ws.auto_filter.ref = ws.dimensions
    ws.freeze_panes = "A2"

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"scadenze_export_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@app.get("/api/export/report/pdf")
def export_report_pdf(
    db=Depends(get_db),
    _=Depends(richiedi_permesso("assets.read"))
):
    """Export report riepilogativo PDF con KPI asset, work order e scadenze."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    from datetime import date

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=2*cm, rightMargin=2*cm,
                            topMargin=2*cm, bottomMargin=2*cm)
    styles = getSampleStyleSheet()
    story = []

    # Stili personalizzati
    title_style = ParagraphStyle('Title2', parent=styles['Title'],
                                  fontSize=20, textColor=colors.HexColor('#1A2B4A'),
                                  spaceAfter=6, alignment=TA_CENTER)
    subtitle_style = ParagraphStyle('Sub', parent=styles['Normal'],
                                     fontSize=10, textColor=colors.grey,
                                     spaceAfter=12, alignment=TA_CENTER)
    section_style = ParagraphStyle('Section', parent=styles['Heading2'],
                                    fontSize=13, textColor=colors.HexColor('#1A2B4A'),
                                    spaceBefore=16, spaceAfter=8,
                                    borderPad=4)
    body_style = ParagraphStyle('Body2', parent=styles['Normal'],
                                 fontSize=9, leading=14)

    HDR_COLOR = colors.HexColor('#1A2B4A')
    ROW_ALT   = colors.HexColor('#F5F7FA')
    WHITE     = colors.white

    def make_table(data, col_widths_cm):
        col_widths_pt = [w*cm for w in col_widths_cm]
        t = Table(data, colWidths=col_widths_pt, repeatRows=1)
        ts = TableStyle([
            ('BACKGROUND',  (0,0), (-1,0), HDR_COLOR),
            ('TEXTCOLOR',   (0,0), (-1,0), WHITE),
            ('FONTNAME',    (0,0), (-1,0), 'Helvetica-Bold'),
            ('FONTSIZE',    (0,0), (-1,0), 9),
            ('ALIGN',       (0,0), (-1,0), 'CENTER'),
            ('BOTTOMPADDING',(0,0),(-1,0), 6),
            ('TOPPADDING',  (0,0), (-1,0), 6),
            ('FONTNAME',    (0,1), (-1,-1), 'Helvetica'),
            ('FONTSIZE',    (0,1), (-1,-1), 8),
            ('ROWBACKGROUNDS',(0,1),(-1,-1), [WHITE, ROW_ALT]),
            ('GRID',        (0,0), (-1,-1), 0.4, colors.HexColor('#DDDDDD')),
            ('VALIGN',      (0,0), (-1,-1), 'MIDDLE'),
            ('TOPPADDING',  (0,1), (-1,-1), 4),
            ('BOTTOMPADDING',(0,1),(-1,-1), 4),
        ])
        t.setStyle(ts)
        return t

    # ── Intestazione ──
    story.append(Paragraph('GIS Asset Manager', title_style))
    story.append(Paragraph(f'Report riepilogativo &mdash; {date.today().strftime("%d/%m/%Y")}', subtitle_style))
    story.append(HRFlowable(width='100%', thickness=1, color=HDR_COLOR))
    story.append(Spacer(1, 0.4*cm))

    # ── KPI generali ──
    n_assets = db.execute("SELECT COUNT(*) FROM assets").fetchone()[0]
    n_attivi = db.execute("SELECT COUNT(*) FROM assets WHERE stato='attivo'").fetchone()[0]
    n_manutenzione = db.execute("SELECT COUNT(*) FROM assets WHERE stato='in manutenzione'").fetchone()[0]
    n_wo_aperti = db.execute("SELECT COUNT(*) FROM work_orders WHERE stato='aperto'").fetchone()[0]
    n_wo_incorso = db.execute("SELECT COUNT(*) FROM work_orders WHERE stato='in corso'").fetchone()[0]
    n_wo_chiusi = db.execute("SELECT COUNT(*) FROM work_orders WHERE stato='chiuso'").fetchone()[0]
    oggi = date.today().isoformat()
    n_scad_aperte = db.execute("SELECT COUNT(*) FROM deadlines WHERE stato='aperta'").fetchone()[0]
    n_scad_scadute = db.execute("SELECT COUNT(*) FROM deadlines WHERE stato='scaduta' OR (stato='aperta' AND data_scadenza < %s)", (oggi,)).fetchone()[0]

    story.append(Paragraph('Riepilogo KPI', section_style))
    kpi_data = [
        ['Indicatore', 'Valore'],
        ['Asset totali', str(n_assets)],
        ['Asset attivi', str(n_attivi)],
        ['Asset in manutenzione', str(n_manutenzione)],
        ['Work Order aperti', str(n_wo_aperti)],
        ['Work Order in corso', str(n_wo_incorso)],
        ['Work Order chiusi', str(n_wo_chiusi)],
        ['Scadenze aperte', str(n_scad_aperte)],
        ['Scadenze in ritardo', str(n_scad_scadute)],
    ]
    story.append(make_table(kpi_data, [12, 4]))
    story.append(Spacer(1, 0.4*cm))

    # ── Asset ──
    story.append(Paragraph('Anagrafica Asset', section_style))
    asset_rows = db.execute(
        "SELECT codice, nome, tipo, citta, stato FROM assets ORDER BY codice"
    ).fetchall()
    asset_data = [['Codice', 'Nome', 'Tipo', 'Citta', 'Stato']]
    for r in asset_rows:
        asset_data.append([r['codice'], r['nome'], r['tipo'], r['citta'] or '', r['stato']])
    story.append(make_table(asset_data, [3, 7, 4, 4.5, 3.5]))
    story.append(Spacer(1, 0.4*cm))

    # ── Work Order ──
    story.append(Paragraph('Work Order', section_style))
    wo_rows = db.execute("""
        SELECT wo.codice, wo.titolo, a.nome AS asset, wo.priorita, wo.stato, wo.data_pianificata
        FROM work_orders wo LEFT JOIN assets a ON a.id = wo.asset_id
        ORDER BY wo.data_apertura DESC LIMIT 50
    """).fetchall()
    wo_data = [['Codice', 'Titolo', 'Asset', 'Priorita', 'Stato', 'Data pianif.']]
    for r in wo_rows:
        wo_data.append([r['codice'], r['titolo'][:35], r['asset'] or '', r['priorita'], r['stato'], r['data_pianificata'] or ''])
    story.append(make_table(wo_data, [3, 7, 5, 3, 3, 3]))
    story.append(Spacer(1, 0.4*cm))

    # ── Scadenze ──
    story.append(Paragraph('Scadenze', section_style))
    dl_rows = db.execute("""
        SELECT d.titolo, a.nome AS asset, d.tipo, d.priorita, d.stato, d.data_scadenza
        FROM deadlines d JOIN assets a ON a.id = d.asset_id
        ORDER BY d.data_scadenza ASC
    """).fetchall()
    dl_data = [['Titolo', 'Asset', 'Tipo', 'Priorita', 'Stato', 'Scadenza']]
    for r in dl_rows:
        dl_data.append([r['titolo'][:35], r['asset'] or '', r['tipo'], r['priorita'], r['stato'], r['data_scadenza']])
    story.append(make_table(dl_data, [7, 5, 3, 3, 3, 3]))

    # ── Footer ──
    story.append(Spacer(1, 0.6*cm))
    story.append(HRFlowable(width='100%', thickness=0.5, color=colors.grey))
    story.append(Paragraph(
        f'Report generato il {datetime.now().strftime("%d/%m/%Y alle %H:%M")} &mdash; GIS Asset Manager v2.1 &mdash; KeyBiz',
        ParagraphStyle('Footer', parent=styles['Normal'], fontSize=7,
                        textColor=colors.grey, alignment=TA_CENTER, spaceBefore=4)
    ))

    doc.build(story)
    buf.seek(0)
    filename = f"report_gam_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


# ── Simulatore dati live ────────────────────────────────────────────────────
# Aggiorna i dati di monitoraggio ogni 60 secondi con variazioni graduali.
# Regole:
# - Uffici, magazzini, depositi: attivi 08:00-19:00 (fuori orario valori calano)
# - Stabilimenti: h24, nessuna riduzione notturna
# - Variazione graduale: ±5-8% per tick, con clamp ai limiti fisici

def _ora_lavorativa() -> bool:
    """Restituisce True se l'ora corrente è nell'orario lavorativo (08-19)."""
    ora = datetime.now().hour
    return 8 <= ora < 19


def _varia(valore: int, minimo: int, massimo: int,
           step_pct: float = 0.07, verso_min: bool = False) -> int:
    """
    Applica una variazione graduale al valore.
    - step_pct: ampiezza massima della variazione come % del massimo
    - verso_min: se True, spinge il valore verso il minimo (fuori orario)
    """
    if massimo <= 0:
        return valore
    step = max(1, int(massimo * step_pct))
    if verso_min:
        # Fuori orario: tende verso il 10% del massimo
        target = max(minimo, int(massimo * 0.10))
        delta = random.randint(0, step)
        nuovo = valore - delta if valore > target else valore + random.randint(0, 1)
    else:
        delta = random.randint(-step, step)
        nuovo = valore + delta
    return max(minimo, min(massimo, nuovo))


async def _simulatore_loop():
    """Task asincrono che aggiorna i dati di monitoraggio ogni 60 secondi."""
    await asyncio.sleep(10)  # attende l'avvio completo del server
    while True:
        try:
            conn = _PgConnWrapper(psycopg2.connect(DATABASE_URL))
            now = datetime.now().strftime("%Y-%m-%d %H:%M")
            orario = _ora_lavorativa()

            assets = conn.execute(
                "SELECT a.id, a.tipo FROM assets a WHERE a.stato='attivo'"
            ).fetchall()

            for asset in assets:
                aid  = asset["id"]
                tipo = asset["tipo"]
                mon  = conn.execute(
                    "SELECT * FROM monitoraggio WHERE asset_id=%s", (aid,)
                ).fetchone()
                if not mon:
                    continue
                mon = dict(mon)

                # Stabilimenti: h24, nessuna riduzione notturna
                if tipo == "stabilimento":
                    att  = mon.get("personale_attivo") or 0
                    cap  = mon.get("capacita_personale") or 0
                    latt = mon.get("linee_produzione_attive") or 0
                    ltot = mon.get("linee_produzione_totali") or 0
                    if cap > 0:
                        att  = _varia(att,  0, cap)
                    if ltot > 0:
                        latt = _varia(latt, 0, ltot)
                    conn.execute(
                        "UPDATE monitoraggio SET aggiornato_il=%s, personale_attivo=%s,"
                        " linee_produzione_attive=%s WHERE asset_id=%s",
                        (now, att, latt, aid)
                    )

                # Uffici: occupancy e sale riunioni
                elif tipo == "ufficio":
                    dip  = mon.get("dipendenti_presenti") or 0
                    cap  = mon.get("capienza_massima") or 0
                    socc = mon.get("sale_riunioni_occupate") or 0
                    stot = mon.get("sale_riunioni_totali") or 0
                    if cap > 0:
                        dip  = _varia(dip,  0, cap,  verso_min=not orario)
                    if stot > 0:
                        socc = _varia(socc, 0, stot, verso_min=not orario)
                    conn.execute(
                        "UPDATE monitoraggio SET aggiornato_il=%s, dipendenti_presenti=%s,"
                        " sale_riunioni_occupate=%s WHERE asset_id=%s",
                        (now, dip, socc, aid)
                    )

                # Magazzini: saturazione e mezzi operativi
                elif tipo == "magazzino":
                    sat  = mon.get("saturazione_stoccaggio_pct") or 0
                    mop  = mon.get("mezzi_magazzino_presenti") or 0
                    mtot = mon.get("mezzi_magazzino_totali") or 0
                    sat  = _varia(sat,  0, 100, step_pct=0.05, verso_min=not orario)
                    if mtot > 0:
                        mop = _varia(mop, 0, mtot, verso_min=not orario)
                    conn.execute(
                        "UPDATE monitoraggio SET aggiornato_il=%s, saturazione_stoccaggio_pct=%s,"
                        " mezzi_magazzino_presenti=%s WHERE asset_id=%s",
                        (now, sat, mop, aid)
                    )

                # Depositi: mezzi disponibili, in missione, in manutenzione
                elif tipo == "deposito":
                    mtot = mon.get("mezzi_totali") or 0
                    mman = mon.get("mezzi_in_manutenzione") or 0
                    mmis = mon.get("mezzi_in_missione") or 0
                    if mtot > 0:
                        mman = _varia(mman, 0, max(1, mtot // 4), verso_min=not orario)
                        mmis = _varia(mmis, 0, max(1, mtot // 2), verso_min=not orario)
                        mdisp = max(0, mtot - mman - mmis)
                        conn.execute(
                            "UPDATE monitoraggio SET aggiornato_il=%s, mezzi_in_manutenzione=%s,"
                            " mezzi_in_missione=%s, mezzi_disponibili=%s WHERE asset_id=%s",
                            (now, mman, mmis, mdisp, aid)
                        )

            conn.commit()

            # Ricalcola allarmi dopo ogni aggiornamento
            _ricalcola_allarmi_db(conn)
            conn.close()

        except Exception as exc:
            # Non blocca il loop in caso di errore transitorio
            print(f"[simulatore] errore: {exc}")

        await asyncio.sleep(60)


@app.on_event("startup")
async def avvia_simulatore():
    """Avvia il task di simulazione dati live all'avvio del server."""
    asyncio.create_task(_simulatore_loop())
    print("[simulatore] task live avviato (intervallo: 60s)")


# ── Endpoint ricalcolo manuale allarmi ───────────────────────────────────────
@app.post("/api/alarms/recalculate")
def ricalcola_manuale(db=Depends(get_db), _=Depends(richiedi_permesso("thresholds.update"))):
    """Forza il ricalcolo immediato degli allarmi (utile per test)."""
    _ricalcola_allarmi_db(db)
    n = db.execute("SELECT COUNT(*) FROM alarms WHERE ack_at IS NULL").fetchone()[0]
    return {"messaggio": "Ricalcolo completato", "allarmi_attivi": n}


# ── Stats operativi per HUD mappa ───────────────────────────────────────────
@app.get("/api/stats/operational")
def get_stats_operational(db=Depends(get_db), _=Depends(richiedi_permesso("assets.read"))):
    """KPI operativi aggregati per la HUD sovrapposta alla mappa."""
    now = datetime.now(timezone.utc)
    oggi = now.date().isoformat()
    fra7 = (now.date() + timedelta(days=7)).isoformat()
    questo_mese_inizio = now.date().replace(day=1).isoformat()

    # WO urgenti aperti (priorità critica o alta, stato aperto o in_corso)
    wo_urgenti = db.execute(
        "SELECT COUNT(*) FROM work_orders WHERE stato IN ('aperto','in_corso') AND priorita IN ('critica','alta')"
    ).fetchone()[0]

    # WO totali aperti
    wo_aperti = db.execute(
        "SELECT COUNT(*) FROM work_orders WHERE stato IN ('aperto','in_corso')"
    ).fetchone()[0]

    # Scadenze entro 7 giorni (aperte)
    scadenze_7gg = db.execute(
        "SELECT COUNT(*) FROM deadlines WHERE stato='aperta' AND data_scadenza <= %s AND data_scadenza >= %s",
        (fra7, oggi)
    ).fetchone()[0]

    # Scadenze scadute (in ritardo)
    scadenze_ritardo = db.execute(
        "SELECT COUNT(*) FROM deadlines WHERE stato='aperta' AND data_scadenza < %s",
        (oggi,)
    ).fetchone()[0]

    # Asset con allarmi attivi
    asset_con_allarmi = db.execute(
        "SELECT COUNT(DISTINCT asset_id) FROM alarms WHERE ack_at IS NULL"
    ).fetchone()[0]

    # Asset in manutenzione
    asset_manutenzione = db.execute(
        "SELECT COUNT(*) FROM assets WHERE stato='manutenzione'"
    ).fetchone()[0]

    # WO completati questo mese
    wo_completati_mese = db.execute(
        "SELECT COUNT(*) FROM work_orders WHERE stato='completato' AND data_apertura >= %s",
        (questo_mese_inizio,)
    ).fetchone()[0]

    # Scadenze totali aperte (non ancora chiuse)
    scadenze_totali_aperte = db.execute(
        "SELECT COUNT(*) FROM deadlines WHERE stato='aperta'"
    ).fetchone()[0]

    # Asset inattivi (dismessi)
    asset_inattivi = db.execute(
        "SELECT COUNT(*) FROM assets WHERE stato='inattivo'"
    ).fetchone()[0]

    # Stato operativo per asset (per colorare i marker)
    # Logica: basata esclusivamente su WO + allarmi (eventi operativi reali)
    # Lo stato anagrafico (attivo/manutenzione/inattivo) è separato e non influenza il colore,
    # tranne 'inattivo' che indica asset dismesso (grigio).
    # Valori restituiti: critico / warning / ok / inattivo
    asset_stati = {}

    # Passo 1: tutti gli asset attivi o in manutenzione partono come 'ok'
    for row in db.execute("SELECT id FROM assets WHERE stato IN ('attivo','manutenzione')"):
        asset_stati[row[0]] = 'ok'

    # Passo 2: asset inattivi (dismessi) → grigio, indipendentemente da WO/allarmi
    for row in db.execute("SELECT id FROM assets WHERE stato='inattivo'"):
        asset_stati[row[0]] = 'inattivo'

    # Passo 3: asset con WO critico aperto → rosso (sovrascrive ok)
    for row in db.execute(
        "SELECT DISTINCT asset_id FROM work_orders WHERE stato IN ('aperto','in_corso') AND priorita='critica'"
    ):
        if asset_stati.get(row[0]) not in ('inattivo',):
            asset_stati[row[0]] = 'critico'

    # Passo 4: asset con allarme critico → rosso (sovrascrive ok e warning)
    for row in db.execute(
        "SELECT DISTINCT asset_id FROM alarms WHERE ack_at IS NULL AND livello='alarm'"
    ):
        if asset_stati.get(row[0]) not in ('inattivo',):
            asset_stati[row[0]] = 'critico'

    # Passo 5: asset con WO alta priorità → arancio (solo se non già critico)
    for row in db.execute(
        "SELECT DISTINCT asset_id FROM work_orders WHERE stato IN ('aperto','in_corso') AND priorita='alta'"
    ):
        if asset_stati.get(row[0]) == 'ok':
            asset_stati[row[0]] = 'warning'

    # Passo 6: asset con allarme warning → arancio (solo se non già critico)
    for row in db.execute(
        "SELECT DISTINCT asset_id FROM alarms WHERE ack_at IS NULL AND livello='warning'"
    ):
        if asset_stati.get(row[0]) == 'ok':
            asset_stati[row[0]] = 'warning'

    # Passo 7: asset con scadenza entro 7 giorni → arancio (solo se non già critico)
    for row in db.execute(
        "SELECT DISTINCT asset_id FROM deadlines WHERE stato='aperta' AND data_scadenza <= %s AND data_scadenza >= %s AND asset_id IS NOT NULL",
        (fra7, oggi)
    ):
        if asset_stati.get(row[0]) == 'ok':
            asset_stati[row[0]] = 'warning'

    return {
        "wo_urgenti": wo_urgenti,
        "wo_aperti": wo_aperti,
        "scadenze_7gg": scadenze_7gg,
        "scadenze_ritardo": scadenze_ritardo,
        "scadenze_totali_aperte": scadenze_totali_aperte,
        "asset_con_allarmi": asset_con_allarmi,
        "asset_manutenzione": asset_manutenzione,
        "asset_inattivi": asset_inattivi,
        "wo_completati_mese": wo_completati_mese,
        "asset_stati": asset_stati
    }


# ── BIM Viewer ───────────────────────────────────────────────────────────────

# Dati planimetrici simulati per edificio (keyed by asset_id)
BIM_DATA = {
    # Stabilimento Nord Milano (id=1, 18000 mq, 3 piani)
    1: {
        "nome": "Stabilimento Nord Milano",
        "citta": "Sesto San Giovanni",
        "anno": 1987,
        "superficie_mq": 18000,
        "ifc_url": "https://view.ifcopenshell.org/",
        "piani": [
            {"id": "p0", "label": "Piano Terra", "quota_m": 0.0},
            {"id": "p1", "label": "Piano 1",    "quota_m": 4.5},
            {"id": "p2", "label": "Piano 2",    "quota_m": 9.0},
        ],
        "locali": [
            {"id":"L01","piano":"p0","nome":"Reparto Produzione A","tipo":"produzione","mq":2800,"x":5,"y":5,"w":45,"h":30,"asset_id":1},
            {"id":"L02","piano":"p0","nome":"Reparto Produzione B","tipo":"produzione","mq":2400,"x":55,"y":5,"w":38,"h":30,"asset_id":1},
            {"id":"L03","piano":"p0","nome":"Magazzino Materie Prime","tipo":"magazzino","mq":1800,"x":5,"y":40,"w":35,"h":25,"asset_id":None},
            {"id":"L04","piano":"p0","nome":"Centrale Termica","tipo":"impianto","mq":320,"x":45,"y":40,"w":15,"h":12,"asset_id":None},
            {"id":"L05","piano":"p0","nome":"Cabina Elettrica","tipo":"impianto","mq":180,"x":65,"y":40,"w":12,"h":10,"asset_id":None},
            {"id":"L06","piano":"p0","nome":"Ingresso / Reception","tipo":"comune","mq":220,"x":82,"y":5,"w":13,"h":12,"asset_id":None},
            {"id":"L07","piano":"p0","nome":"Spogliatoi","tipo":"comune","mq":280,"x":82,"y":20,"w":13,"h":10,"asset_id":None},
            {"id":"L11","piano":"p1","nome":"Uffici Tecnici","tipo":"ufficio","mq":950,"x":5,"y":5,"w":40,"h":22,"asset_id":None},
            {"id":"L12","piano":"p1","nome":"Sala Controllo","tipo":"controllo","mq":420,"x":50,"y":5,"w":20,"h":22,"asset_id":1},
            {"id":"L13","piano":"p1","nome":"Laboratorio Qualita'","tipo":"laboratorio","mq":380,"x":75,"y":5,"w":20,"h":22,"asset_id":None},
            {"id":"L14","piano":"p1","nome":"Sala Riunioni","tipo":"comune","mq":180,"x":5,"y":32,"w":20,"h":15,"asset_id":None},
            {"id":"L15","piano":"p1","nome":"Archivio Tecnico","tipo":"archivio","mq":240,"x":30,"y":32,"w":20,"h":15,"asset_id":None},
            {"id":"L21","piano":"p2","nome":"Direzione","tipo":"ufficio","mq":480,"x":5,"y":5,"w":30,"h":25,"asset_id":None},
            {"id":"L22","piano":"p2","nome":"Sala Consiglio","tipo":"comune","mq":280,"x":40,"y":5,"w":25,"h":25,"asset_id":None},
            {"id":"L23","piano":"p2","nome":"Open Space","tipo":"ufficio","mq":620,"x":70,"y":5,"w":25,"h":25,"asset_id":None},
        ]
    },
    # Stabilimento Torino Est (id=2, 12500 mq, 2 piani)
    2: {
        "nome": "Stabilimento Torino Est",
        "citta": "Torino",
        "anno": 1995,
        "superficie_mq": 12500,
        "ifc_url": "https://view.ifcopenshell.org/",
        "piani": [
            {"id": "p0", "label": "Piano Terra", "quota_m": 0.0},
            {"id": "p1", "label": "Piano 1",    "quota_m": 4.2},
        ],
        "locali": [
            {"id":"L01","piano":"p0","nome":"Produzione Principale","tipo":"produzione","mq":4200,"x":5,"y":5,"w":55,"h":35,"asset_id":2},
            {"id":"L02","piano":"p0","nome":"Magazzino Prodotti Finiti","tipo":"magazzino","mq":2100,"x":65,"y":5,"w":30,"h":35,"asset_id":None},
            {"id":"L03","piano":"p0","nome":"Manutenzione","tipo":"impianto","mq":480,"x":5,"y":45,"w":20,"h":18,"asset_id":None},
            {"id":"L04","piano":"p0","nome":"Cabina Elettrica","tipo":"impianto","mq":160,"x":30,"y":45,"w":12,"h":10,"asset_id":None},
            {"id":"L05","piano":"p0","nome":"Reception","tipo":"comune","mq":120,"x":47,"y":45,"w":12,"h":10,"asset_id":None},
            {"id":"L11","piano":"p1","nome":"Uffici Amministrativi","tipo":"ufficio","mq":1200,"x":5,"y":5,"w":45,"h":28,"asset_id":None},
            {"id":"L12","piano":"p1","nome":"Sala Controllo","tipo":"controllo","mq":360,"x":55,"y":5,"w":20,"h":28,"asset_id":2},
            {"id":"L13","piano":"p1","nome":"Sala Riunioni","tipo":"comune","mq":220,"x":80,"y":5,"w":15,"h":28,"asset_id":None},
        ]
    },
    # Sede Centrale Roma (id=6, 3200 mq, 4 piani)
    6: {
        "nome": "Sede Centrale Roma",
        "citta": "Roma",
        "anno": 2003,
        "superficie_mq": 3200,
        "ifc_url": "https://view.ifcopenshell.org/",
        "piani": [
            {"id": "p0", "label": "Piano Terra",  "quota_m": 0.0},
            {"id": "p1", "label": "Piano 1",      "quota_m": 3.5},
            {"id": "p2", "label": "Piano 2",      "quota_m": 7.0},
            {"id": "p3", "label": "Piano 3",      "quota_m": 10.5},
        ],
        "locali": [
            {"id":"L01","piano":"p0","nome":"Reception / Lobby","tipo":"comune","mq":280,"x":10,"y":10,"w":35,"h":30,"asset_id":None},
            {"id":"L02","piano":"p0","nome":"Sala Conferenze A","tipo":"comune","mq":180,"x":50,"y":10,"w":25,"h":20,"asset_id":None},
            {"id":"L03","piano":"p0","nome":"Sala Conferenze B","tipo":"comune","mq":140,"x":50,"y":35,"w":25,"h":18,"asset_id":None},
            {"id":"L04","piano":"p0","nome":"Centrale Tecnica","tipo":"impianto","mq":120,"x":80,"y":10,"w":15,"h":20,"asset_id":6},
            {"id":"L11","piano":"p1","nome":"Open Space Marketing","tipo":"ufficio","mq":420,"x":5,"y":5,"w":45,"h":30,"asset_id":None},
            {"id":"L12","piano":"p1","nome":"Uffici Commerciali","tipo":"ufficio","mq":320,"x":55,"y":5,"w":35,"h":30,"asset_id":None},
            {"id":"L13","piano":"p1","nome":"Sala Riunioni","tipo":"comune","mq":120,"x":5,"y":40,"w":20,"h":18,"asset_id":None},
            {"id":"L21","piano":"p2","nome":"Uffici IT","tipo":"ufficio","mq":380,"x":5,"y":5,"w":40,"h":30,"asset_id":None},
            {"id":"L22","piano":"p2","nome":"Server Room","tipo":"impianto","mq":180,"x":50,"y":5,"w":20,"h":20,"asset_id":6},
            {"id":"L23","piano":"p2","nome":"HR & Amministrazione","tipo":"ufficio","mq":280,"x":75,"y":5,"w":20,"h":30,"asset_id":None},
            {"id":"L31","piano":"p3","nome":"Direzione Generale","tipo":"ufficio","mq":360,"x":5,"y":5,"w":35,"h":30,"asset_id":None},
            {"id":"L32","piano":"p3","nome":"Sala Consiglio","tipo":"comune","mq":220,"x":45,"y":5,"w":25,"h":30,"asset_id":None},
            {"id":"L33","piano":"p3","nome":"Terrazza","tipo":"comune","mq":180,"x":75,"y":5,"w":20,"h":30,"asset_id":None},
        ]
    },
    # Ufficio Milano Centro (id=7, 1800 mq, 3 piani)
    7: {
        "nome": "Ufficio Milano Centro",
        "citta": "Milano",
        "anno": 2011,
        "superficie_mq": 1800,
        "ifc_url": "https://view.ifcopenshell.org/",
        "piani": [
            {"id": "p0", "label": "Piano Terra", "quota_m": 0.0},
            {"id": "p1", "label": "Piano 1",    "quota_m": 3.2},
            {"id": "p2", "label": "Piano 2",    "quota_m": 6.4},
        ],
        "locali": [
            {"id":"L01","piano":"p0","nome":"Reception","tipo":"comune","mq":120,"x":10,"y":10,"w":30,"h":25,"asset_id":None},
            {"id":"L02","piano":"p0","nome":"Sala Riunioni","tipo":"comune","mq":90,"x":45,"y":10,"w":25,"h":20,"asset_id":None},
            {"id":"L03","piano":"p0","nome":"Locale Tecnico","tipo":"impianto","mq":60,"x":75,"y":10,"w":15,"h":15,"asset_id":7},
            {"id":"L11","piano":"p1","nome":"Open Space","tipo":"ufficio","mq":480,"x":5,"y":5,"w":55,"h":35,"asset_id":None},
            {"id":"L12","piano":"p1","nome":"Uffici Privati","tipo":"ufficio","mq":220,"x":65,"y":5,"w":30,"h":35,"asset_id":None},
            {"id":"L21","piano":"p2","nome":"Management","tipo":"ufficio","mq":320,"x":5,"y":5,"w":40,"h":30,"asset_id":None},
            {"id":"L22","piano":"p2","nome":"Sala Formazione","tipo":"comune","mq":240,"x":50,"y":5,"w":30,"h":30,"asset_id":None},
            {"id":"L23","piano":"p2","nome":"Sala Server","tipo":"impianto","mq":80,"x":85,"y":5,"w":10,"h":15,"asset_id":7},
        ]
    },
}


@app.get("/api/bim/edifici")
def bim_edifici(_=Depends(get_utente_corrente), db=Depends(get_db)):
    """Lista degli edifici con viewer BIM disponibile."""
    oggi = date.today().isoformat()
    fra7 = (date.today() + timedelta(days=7)).isoformat()
    result = []
    for asset_id, bim in BIM_DATA.items():
        asset = db.execute("SELECT id, codice, nome, tipo, citta, stato FROM assets WHERE id=%s", (asset_id,)).fetchone()
        if not asset:
            continue
        stato_op = "ok"
        if db.execute("SELECT 1 FROM work_orders WHERE asset_id=%s AND stato IN ('aperto','in_corso') AND priorita='critica'", (asset_id,)).fetchone():
            stato_op = "critico"
        elif db.execute("SELECT 1 FROM alarms WHERE asset_id=%s AND ack_at IS NULL AND livello='alarm'", (asset_id,)).fetchone():
            stato_op = "critico"
        elif db.execute("SELECT 1 FROM work_orders WHERE asset_id=%s AND stato IN ('aperto','in_corso') AND priorita='alta'", (asset_id,)).fetchone():
            stato_op = "warning"
        elif db.execute("SELECT 1 FROM alarms WHERE asset_id=%s AND ack_at IS NULL AND livello='warning'", (asset_id,)).fetchone():
            stato_op = "warning"
        elif db.execute("SELECT 1 FROM deadlines WHERE asset_id=%s AND stato='aperta' AND data_scadenza<=%s AND data_scadenza>=%s", (asset_id, fra7, oggi)).fetchone():
            stato_op = "warning"
        if asset["stato"] == "inattivo":
            stato_op = "inattivo"
        result.append({
            "id": asset_id,
            "codice": asset["codice"],
            "nome": bim["nome"],
            "citta": bim["citta"],
            "tipo": asset["tipo"],
            "stato_anagrafico": asset["stato"],
            "stato_operativo": stato_op,
            "superficie_mq": bim["superficie_mq"],
            "anno": bim["anno"],
            "n_piani": len(bim["piani"]),
            "n_locali": len(bim["locali"]),
            "ifc_url": bim["ifc_url"],
        })
    return result


@app.get("/api/bim/{asset_id}")
def bim_detail(asset_id: int, _=Depends(get_utente_corrente), db=Depends(get_db)):
    """Dati planimetrici completi per un edificio: piani, locali, stato operativo per locale."""
    if asset_id not in BIM_DATA:
        raise HTTPException(status_code=404, detail="Edificio non presente nel viewer BIM")
    bim = BIM_DATA[asset_id]
    oggi = date.today().isoformat()
    fra7 = (date.today() + timedelta(days=7)).isoformat()
    asset_ids = list({l["asset_id"] for l in bim["locali"] if l["asset_id"]})
    stati = {}
    for aid in asset_ids:
        s = "ok"
        if db.execute("SELECT 1 FROM work_orders WHERE asset_id=%s AND stato IN ('aperto','in_corso') AND priorita='critica'", (aid,)).fetchone():
            s = "critico"
        elif db.execute("SELECT 1 FROM alarms WHERE asset_id=%s AND ack_at IS NULL AND livello='alarm'", (aid,)).fetchone():
            s = "critico"
        elif db.execute("SELECT 1 FROM work_orders WHERE asset_id=%s AND stato IN ('aperto','in_corso') AND priorita='alta'", (aid,)).fetchone():
            s = "warning"
        elif db.execute("SELECT 1 FROM alarms WHERE asset_id=%s AND ack_at IS NULL AND livello='warning'", (aid,)).fetchone():
            s = "warning"
        elif db.execute("SELECT 1 FROM deadlines WHERE asset_id=%s AND stato='aperta' AND data_scadenza<=%s AND data_scadenza>=%s", (aid, fra7, oggi)).fetchone():
            s = "warning"
        stati[aid] = s
    locali_out = []
    for loc in bim["locali"]:
        aid = loc["asset_id"]
        wo_count = 0
        alarm_count = 0
        if aid:
            wo_count = db.execute("SELECT COUNT(*) FROM work_orders WHERE asset_id=%s AND stato IN ('aperto','in_corso')", (aid,)).fetchone()[0]
            alarm_count = db.execute("SELECT COUNT(*) FROM alarms WHERE asset_id=%s AND ack_at IS NULL", (aid,)).fetchone()[0]
        locali_out.append({
            **loc,
            "stato_operativo": stati.get(aid, "ok") if aid else "nessuno",
            "wo_aperti": wo_count,
            "allarmi_attivi": alarm_count,
        })
    asset_db = db.execute("SELECT id, codice, nome, tipo, citta, stato, superficie_mq, anno_costruzione FROM assets WHERE id=%s", (asset_id,)).fetchone()
    return {
        "asset": dict(asset_db) if asset_db else {},
        "bim": {
            "nome": bim["nome"],
            "citta": bim["citta"],
            "anno": bim["anno"],
            "superficie_mq": bim["superficie_mq"],
            "ifc_url": bim["ifc_url"],
            "piani": bim["piani"],
            "locali": locali_out,
        }
    }


# ── Redirect root → login ────────────────────────────────────────────────────

# ── Startup: Asset Efficiency simulatori ────────────────────────────────────
@app.on_event("startup")
async def startup_asset_efficiency():
    import asyncio as _asyncio
    # Avvia simulatori near-real-time in background
    _asyncio.create_task(run_energy_simulator(DATABASE_URL, intervallo_sec=300))
    _asyncio.create_task(run_occupancy_simulator(DATABASE_URL, intervallo_sec=60))
    print("[startup] Asset Efficiency simulatori avviati OK")

@app.get("/")
def root():
    return RedirectResponse(url="/static/login.html")


# ── Serve file statici ───────────────────────────────────────────────────────
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
