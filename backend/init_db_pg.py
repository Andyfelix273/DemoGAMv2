"""
GIS Asset Manager - Inizializzazione Database PostgreSQL
Versione: 3.0
Autore: Felix / KeyBiz

Crea e popola il database PostgreSQL con:
- users: utenti con ruoli admin/user
- assets: 20 asset fittizi georeferenziati
- monitoraggio: dati operativi simulati per ogni asset
- thresholds: soglie di warning e alarm per tipo asset
- alarms: allarmi generati dal confronto monitoraggio/soglie
- config: configurazione applicazione
- esg: dati ESG per asset
- deadlines, documents, work_orders
"""

import os
import logging
import psycopg2
import psycopg2.extras
from datetime import datetime, timedelta

# Workaround per compatibilità bcrypt/passlib su versioni Python recenti
import bcrypt
if not hasattr(bcrypt, "__about__"):
    bcrypt.__about__ = type('About', (object,), {'__version__': bcrypt.__version__})

from passlib.context import CryptContext

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://gamuser:gampassword@localhost:5432/gamdb"
)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)


def get_conn():
    return psycopg2.connect(DATABASE_URL)


def crea_schema(conn):
    cur = conn.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        username      TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'user',
        nome_completo TEXT,
        email         TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS assets (
        id                SERIAL PRIMARY KEY,
        codice            TEXT UNIQUE NOT NULL,
        nome              TEXT NOT NULL,
        tipo              TEXT NOT NULL,
        indirizzo         TEXT,
        citta             TEXT,
        provincia         TEXT,
        cap               TEXT,
        lat               DOUBLE PRECISION NOT NULL,
        lon               DOUBLE PRECISION NOT NULL,
        referente         TEXT,
        telefono          TEXT,
        email             TEXT,
        superficie_mq     INTEGER,
        anno_costruzione  INTEGER,
        stato             TEXT DEFAULT 'attivo',
        note              TEXT,
        created_at        TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS monitoraggio (
        id                              SERIAL PRIMARY KEY,
        asset_id                        INTEGER UNIQUE REFERENCES assets(id),
        aggiornato_il                   TIMESTAMPTZ,
        dipendenti_presenti             INTEGER,
        capienza_massima                INTEGER,
        sale_riunioni_occupate          INTEGER,
        sale_riunioni_totali            INTEGER,
        personale_attivo                INTEGER,
        capacita_personale              INTEGER,
        linee_produzione_attive         INTEGER,
        linee_produzione_totali         INTEGER,
        media_produzione_giornaliera_pz INTEGER,
        operatori_presenti              INTEGER,
        mezzi_magazzino_presenti        INTEGER,
        mezzi_magazzino_totali          INTEGER,
        saturazione_stoccaggio_pct      INTEGER,
        mezzi_presenti                  INTEGER,
        mezzi_totali                    INTEGER,
        mezzi_in_manutenzione           INTEGER,
        mezzi_in_missione               INTEGER,
        mezzi_disponibili               INTEGER
    );

    CREATE TABLE IF NOT EXISTS thresholds (
        id            SERIAL PRIMARY KEY,
        asset_tipo    TEXT NOT NULL,
        campo         TEXT NOT NULL,
        label         TEXT,
        warning_value DOUBLE PRECISION NOT NULL,
        alarm_value   DOUBLE PRECISION NOT NULL,
        unita         TEXT,
        is_percentage INTEGER NOT NULL DEFAULT 1,
        campo_totale  TEXT,
        inverso       INTEGER NOT NULL DEFAULT 0,
        UNIQUE(asset_tipo, campo)
    );

    CREATE TABLE IF NOT EXISTS alarms (
        id         SERIAL PRIMARY KEY,
        asset_id   INTEGER REFERENCES assets(id),
        campo      TEXT NOT NULL,
        valore     DOUBLE PRECISION,
        livello    TEXT NOT NULL,
        stato      TEXT NOT NULL DEFAULT 'warning',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        ack_at     TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS esg (
        id                      SERIAL PRIMARY KEY,
        asset_id                INTEGER UNIQUE REFERENCES assets(id),
        aggiornato_il           TIMESTAMPTZ,
        consumo_kwh_giorno      DOUBLE PRECISION,
        consumo_m3_acqua_giorno DOUBLE PRECISION,
        benchmark_kwh           DOUBLE PRECISION,
        benchmark_m3            DOUBLE PRECISION,
        fattore_emissione_kwh   DOUBLE PRECISION DEFAULT 0.233,
        consumo_gas_m3_giorno   DOUBLE PRECISION,
        co2_scope1_kg_giorno    DOUBLE PRECISION,
        co2_scope2_kg_giorno    DOUBLE PRECISION,
        co2_totale_kg_giorno    DOUBLE PRECISION,
        rating_esg              TEXT
    );

    CREATE TABLE IF NOT EXISTS config (
        chiave TEXT PRIMARY KEY,
        valore TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deadlines (
        id            SERIAL PRIMARY KEY,
        asset_id      INTEGER REFERENCES assets(id) ON DELETE CASCADE,
        titolo        TEXT NOT NULL,
        descrizione   TEXT,
        tipo          TEXT NOT NULL DEFAULT 'scadenza',
        data_scadenza DATE NOT NULL,
        stato         TEXT NOT NULL DEFAULT 'aperta',
        priorita      TEXT NOT NULL DEFAULT 'media',
        assegnatario  TEXT,
        note          TEXT,
        creato_da     TEXT NOT NULL DEFAULT 'system',
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        closed_at     TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS documents (
        id           SERIAL PRIMARY KEY,
        asset_id     INTEGER REFERENCES assets(id) ON DELETE CASCADE,
        nome_file    TEXT NOT NULL,
        tipo_mime    TEXT,
        dimensione   INTEGER,
        percorso     TEXT NOT NULL,
        caricato_da  TEXT NOT NULL DEFAULT 'system',
        created_at   TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS work_orders (
        id               SERIAL PRIMARY KEY,
        codice           TEXT UNIQUE NOT NULL,
        asset_id         INTEGER REFERENCES assets(id) ON DELETE CASCADE,
        tipo             TEXT NOT NULL DEFAULT 'correttivo',
        priorita         TEXT NOT NULL DEFAULT 'media',
        stato            TEXT NOT NULL DEFAULT 'aperto',
        titolo           TEXT NOT NULL,
        descrizione      TEXT,
        assegnatario     TEXT,
        allarme_id       INTEGER REFERENCES alarms(id) ON DELETE SET NULL,
        data_apertura    TIMESTAMPTZ DEFAULT NOW(),
        data_pianificata DATE,
        data_chiusura    TIMESTAMPTZ,
        creato_da        TEXT NOT NULL DEFAULT 'system',
        note_chiusura    TEXT
    );

    -- BEMS: Piani, Zone, Impianti, Telemetria, Allarmi energetici
    CREATE TABLE IF NOT EXISTS floors (
        id               SERIAL PRIMARY KEY,
        asset_id         INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        floor_id         TEXT NOT NULL,
        nome             TEXT NOT NULL,
        level            INTEGER NOT NULL DEFAULT 0,
        superficie_mq    NUMERIC(10,2),
        svg_file         TEXT,
        ifc_storey_guid  TEXT,
        UNIQUE(asset_id, floor_id)
    );

    CREATE TABLE IF NOT EXISTS zones (
        id               SERIAL PRIMARY KEY,
        asset_id         INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        floor_id         TEXT NOT NULL,
        zone_id          TEXT NOT NULL,
        nome             TEXT NOT NULL,
        tipo             TEXT NOT NULL DEFAULT 'ufficio',
        superficie_mq    NUMERIC(10,2),
        capacita_persone INTEGER,
        ifc_space_guid   TEXT,
        UNIQUE(asset_id, zone_id)
    );

    CREATE TABLE IF NOT EXISTS plants (
        id                   SERIAL PRIMARY KEY,
        asset_id             INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        floor_id             TEXT,
        zone_id              TEXT,
        plant_id             TEXT NOT NULL,
        nome                 TEXT NOT NULL,
        tipo                 TEXT NOT NULL,
        marca                TEXT,
        modello              TEXT,
        anno_installazione   INTEGER,
        stato                TEXT NOT NULL DEFAULT 'operativo',
        energia_baseline_kw  NUMERIC(10,3),
        energy_baseline_kw   NUMERIC(10,3),
        UNIQUE(asset_id, plant_id)
    );

    CREATE TABLE IF NOT EXISTS telemetry (
        id         BIGSERIAL,
        ts         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        asset_id   INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        floor_id   TEXT,
        zone_id    TEXT,
        plant_id   TEXT,
        power_kw   NUMERIC(10,3),
        temp_c     NUMERIC(5,2),
        humidity   NUMERIC(5,2),
        co2_ppm    NUMERIC(8,2),
        occupancy  BOOLEAN,
        PRIMARY KEY (id, ts)
    );

    CREATE TABLE IF NOT EXISTS energy_alarms (
        id          SERIAL PRIMARY KEY,
        asset_id    INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        floor_id    TEXT,
        zone_id     TEXT,
        plant_id    TEXT,
        alarm_type  TEXT NOT NULL,
        severity    TEXT NOT NULL DEFAULT 'warning',
        message     TEXT NOT NULL,
        value       NUMERIC(12,3),
        threshold   NUMERIC(12,3),
        acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
        ack_by      TEXT,
        ack_at      TIMESTAMPTZ,
        timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """)
    conn.commit()
    cur.close()
    log.info("Schema PostgreSQL creato.")


def popola_utenti(conn):
    utenti = [
        ("admin",   pwd_context.hash("demo2026"),    "admin",      "Amministratore",    "admin@keybiz.it"),
        ("manager", pwd_context.hash("manager2026"), "manager",    "Mario Rossi",       "manager@keybiz.it"),
        ("viewer",  pwd_context.hash("viewer2026"),  "viewer",     "Visualizzatore Demo","viewer@keybiz.it"),
        ("user",    pwd_context.hash("user2026"),     "user",       "Utente Demo",       "user@keybiz.it"),
    ]
    cur = conn.cursor()
    for u in utenti:
        cur.execute("""
            INSERT INTO users (username, password_hash, role, nome_completo, email)
            VALUES (%s,%s,%s,%s,%s)
            ON CONFLICT (username) DO NOTHING
        """, u)
    conn.commit()
    cur.close()
    log.info("Utenti inseriti.")


def popola_assets(conn):
    assets = [
        # Stabilimenti
        ("ASS-0001","Stabilimento Nord Milano","stabilimento","Via dell'Industria 12","Sesto San Giovanni","MI","20099",45.5328,9.2367,"Ing. Marco Ferretti","02-2456789","m.ferretti@abc.it",18000,1985,"attivo","Stabilimento principale produzione meccanica"),
        ("ASS-0002","Stabilimento Torino Est","stabilimento","Corso Vercelli 88","Torino","TO","10155",45.0703,7.7261,"Ing. Laura Bianchi","011-3456789","l.bianchi@abc.it",12500,1992,"attivo","Produzione componentistica elettronica"),
        ("ASS-0003","Stabilimento Brescia","stabilimento","Via Industriale 45","Brescia","BS","25125",45.5416,10.2118,"Dott. Giorgio Mancini","030-5678901","g.mancini@abc.it",22000,1978,"manutenzione","Fermo per manutenzione straordinaria"),
        ("ASS-0004","Stabilimento Napoli","stabilimento","Via Argine 205","Napoli","NA","80147",40.8518,14.3013,"Ing. Carla Esposito","081-7654321","c.esposito@abc.it",9800,2001,"attivo","Assemblaggio prodotti finiti"),
        ("ASS-0005","Stabilimento Bari","stabilimento","Via delle Industrie 33","Bari","BA","70132",41.0989,16.8719,"Ing. Antonio Russo","080-4567890","a.russo@abc.it",8500,2005,"attivo","Lavorazione materie prime"),
        # Uffici
        ("ASS-0006","Sede Centrale Roma","ufficio","Via M. Bianchini 47","Roma","RM","00142",41.8485,12.4844,"Dott.ssa Alessia Conti","06-12345678","a.conti@abc.it",3200,2010,"attivo","Sede legale e direzione generale"),
        ("ASS-0007","Ufficio Milano Centro","ufficio","Piazza della Repubblica 14","Milano","MI","20124",45.4841,9.2024,"Dott. Luca Marini","02-98765432","l.marini@abc.it",1800,2015,"attivo","Ufficio commerciale Nord Italia"),
        ("ASS-0008","Ufficio Torino","ufficio","Via Roma 56","Torino","TO","10121",45.0703,7.6869,"Dott.ssa Sara Gallo","011-2345678","s.gallo@abc.it",1200,2018,"attivo","Ufficio tecnico e R&D"),
        ("ASS-0009","Ufficio Bologna","ufficio","Via Indipendenza 72","Bologna","BO","40121",44.4949,11.3426,"Dott. Paolo Ricci","051-3456789","p.ricci@abc.it",950,2012,"attivo","Ufficio amministrativo Centro Italia"),
        ("ASS-0010","Ufficio Napoli","ufficio","Via Toledo 156","Napoli","NA","80134",40.8400,14.2490,"Dott.ssa Giovanna Sorrentino","081-2345678","g.sorrentino@abc.it",1100,2016,"attivo","Ufficio commerciale Sud Italia"),
        ("ASS-0011","Ufficio Palermo","ufficio","Via Libertà 201","Palermo","PA","90143",38.1157,13.3615,"Dott. Francesco Lombardo","091-3456789","f.lombardo@abc.it",780,2019,"attivo","Presidio commerciale Sicilia"),
        # Magazzini
        ("ASS-0012","Magazzino Centrale Piacenza","magazzino","Via Emilia Est 301","Piacenza","PC","29122",45.0526,9.7037,"Sig. Roberto Fabbri","0523-456789","r.fabbri@abc.it",35000,1999,"attivo","Hub logistico principale Nord Italia"),
        ("ASS-0013","Magazzino Verona","magazzino","Via del Commercio 18","Verona","VR","37135",45.4384,10.9916,"Sig.ra Monica Trentini","045-5678901","m.trentini@abc.it",18000,2003,"attivo","Magazzino distribuzione Nord-Est"),
        ("ASS-0014","Magazzino Roma Sud","magazzino","Via Pontina Km 23","Pomezia","RM","00071",41.6703,12.5019,"Sig. Daniele Moretti","06-9876543","d.moretti@abc.it",28000,2007,"attivo","Hub logistico Centro Italia"),
        ("ASS-0015","Magazzino Catania","magazzino","Via Etnea Industriale 55","Catania","CT","95121",37.5079,15.0830,"Sig. Salvatore Grasso","095-4567890","s.grasso@abc.it",12000,2011,"attivo","Magazzino distribuzione Sicilia"),
        ("ASS-0016","Magazzino Ancona","magazzino","Via della Logistica 7","Ancona","AN","60131",43.6158,13.5189,"Sig.ra Elena Marchetti","071-3456789","e.marchetti@abc.it",15000,2008,"manutenzione","Magazzino distribuzione Centro-Est"),
        # Depositi
        ("ASS-0017","Deposito Mezzi Milano","deposito","Via Stephenson 94","Milano","MI","20157",45.5100,9.1300,"Sig. Maurizio Colombo","02-3456789","m.colombo@abc.it",8500,2000,"attivo","Deposito flotta aziendale Nord Italia"),
        ("ASS-0018","Deposito Mezzi Roma","deposito","Via della Magliana 329","Roma","RM","00148",41.8367,12.4100,"Sig. Claudio Ferrara","06-8765432","c.ferrara@abc.it",6200,2004,"attivo","Deposito flotta aziendale Centro Italia"),
        ("ASS-0019","Deposito Mezzi Napoli","deposito","Via Circumvallazione Esterna 44","Napoli","NA","80144",40.8700,14.2700,"Sig. Vincenzo Marino","081-5678901","v.marino@abc.it",5100,2006,"attivo","Deposito flotta aziendale Sud Italia"),
        ("ASS-0020","Deposito Mezzi Cagliari","deposito","Via Industriale 12","Cagliari","CA","09122",39.2238,9.1217,"Sig.ra Paola Sanna","070-3456789","p.sanna@abc.it",3800,2009,"attivo","Deposito flotta aziendale Sardegna"),
    ]
    cur = conn.cursor()
    for a in assets:
        cur.execute("""
            INSERT INTO assets
            (codice,nome,tipo,indirizzo,citta,provincia,cap,lat,lon,
             referente,telefono,email,superficie_mq,anno_costruzione,stato,note)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (codice) DO NOTHING
        """, a)
    conn.commit()
    cur.close()
    log.info("Asset inseriti.")


def popola_monitoraggio(conn):
    now = datetime.now()
    cur = conn.cursor()
    assets = {}
    cur.execute("SELECT codice, id FROM assets")
    for row in cur.fetchall():
        assets[row[0]] = row[1]

    monitoraggio = [
        (assets["ASS-0001"],now,None,None,None,None, 312,380,8,10,4850, None,None,None,None, None,None,None,None,None),
        (assets["ASS-0002"],now,None,None,None,None, 198,240,6,8,3200,  None,None,None,None, None,None,None,None,None),
        (assets["ASS-0003"],now,None,None,None,None,   0,  0,0,12,   0, None,None,None,None, None,None,None,None,None),
        (assets["ASS-0004"],now,None,None,None,None, 145,180,5,6,2100,  None,None,None,None, None,None,None,None,None),
        (assets["ASS-0005"],now,None,None,None,None, 110,150,4,5,1750,  None,None,None,None, None,None,None,None,None),
        (assets["ASS-0006"],now,187,250,4,8, None,None,None,None,None, None,None,None,None, None,None,None,None,None),
        (assets["ASS-0007"],now, 94,120,3,6, None,None,None,None,None, None,None,None,None, None,None,None,None,None),
        (assets["ASS-0008"],now, 62, 80,2,4, None,None,None,None,None, None,None,None,None, None,None,None,None,None),
        (assets["ASS-0009"],now, 41, 60,1,3, None,None,None,None,None, None,None,None,None, None,None,None,None,None),
        (assets["ASS-0010"],now, 78,100,2,5, None,None,None,None,None, None,None,None,None, None,None,None,None,None),
        (assets["ASS-0011"],now, 29, 40,1,2, None,None,None,None,None, None,None,None,None, None,None,None,None,None),
        (assets["ASS-0012"],now,None,None,None,None, None,None,None,None,None, 48,12,15,78, None,None,None,None,None),
        (assets["ASS-0013"],now,None,None,None,None, None,None,None,None,None, 31, 8,10,62, None,None,None,None,None),
        (assets["ASS-0014"],now,None,None,None,None, None,None,None,None,None, 55,14,18,85, None,None,None,None,None),
        (assets["ASS-0015"],now,None,None,None,None, None,None,None,None,None, 22, 6, 8,45, None,None,None,None,None),
        (assets["ASS-0016"],now,None,None,None,None, None,None,None,None,None,  0, 0,12, 0, None,None,None,None,None),
        (assets["ASS-0017"],now,None,None,None,None, None,None,None,None,None, None,None,None,None, 38,52,4,10,24),
        (assets["ASS-0018"],now,None,None,None,None, None,None,None,None,None, None,None,None,None, 27,36,2, 7,18),
        (assets["ASS-0019"],now,None,None,None,None, None,None,None,None,None, None,None,None,None, 19,28,3, 6,10),
        (assets["ASS-0020"],now,None,None,None,None, None,None,None,None,None, None,None,None,None, 11,16,1, 4, 6),
    ]
    for m in monitoraggio:
        cur.execute("""
            INSERT INTO monitoraggio
            (asset_id,aggiornato_il,
             dipendenti_presenti,capienza_massima,sale_riunioni_occupate,sale_riunioni_totali,
             personale_attivo,capacita_personale,linee_produzione_attive,linee_produzione_totali,
             media_produzione_giornaliera_pz,
             operatori_presenti,mezzi_magazzino_presenti,mezzi_magazzino_totali,saturazione_stoccaggio_pct,
             mezzi_presenti,mezzi_totali,mezzi_in_manutenzione,mezzi_in_missione,mezzi_disponibili)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (asset_id) DO NOTHING
        """, m)
    conn.commit()
    cur.close()
    log.info("Monitoraggio inserito.")


def popola_thresholds(conn):
    soglie = [
        ("ufficio", "dipendenti_presenti",      "Occupancy ufficio",           70.0, 90.0, "%", 1, "capienza_massima",         0),
        ("ufficio", "sale_riunioni_occupate",    "Sale riunioni occupate",      75.0, 95.0, "%", 1, "sale_riunioni_totali",     0),
        ("stabilimento", "linee_produzione_attive", "Linee produzione attive", 60.0, 40.0, "%", 1, "linee_produzione_totali",  1),
        ("stabilimento", "personale_attivo",     "Personale attivo",            85.0,100.0, "%", 1, "capacita_personale",       0),
        ("magazzino", "saturazione_stoccaggio_pct","Saturazione stoccaggio",   80.0, 92.0, "%", 1, None,                       0),
        ("magazzino", "mezzi_operativi",         "Mezzi operativi",             50.0, 30.0, "%", 1, "mezzi_totali",             1),
        ("deposito",  "mezzi_disponibili",       "Mezzi disponibili",           50.0, 30.0, "%", 1, "mezzi_totali",             1),
        ("deposito",  "mezzi_in_manutenzione",   "Mezzi in manutenzione",       30.0, 50.0, "%", 1, "mezzi_totali",             0),
    ]
    cur = conn.cursor()
    for s in soglie:
        cur.execute("""
            INSERT INTO thresholds
            (asset_tipo, campo, label, warning_value, alarm_value, unita,
             is_percentage, campo_totale, inverso)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (asset_tipo, campo) DO NOTHING
        """, s)
    conn.commit()
    cur.close()
    log.info("Soglie inserite.")


def popola_esg(conn):
    now = datetime.now()
    FE_EL = 0.233
    FE_GAS = 2.04
    cur = conn.cursor()
    cur.execute("SELECT codice, id FROM assets")
    assets = {row[0]: row[1] for row in cur.fetchall()}

    dati = [
        (assets["ASS-0001"], now, 4850, 38.5, 4000, 30.0, 210.0),
        (assets["ASS-0002"], now, 3200, 24.0, 4000, 30.0, 140.0),
        (assets["ASS-0003"], now,  180,  2.1, 4000, 30.0,   8.0),
        (assets["ASS-0004"], now, 2100, 18.0, 4000, 30.0,  95.0),
        (assets["ASS-0005"], now, 1750, 14.5, 4000, 30.0,  78.0),
        (assets["ASS-0006"], now,  620,  4.8,  500,  4.0,  28.0),
        (assets["ASS-0007"], now,  310,  2.4,  500,  4.0,  14.0),
        (assets["ASS-0008"], now,  210,  1.6,  500,  4.0,   9.5),
        (assets["ASS-0009"], now,  165,  1.2,  500,  4.0,   7.2),
        (assets["ASS-0010"], now,  280,  2.1,  500,  4.0,  12.0),
        (assets["ASS-0011"], now,  125,  0.9,  500,  4.0,   5.5),
        (assets["ASS-0012"], now, 1850, 12.0, 1500, 10.0,  45.0),
        (assets["ASS-0013"], now,  920,  6.5, 1500, 10.0,  22.0),
        (assets["ASS-0014"], now, 1420,  9.8, 1500, 10.0,  35.0),
        (assets["ASS-0015"], now,  610,  4.2, 1500, 10.0,  15.0),
        (assets["ASS-0016"], now,   95,  0.5, 1500, 10.0,   2.0),
        (assets["ASS-0017"], now,  480,  3.2,  400,  3.0,  18.0),
        (assets["ASS-0018"], now,  340,  2.3,  400,  3.0,  12.5),
        (assets["ASS-0019"], now,  265,  1.8,  400,  3.0,   9.8),
        (assets["ASS-0020"], now,  155,  1.1,  400,  3.0,   5.8),
    ]
    for d in dati:
        asset_id, ts, kwh, m3, bench_kwh, bench_m3, gas = d
        co2_s1 = round(gas * FE_GAS, 1)
        co2_s2 = round(kwh * FE_EL, 1)
        co2_tot = round(co2_s1 + co2_s2, 1)
        ratio = kwh / bench_kwh if bench_kwh > 0 else 1.0
        if ratio <= 1.0:
            rating = "A"
        elif ratio <= 1.2:
            rating = "B"
        elif ratio <= 1.5:
            rating = "C"
        else:
            rating = "D"
        cur.execute("""
            INSERT INTO esg
            (asset_id, aggiornato_il, consumo_kwh_giorno, consumo_m3_acqua_giorno,
             benchmark_kwh, benchmark_m3, fattore_emissione_kwh,
             consumo_gas_m3_giorno, co2_scope1_kg_giorno, co2_scope2_kg_giorno,
             co2_totale_kg_giorno, rating_esg)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (asset_id) DO NOTHING
        """, (asset_id, ts, kwh, m3, bench_kwh, bench_m3, FE_EL, gas, co2_s1, co2_s2, co2_tot, rating))
    conn.commit()
    cur.close()
    log.info("ESG inserito.")


def popola_config(conn):
    config = [
        ("tema",            "dark"),
        ("lingua",          "it"),
        ("rotte_marittime", "false"),
        ("app_version",     "3.0"),
    ]
    cur = conn.cursor()
    for c in config:
        cur.execute(
            "INSERT INTO config (chiave,valore) VALUES (%s,%s) ON CONFLICT (chiave) DO NOTHING",
            c
        )
    conn.commit()
    cur.close()
    log.info("Config inserita.")


def ricalcola_allarmi(conn):
    cur = conn.cursor()
    cur.execute("DELETE FROM alarms")
    cur.execute("SELECT id, asset_tipo, campo, label, warning_value, alarm_value, unita, is_percentage, campo_totale, inverso FROM thresholds")
    thresholds = [dict(zip([d[0] for d in cur.description], row)) for row in cur.fetchall()]
    now = datetime.now()

    for t in thresholds:
        cur.execute("SELECT id FROM assets WHERE tipo=%s", (t["asset_tipo"],))
        asset_rows = cur.fetchall()
        for (asset_id,) in asset_rows:
            cur.execute("SELECT * FROM monitoraggio WHERE asset_id=%s", (asset_id,))
            row = cur.fetchone()
            if not row:
                continue
            cols = [d[0] for d in cur.description]
            mon = dict(zip(cols, row))
            try:
                valore = mon.get(t["campo"])
                if valore is None:
                    continue
                valore = float(valore)
            except (KeyError, TypeError, ValueError):
                continue

            if t["is_percentage"] and t["campo_totale"]:
                totale = mon.get(t["campo_totale"])
                if not totale or float(totale) == 0:
                    continue
                pct = (valore / float(totale)) * 100.0
            elif t["is_percentage"]:
                pct = valore
            else:
                pct = valore

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
                cur.execute("""
                    INSERT INTO alarms (asset_id, campo, valore, livello, stato, created_at)
                    VALUES (%s,%s,%s,%s,%s,%s)
                """, (asset_id, t["campo"], round(pct, 1), livello, livello, now))
    conn.commit()
    cur.close()
    log.info("Allarmi ricalcolati.")


def popola_work_orders(conn):
    now = datetime.now()
    today = datetime.now().date()
    ieri = today - timedelta(days=1)
    tre_giorni_fa = today - timedelta(days=3)
    tra_tre_giorni = today + timedelta(days=3)
    tra_sette_giorni = today + timedelta(days=7)
    tra_quindici_giorni = today + timedelta(days=15)
    un_mese_fa = today - timedelta(days=30)

    cur = conn.cursor()
    cur.execute("SELECT id FROM assets WHERE codice='ASS-0001'")
    r = cur.fetchone()
    if not r:
        cur.close()
        return

    work_orders = [
        ("WO-0001", 1, "correttivo", "critica", "aperto",
         "Linea produzione 3 ferma — guasto encoder",
         "La linea 3 si è fermata alle 06:42. Encoder motore principale fuori tolleranza.",
         "Ing. Marco Ferretti", None, now, None, None, "admin", None),
        ("WO-0002", 6, "correttivo", "alta", "in_corso",
         "Occupancy sale riunioni — piano 3 bloccato",
         "Sistema prenotazione sale piano 3 non risponde.",
         "IT Support", None, datetime.combine(tre_giorni_fa, datetime.min.time()), None, None, "manager", None),
        ("WO-0003", 12, "correttivo", "alta", "aperto",
         "Saturazione magazzino zona B oltre soglia",
         "Zona B al 94% di saturazione.",
         "Resp. Logistica", None, datetime.combine(ieri, datetime.min.time()), None, None, "admin", None),
        ("WO-0004", 17, "correttivo", "media", "in_corso",
         "Mezzo D-07 in avaria — freni",
         "Mezzo D-07 segnalato con anomalia freni.",
         "Officina Centrale", None, datetime.combine(ieri, datetime.min.time()), None, None, "manager", None),
        ("WO-0005", 1, "preventivo", "media", "aperto",
         "Manutenzione programmata impianto HVAC — semestrale",
         "Revisione semestrale impianto climatizzazione.",
         "Manutentori Esterni SpA", None, now, tra_sette_giorni, None, "admin", None),
        ("WO-0006", 3, "preventivo", "bassa", "aperto",
         "Ispezione impianto elettrico — normativa CEI",
         "Verifica periodica impianto elettrico CEI 64-8.",
         "Elettricisti Certificati Srl", None, now, tra_quindici_giorni, None, "admin", None),
        ("WO-0007", 12, "preventivo", "media", "aperto",
         "Taratura bilance e transpallet — revisione annuale",
         "Taratura annuale obbligatoria.",
         "Metrology Service", None, now, tra_sette_giorni, None, "manager", None),
        ("WO-0008", 17, "preventivo", "alta", "aperto",
         "Revisione tagliando flotta — 5 mezzi scaduti",
         "5 mezzi con tagliando scaduto o in scadenza.",
         "Officina Centrale", None, now, tra_tre_giorni, None, "admin", None),
        ("WO-0009", 2, "ispezione", "bassa", "aperto",
         "Ispezione sicurezza antincendio — piano produzione",
         "Ispezione periodica estintori e vie di fuga.",
         "RSPP Aziendale", None, now, tra_quindici_giorni, None, "manager", None),
        ("WO-0010", 6, "ispezione", "bassa", "aperto",
         "Audit accessibilità uffici — D.Lgs 81/2008",
         "Verifica conformità postazioni di lavoro.",
         "RSPP Aziendale", None, now, tra_quindici_giorni, None, "manager", None),
        ("WO-0011", 4, "correttivo", "critica", "completato",
         "Guasto linea 2 — sostituzione cinghia trasmissione",
         "Linea 2 ferma per rottura cinghia. Intervento completato in 4 ore.",
         "Ing. Marco Ferretti", None,
         datetime.combine(un_mese_fa, datetime.min.time()),
         None,
         datetime.combine(un_mese_fa, datetime.min.time()),
         "admin", "Cinghia sostituita. Linea riavviata."),
        ("WO-0012", 7, "preventivo", "media", "completato",
         "Manutenzione ascensori — certificazione annuale",
         "Rinnovo certificazione ascensori DPR 162/99.",
         "Ascensori Service Srl", None,
         datetime.combine(un_mese_fa, datetime.min.time()),
         un_mese_fa,
         datetime.combine(un_mese_fa, datetime.min.time()),
         "manager", "Certificazione rinnovata."),
        ("WO-0013", 9, "correttivo", "bassa", "annullato",
         "Sostituzione lampade corridoio est — piano 2",
         "Segnalazione lampade fulminate. Annullato.",
         None, None,
         datetime.combine(tre_giorni_fa, datetime.min.time()),
         None, None, "manager", "Coperto da contratto manutenzione ordinaria."),
    ]

    for wo in work_orders:
        cur.execute("""
            INSERT INTO work_orders
            (codice, asset_id, tipo, priorita, stato, titolo, descrizione,
             assegnatario, allarme_id, data_apertura, data_pianificata,
             data_chiusura, creato_da, note_chiusura)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (codice) DO NOTHING
        """, wo)
    conn.commit()
    cur.close()
    log.info("Work order inseriti.")


def popola_bems(conn):
    """Popola le tabelle BEMS: floors, zones, plants per l'asset Sede Centrale."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    # Trova l'asset principale (Sede Centrale o primo ufficio)
    cur.execute("SELECT id FROM assets WHERE tipo='ufficio' ORDER BY id LIMIT 1")
    row = cur.fetchone()
    if not row:
        log.info("Nessun asset ufficio trovato, skip seed BEMS.")
        return
    asset_id = row["id"]

    # Piani
    piani = [
        (asset_id, "P4", "Piano 4", 4, 1200.0, "piano4_clean.svg"),
        (asset_id, "P5", "Piano 5", 5, 950.0,  "piano5_simple.svg"),
    ]
    for p in piani:
        cur.execute("""
            INSERT INTO floors (asset_id, floor_id, nome, level, superficie_mq, svg_file)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (asset_id, floor_id) DO NOTHING
        """, p)

    # Zone Piano 4
    zone_p4 = [
        (asset_id, "P4", "Z-P4-01", "Ufficio 1",       "ufficio",   80.0,  8),
        (asset_id, "P4", "Z-P4-02", "Ufficio 2",       "ufficio",   80.0,  8),
        (asset_id, "P4", "Z-P4-03", "Ufficio 3",       "ufficio",   80.0,  8),
        (asset_id, "P4", "Z-P4-04", "Ufficio 4",       "ufficio",   80.0,  8),
        (asset_id, "P4", "Z-P4-05", "Dir. Generale",   "ufficio",  120.0,  4),
        (asset_id, "P4", "Z-P4-06", "Sala Riunioni",   "sala",     150.0, 20),
        (asset_id, "P4", "Z-P4-07", "Lab IoT",         "laboratorio",100.0,10),
        (asset_id, "P4", "Z-P4-08", "Open Space A",    "open_space",200.0, 25),
        (asset_id, "P4", "Z-P4-09", "Open Space B",    "open_space",180.0, 20),
        (asset_id, "P4", "Z-P4-10", "Sala Break",      "break",     60.0, 15),
    ]
    # Zone Piano 5
    zone_p5 = [
        (asset_id, "P5", "Z-P5-01", "Sala Flip 1",     "sala",     120.0, 15),
        (asset_id, "P5", "Z-P5-02", "Sala Flip 2",     "sala",     120.0, 15),
        (asset_id, "P5", "Z-P5-03", "Sales",           "ufficio",   90.0, 10),
        (asset_id, "P5", "Z-P5-04", "CEO+CFO",         "ufficio",  150.0,  4),
        (asset_id, "P5", "Z-P5-05", "CTO",             "ufficio",   80.0,  3),
        (asset_id, "P5", "Z-P5-06", "AMM.",            "ufficio",   70.0,  4),
        (asset_id, "P5", "Z-P5-07", "Open Space",      "open_space",300.0, 30),
    ]
    for z in zone_p4 + zone_p5:
        cur.execute("""
            INSERT INTO zones (asset_id, floor_id, zone_id, nome, tipo, superficie_mq, capacita_persone)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (asset_id, zone_id) DO NOTHING
        """, z)

    # Impianti
    impianti = [
        (asset_id, "P4", None, "IMP-P4-HVAC",  "HVAC Piano 4",              "hvac",          "Carrier",  "30XA-P4",  2018, "operativo", 45.0),
        (asset_id, "P5", None, "IMP-P5-HVAC",  "HVAC Piano 5",              "hvac",          "Carrier",  "30XA-P5",  2020, "operativo", 38.0),
        (asset_id, "P4", None, "IMP-P4-LUX",   "Illuminazione P4",          "illuminazione", "Philips",  "HUE-PRO",  2021, "operativo", 12.0),
        (asset_id, "P5", None, "IMP-P5-LUX",   "Illuminazione P5",          "illuminazione", "Philips",  "HUE-PRO",  2021, "operativo", 10.0),
        (asset_id, None, None, "IMP-MAIN-MTR", "Contatore Principale",       "contatore",     "ABB",      "B23-312",  2019, "operativo", None),
        (asset_id, "P4", None, "IMP-P4-SUB",   "Sub-meter Piano 4",         "contatore",     "ABB",      "B21-213",  2019, "operativo", None),
        (asset_id, "P5", None, "IMP-P5-SUB",   "Sub-meter Piano 5",         "contatore",     "ABB",      "B21-213",  2020, "operativo", None),
        (asset_id, None, None, "IMP-CED",      "CED (Data Center)",          "ced",           "Dell",     "PowerEdge",2022, "operativo",  8.5),
        (asset_id, None, None, "IMP-SERV-EM",  "Servizi Elettromeccanici",   "servizi_em",    "Schneider","EcoStruxure",2021,"operativo",12.0),
    ]
    for imp in impianti:
        cur.execute("""
            INSERT INTO plants (asset_id, floor_id, zone_id, plant_id, nome, tipo, marca, modello, anno_installazione, stato, energy_baseline_kw)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (asset_id, plant_id) DO NOTHING
        """, imp)

    conn.commit()
    cur.close()
    log.info("Dati BEMS inseriti (floors, zones, plants).")


def init_db():
    """Funzione principale: crea schema e popola dati demo."""
    log.info(f"Connessione a PostgreSQL: {DATABASE_URL}")
    conn = get_conn()
    try:
        crea_schema(conn)
        popola_utenti(conn)
        popola_assets(conn)
        popola_monitoraggio(conn)
        popola_thresholds(conn)
        popola_esg(conn)
        popola_config(conn)
        ricalcola_allarmi(conn)
        popola_work_orders(conn)
        popola_bems(conn)
        log.info("Database inizializzato con successo.")
    finally:
        conn.close()


if __name__ == "__main__":
    init_db()
