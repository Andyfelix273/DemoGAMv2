"""
GIS Asset Manager - Inizializzazione Database
Versione: 2.0
Autore: Felix / KeyBiz

Crea e popola il database SQLite con:
- users: utenti con ruoli admin/user
- assets: 20 asset fittizi georeferenziati
- monitoraggio: dati operativi simulati per ogni asset
- thresholds: soglie di warning e alarm per tipo asset
- alarms: allarmi generati dal confronto monitoraggio/soglie
- config: configurazione applicazione
"""

import sqlite3
import os
from passlib.context import CryptContext
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets.db")
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def crea_schema(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'user',
        nome_completo TEXT,
        email         TEXT,
        created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS assets (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        codice            TEXT UNIQUE NOT NULL,
        nome              TEXT NOT NULL,
        tipo              TEXT NOT NULL,
        indirizzo         TEXT,
        citta             TEXT,
        provincia         TEXT,
        cap               TEXT,
        lat               REAL NOT NULL,
        lon               REAL NOT NULL,
        referente         TEXT,
        telefono          TEXT,
        email             TEXT,
        superficie_mq     INTEGER,
        anno_costruzione  INTEGER,
        stato             TEXT DEFAULT 'attivo',
        note              TEXT,
        created_at        TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS monitoraggio (
        id                              INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id                        INTEGER UNIQUE REFERENCES assets(id),
        aggiornato_il                   TEXT,
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
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_tipo    TEXT NOT NULL,
        campo         TEXT NOT NULL,
        label         TEXT,
        warning_value REAL NOT NULL,
        alarm_value   REAL NOT NULL,
        unita         TEXT,
        is_percentage INTEGER NOT NULL DEFAULT 1,  -- 1=soglie in %, 0=valore assoluto
        campo_totale  TEXT,                         -- campo denominatore per calcolo %
        inverso       INTEGER NOT NULL DEFAULT 0,   -- 1=basso è brutto (es. mezzi disponibili)
        UNIQUE(asset_tipo, campo)
    );

    CREATE TABLE IF NOT EXISTS alarms (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id   INTEGER REFERENCES assets(id),
        campo      TEXT NOT NULL,
        valore     REAL,
        livello    TEXT NOT NULL,
        stato      TEXT NOT NULL DEFAULT 'warning',
        created_at TEXT,
        ack_at     TEXT
    );

    CREATE TABLE IF NOT EXISTS esg (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id                INTEGER UNIQUE REFERENCES assets(id),
        aggiornato_il           TEXT,
        consumo_kwh_giorno      REAL,
        consumo_m3_acqua_giorno REAL,
        benchmark_kwh           REAL,
        benchmark_m3            REAL,
        fattore_emissione_kwh   REAL DEFAULT 0.233,
        consumo_gas_m3_giorno   REAL,
        co2_scope1_kg_giorno    REAL,
        co2_scope2_kg_giorno    REAL,
        co2_totale_kg_giorno    REAL,
        rating_esg              TEXT
    );

    CREATE TABLE IF NOT EXISTS config (
        chiave TEXT PRIMARY KEY,
        valore TEXT NOT NULL
    );
    """)
    conn.commit()


def popola_utenti(conn):
    utenti = [
        ("admin", pwd_context.hash("demo2026"), "admin", "Amministratore", "admin@keybiz.it"),
        ("user",  pwd_context.hash("user2026"),  "user",  "Utente Demo",    "user@keybiz.it"),
    ]
    for u in utenti:
        conn.execute("""
            INSERT OR IGNORE INTO users (username, password_hash, role, nome_completo, email)
            VALUES (?,?,?,?,?)
        """, u)
    conn.commit()


def popola_assets(conn):
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
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
    for a in assets:
        conn.execute("""
            INSERT OR IGNORE INTO assets
            (codice,nome,tipo,indirizzo,citta,provincia,cap,lat,lon,
             referente,telefono,email,superficie_mq,anno_costruzione,stato,note)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, a)
    conn.commit()


def popola_monitoraggio(conn):
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    assets = {row[0]: row[1] for row in conn.execute("SELECT codice, id FROM assets").fetchall()}

    # (asset_id, aggiornato_il, dip_pres, cap_max, sale_occ, sale_tot,
    #  pers_att, cap_pers, linee_att, linee_tot, media_pz,
    #  oper_pres, mezzi_mag_pres, mezzi_mag_tot, sat_pct,
    #  mezzi_pres, mezzi_tot, mezzi_man, mezzi_miss, mezzi_disp)
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
        conn.execute("""
            INSERT OR IGNORE INTO monitoraggio
            (asset_id,aggiornato_il,
             dipendenti_presenti,capienza_massima,sale_riunioni_occupate,sale_riunioni_totali,
             personale_attivo,capacita_personale,linee_produzione_attive,linee_produzione_totali,
             media_produzione_giornaliera_pz,
             operatori_presenti,mezzi_magazzino_presenti,mezzi_magazzino_totali,saturazione_stoccaggio_pct,
             mezzi_presenti,mezzi_totali,mezzi_in_manutenzione,mezzi_in_missione,mezzi_disponibili)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, m)
    conn.commit()


def popola_thresholds(conn):
    """
    Soglie in percentuale (is_percentage=1).
    warning_value e alarm_value sono sempre % (0-100).
    inverso=1: basso è brutto (es. mezzi disponibili bassi = allarme).
    campo_totale: campo denominatore per calcolare la % (None = già una %).
    """
    soglie = [
        # (asset_tipo, campo, label, warning_value, alarm_value, unita,
        #  is_percentage, campo_totale, inverso)
        # Uffici
        ("ufficio", "dipendenti_presenti",
         "Occupancy ufficio", 70.0, 90.0, "%", 1, "capienza_massima", 0),
        ("ufficio", "sale_riunioni_occupate",
         "Sale riunioni occupate", 75.0, 95.0, "%", 1, "sale_riunioni_totali", 0),
        # Stabilimenti
        ("stabilimento", "linee_produzione_attive",
         "Linee produzione attive", 60.0, 40.0, "%", 1, "linee_produzione_totali", 1),
        ("stabilimento", "personale_attivo",
         "Personale attivo", 85.0, 100.0, "%", 1, "capienza_personale", 0),
        # Magazzini
        ("magazzino", "saturazione_stoccaggio_pct",
         "Saturazione stoccaggio", 80.0, 92.0, "%", 1, None, 0),
        ("magazzino", "mezzi_operativi",
         "Mezzi operativi", 50.0, 30.0, "%", 1, "mezzi_totali", 1),
        # Depositi
        ("deposito", "mezzi_disponibili",
         "Mezzi disponibili", 50.0, 30.0, "%", 1, "mezzi_totali", 1),
        ("deposito", "mezzi_in_manutenzione",
         "Mezzi in manutenzione", 30.0, 50.0, "%", 1, "mezzi_totali", 0),
    ]
    for s in soglie:
        conn.execute("""
            INSERT OR IGNORE INTO thresholds
            (asset_tipo, campo, label, warning_value, alarm_value, unita,
             is_percentage, campo_totale, inverso)
            VALUES (?,?,?,?,?,?,?,?,?)
        """, s)
    conn.commit()


def popola_esg(conn):
    """Popola i dati ESG simulati per ogni asset con valori realistici per tipo."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    assets = {row[0]: row[1] for row in conn.execute("SELECT codice, id FROM assets").fetchall()}
    # Fattore emissione rete elettrica italiana (ISPRA 2023): 0.233 kg CO2/kWh
    # Fattore emissione gas naturale: 2.04 kg CO2/m3
    FE_EL = 0.233
    FE_GAS = 2.04

    # (asset_id, aggiornato_il, kwh/g, m3_acqua/g, bench_kwh, bench_m3, gas_m3/g)
    # Stabilimenti: alto consumo energetico e idrico
    # Uffici: consumo medio-basso
    # Magazzini: consumo medio (illuminazione, movimentazione)
    # Depositi: consumo basso (illuminazione, officina)
    dati = [
        # Stabilimenti
        (assets["ASS-0001"], now, 4850, 38.5, 4000, 30.0, 210.0),
        (assets["ASS-0002"], now, 3200, 24.0, 4000, 30.0, 140.0),
        (assets["ASS-0003"], now,  180,  2.1, 4000, 30.0,   8.0),  # fermo manutenzione
        (assets["ASS-0004"], now, 2100, 18.0, 4000, 30.0,  95.0),
        (assets["ASS-0005"], now, 1750, 14.5, 4000, 30.0,  78.0),
        # Uffici
        (assets["ASS-0006"], now,  620,  4.8,  500,  4.0,  28.0),
        (assets["ASS-0007"], now,  310,  2.4,  500,  4.0,  14.0),
        (assets["ASS-0008"], now,  210,  1.6,  500,  4.0,   9.5),
        (assets["ASS-0009"], now,  165,  1.2,  500,  4.0,   7.2),
        (assets["ASS-0010"], now,  280,  2.1,  500,  4.0,  12.0),
        (assets["ASS-0011"], now,  125,  0.9,  500,  4.0,   5.5),
        # Magazzini
        (assets["ASS-0012"], now, 1850, 12.0, 1500, 10.0,  45.0),
        (assets["ASS-0013"], now,  920,  6.5, 1500, 10.0,  22.0),
        (assets["ASS-0014"], now, 1420,  9.8, 1500, 10.0,  35.0),
        (assets["ASS-0015"], now,  610,  4.2, 1500, 10.0,  15.0),
        (assets["ASS-0016"], now,   95,  0.5, 1500, 10.0,   2.0),  # fermo manutenzione
        # Depositi
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
        # Rating ESG: A se sotto benchmark, B se entro 120%, C se entro 150%, D se oltre
        ratio = kwh / bench_kwh if bench_kwh > 0 else 1.0
        if ratio <= 1.0:
            rating = "A"
        elif ratio <= 1.2:
            rating = "B"
        elif ratio <= 1.5:
            rating = "C"
        else:
            rating = "D"
        conn.execute("""
            INSERT OR IGNORE INTO esg
            (asset_id, aggiornato_il, consumo_kwh_giorno, consumo_m3_acqua_giorno,
             benchmark_kwh, benchmark_m3, fattore_emissione_kwh,
             consumo_gas_m3_giorno, co2_scope1_kg_giorno, co2_scope2_kg_giorno,
             co2_totale_kg_giorno, rating_esg)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        """, (asset_id, ts, kwh, m3, bench_kwh, bench_m3, FE_EL, gas, co2_s1, co2_s2, co2_tot, rating))
    conn.commit()


def popola_config(conn):
    config = [
        ("tema",            "dark"),
        ("lingua",          "it"),
        ("rotte_marittime", "false"),
        ("app_version",     "2.0"),
    ]
    for c in config:
        conn.execute("INSERT OR IGNORE INTO config (chiave,valore) VALUES (?,?)", c)
    conn.commit()


def ricalcola_allarmi(conn):
    """
    Ricalcola allarmi con soglie percentuali.
    - is_percentage=1 + campo_totale: pct = valore/totale*100
    - is_percentage=1 + campo_totale=None: il campo è già una %
    - inverso=1: basso = brutto
    Il valore in alarms.valore è sempre la % calcolata.
    """
    conn.execute("DELETE FROM alarms")
    thresholds = conn.execute("SELECT * FROM thresholds").fetchall()
    now = datetime.now().isoformat()
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
                conn.execute("""
                    INSERT INTO alarms (asset_id, campo, valore, livello, stato, created_at)
                    VALUES (?,?,?,?,?,?)
                """, (asset["id"], t["campo"], round(pct, 1), livello, livello, now))
    conn.commit()


if __name__ == "__main__":
    print(f"Inizializzazione database v2.0: {DB_PATH}")
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print("Database precedente rimosso.")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    crea_schema(conn)
    print("Schema creato.")

    popola_utenti(conn)
    print("Utenti: admin/demo2026, user/user2026")

    popola_assets(conn)
    n = conn.execute("SELECT COUNT(*) FROM assets").fetchone()[0]
    print(f"Asset inseriti: {n}")

    popola_monitoraggio(conn)
    print("Dati monitoraggio inseriti.")

    popola_thresholds(conn)
    print("Soglie allarme inserite.")

    popola_esg(conn)
    print("Dati ESG inseriti.")

    popola_config(conn)
    print("Configurazione inserita.")

    ricalcola_allarmi(conn)
    na = conn.execute("SELECT COUNT(*) FROM alarms").fetchone()[0]
    print(f"Allarmi calcolati: {na}")

    conn.close()
    print("Database v2.0 pronto.")
