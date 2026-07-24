# GAM Platform — Handover BEMS + Asset Efficiency

**Data aggiornamento:** 24 luglio 2026  
**Versione:** 3.0 — BEMS completo con telemetria real-time e Floorplan Viewer

---

## Storico versioni

| Versione | Data | Note |
|----------|------|------|
| 1.0 | 2025 | GIS Asset Manager con SQLite, deploy su Render |
| 2.0 | 2026-07 | Migrazione a PostgreSQL, modulo Asset Efficiency |
| 3.0 | 2026-07-24 | Modulo BEMS completo, simulatore gateway, Floorplan Viewer |

---

## Stato del sistema

Il sistema GAM (GIS Asset Manager) con modulo BEMS (Building Energy Management System) è completamente operativo. Di seguito il riepilogo dei componenti attivi.

### Infrastruttura Docker

| Container | Immagine | Porta | Stato |
|-----------|----------|-------|-------|
| `gam-backend` | Python 3.11 + FastAPI | 8500 | Running |
| `gam-db` | PostgreSQL 15 | 5432 (interno) | Running |

### Accesso

- **URL locale:** `http://localhost:8500`
- **Login:** `admin` / `demo2026`
- **API docs:** `http://localhost:8500/docs`

---

## Modulo BEMS — Sede Centrale Roma (asset_id = 6)

### Struttura edificio

| Piano | ID | Zone | Impianti |
|-------|----|------|----------|
| Piano 4 | P4 | 9 zone | 4 impianti |
| Piano 5 | P5 | 8 zone | 3 impianti |
| **Totale** | | **17 zone** | **7 impianti** |

### Endpoint BEMS disponibili

| Endpoint | Descrizione |
|----------|-------------|
| `GET /api/bems/buildings/{id}/floors` | Lista piani dell'edificio |
| `GET /api/bems/buildings/{id}/zones` | Lista zone (con filtro `?floor_id=P4`) |
| `GET /api/bems/buildings/{id}/plants` | Lista impianti |
| `GET /api/bems/buildings/{id}/telemetry/latest` | Ultima telemetria per zona (dict zone_id → dati) |
| `GET /api/bems/buildings/{id}/telemetry/history` | Storico telemetria (param: `ore`, `zone_id`) |
| `POST /api/bems/telemetry` | Inserisce singola lettura |
| `POST /api/bems/telemetry/batch` | Inserisce batch di letture (con campo `ts` opzionale ISO8601) |

### Dati telemetria

- **Storico:** 48 ore (dal 21 luglio 2026)
- **Real-time:** aggiornamento ogni 60 secondi via simulatore gateway
- **Totale letture:** ~5000+ (in crescita continua)
- **Campi:** `zone_id`, `floor_id`, `asset_id`, `plant_id`, `power_kw`, `temp_c`, `humidity`, `co2_ppm`, `occupancy`, `ts`

---

## Simulatore Gateway PostgreSQL

File: `/app/gateway_simulator_pg.py`

Il simulatore genera telemetria realistica per tutte le 17 zone e 7 impianti della Sede Centrale Roma.

### Utilizzo

```bash
# Backfill storico (48 ore, intervallo 15 min)
python3 /app/gateway_simulator_pg.py --backfill 48 --backfill-interval 15 --no-loop

# Loop real-time (ogni 60 secondi)
python3 /app/gateway_simulator_pg.py --interval 60

# Avvio in background nel container
docker exec -d gam-backend python3 /app/gateway_simulator_pg.py --interval 60
```

### Parametri simulati

| Parametro | Range | Note |
|-----------|-------|------|
| `power_kw` | 0.5 – 8.0 kW | Variabile per tipo zona/impianto |
| `temp_c` | 18 – 26 °C | Con variazione circadiana |
| `humidity` | 35 – 65 % | Correlata con occupancy |
| `co2_ppm` | 380 – 1200 ppm | Aumenta con occupancy |
| `occupancy` | true/false | Basata su orari lavorativi |

---

## Frontend — Pagine disponibili

| Pagina | URL | Descrizione |
|--------|-----|-------------|
| Login | `/static/login.html` | Autenticazione |
| Dashboard | `/static/dashboard.html` | KPI globali |
| Asset Efficiency | `/static/efficiency-assets.html` | Anagrafica + tab energetici |
| BEMS Floorplan | `/static/bems-floorplan.html` | Viewer planimetria interattivo |
| Mappa | `/static/efficiency-map.html` | Mappa geografica asset |

### Tab nel pannello dettaglio asset (efficiency-assets.html)

| Tab | Dati mostrati |
|-----|--------------|
| Anagrafica | Dati anagrafici asset |
| Consumi | Grafico letture + KPI real-time (kW istantaneo, temp, CO₂) |
| Occupancy | KPI aggregati + dettaglio per zona BEMS con temperatura |
| Allarmi | Anomalie energetiche |
| ESG Energia | Rating ESG, CO₂, costi |
| Impianti | Lista impianti con stato e tipo |
| Zone | Lista zone per piano con telemetria |

Il pannello dettaglio mostra anche un pulsante **"Floorplan BEMS"** (verde) per aprire il viewer interattivo, visibile solo per la Sede Centrale Roma (asset_id = 6).

---

## BEMS Floorplan Viewer

URL: `http://localhost:8500/static/bems-floorplan.html`

### Funzionalità

- **Visualizzazione planimetria SVG** per Piano 4 e Piano 5
- **4 modalità di colorazione:** Occupancy, Energia (kW), Temperatura, CO₂
- **Tooltip interattivo** con tutti i dati di telemetria per zona
- **Sidebar KPI** con aggregati per piano (potenza totale, zone occupate, temp/CO₂ media)
- **Lista zone** con stato e temperatura
- **Auto-refresh** ogni 30 secondi
- **Selezione zona** con evidenziazione

### Mapping zone SVG → BEMS (Piano 4)

| Zone ID | Label SVG |
|---------|-----------|
| Z-P4-01 | UFF. 1 |
| Z-P4-02 | UFF. 2 |
| Z-P4-03 | UFF. 3 |
| Z-P4-04 | UFF. 4 |
| Z-P4-05 | DIR. GENERALE |
| Z-P4-06 | SALA RIUNIONI |
| Z-P4-07 | OPEN SPACE A |
| Z-P4-08 | LAB IoT |
| Z-P4-09 | OPEN SPACE B |

---

## File principali nel container

```
/app/
├── main_pg.py              # FastAPI app principale
├── energy_pg.py            # Endpoint BEMS + energia
├── gateway_simulator_pg.py # Simulatore gateway telemetria
├── static/
│   ├── efficiency-assets.html  # Anagrafica + tab energetici
│   ├── bems-floorplan.html     # Viewer planimetria BEMS
│   ├── piano4_clean.svg        # Planimetria Piano 4
│   ├── piano5_simple.svg       # Planimetria Piano 5
│   └── ...
```

---

## Operazioni di manutenzione

### Riavvio del sistema

```bash
cd "C:/Users/Key-Biz srl/OneDrive - Key Biz Srl/progetti/"
docker restart gam-backend gam-db
```

### Riavvio simulatore gateway (dopo restart container)

```bash
docker exec -d gam-backend python3 /app/gateway_simulator_pg.py --interval 60
```

### Backup database

```bash
docker exec gam-db pg_dump -U gamuser gamdb > backup_gamdb_$(date +%Y%m%d).sql
```

### Verifica stato telemetria

```bash
docker exec gam-db psql -U gamuser -d gamdb -c "SELECT COUNT(*), MIN(ts), MAX(ts) FROM telemetry;"
```

---

## Note tecniche

- Il simulatore gateway deve essere riavviato manualmente dopo ogni restart del container `gam-backend`
- La tabella `telemetry` non ha TTL automatico: pianificare una pulizia periodica dei dati più vecchi di 30 giorni
- Il viewer BEMS Floorplan usa il token JWT salvato in `localStorage` dalla sessione GAM corrente; se non loggato, esegue un login automatico con `admin/demo2026`
- Per aggiungere nuovi edifici al BEMS, inserire i dati nelle tabelle `floors`, `zones`, `plants` e aggiornare il mapping `ZONE_MAP_*` nel viewer HTML

---

## Fix critiche ereditate dalla v1.0 (Render)

Se si torna a deployare su Render:
- **Bcrypt/Passlib Fix**: incompatibilità tra `passlib` e `bcrypt` su Python > 3.10. Workaround manuale in `main.py` e `init_db.py`
- **Python Version**: usare Python 3.11.0 tramite `runtime.txt` e variabile `PYTHON_VERSION`
- **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
