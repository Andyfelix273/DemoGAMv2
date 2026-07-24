# GAM — GIS Asset Manager + BEMS

**Piattaforma di gestione e monitoraggio energetico degli asset aziendali** sviluppata da [KeyBiz](https://www.keybiz.it) per il progetto Metamorphosis.

---

## Panoramica

GAM è un sistema full-stack composto da:

- **Backend FastAPI** con PostgreSQL/TimescaleDB per la gestione di asset, consumi energetici, occupancy e telemetria BEMS
- **Frontend HTML/JS** con mappa interattiva Leaflet, dashboard energetica e pannello dettaglio asset
- **BEMS** (Building Energy Management System) con telemetria real-time per zone e impianti
- **Gateway Simulator** per la generazione di dati di telemetria realistici

---

## Struttura del progetto

```
gam-project/
├── backend/
│   ├── main_pg.py                   # Entry point FastAPI (PostgreSQL)
│   ├── energy_pg.py                 # Endpoint consumi energetici + BEMS
│   ├── occupancy_pg.py              # Endpoint occupancy
│   ├── init_db_pg.py                # Inizializzazione e seed del database
│   ├── gateway_simulator_pg.py      # Simulatore gateway IoT
│   └── Dockerfile
├── frontend/
│   └── static/
│       ├── efficiency-map.html           # Mappa interattiva asset
│       ├── efficiency-assets.html        # Anagrafica asset
│       ├── efficiency-alarms.html        # Allarmi energetici
│       ├── efficiency-settings.html      # Impostazioni
│       ├── bems-floorplan.html           # Viewer planimetrie BEMS
│       ├── css/
│       │   ├── theme.css                 # Tema globale dark/light
│       │   └── map.css                   # Stili mappa e pannelli
│       ├── js/
│       │   ├── efficiency-detail-modal.js   # Modale dettaglio asset (condivisa)
│       │   ├── efficiency-map-core.js       # Nucleo mappa Leaflet
│       │   ├── efficiency-map-stats.js      # Pannello statistiche mappa
│       │   ├── efficiency-map-config.js     # Configurazione mappa
│       │   ├── api.js                       # Client API con autenticazione JWT
│       │   └── config.js                    # Configurazione globale
│       └── svg/
│           ├── piano4_clean_opt.svg         # Planimetria Piano 4
│           └── piano5_final_opt.svg         # Planimetria Piano 5
├── docs/
│   ├── MANUS_HANDOVER.md            # Documentazione completa del progetto
│   └── ARCHITECTURE.md              # Architettura tecnica
├── docker-compose.yml
└── README.md
```

---

## Avvio rapido

### Prerequisiti

- Docker Desktop
- Docker Compose

### Avvio

```bash
docker-compose up -d
```

Il sistema sarà disponibile su `http://localhost:8500`.

Credenziali di default:
- **Username:** `admin`
- **Password:** `demo2026`

---

## Funzionalità principali

### Mappa interattiva
- Visualizzazione geografica di tutti gli asset su mappa Leaflet (tiles Jawg Maps)
- Colorazione marker per livello di efficienza energetica (alta/media/bassa)
- Pannello laterale con quadro energetico in tempo reale
- Filtri per tipologia asset (stabilimento, ufficio, magazzino, deposito)

### Modale dettaglio asset (7 tab)

| Tab | Contenuto |
|-----|-----------|
| Anagrafica | Dati anagrafici, stato, meteo live |
| Consumi | Grafico Plotly storico + KPI real-time da BEMS |
| Occupancy | Occupancy per zona BEMS raggruppata per piano |
| Allarmi | Allarmi energetici attivi |
| ESG | Rating ESG e indicatori di sostenibilità |
| Impianti | Lista impianti BEMS con stato e potenza |
| Zone | Zone BEMS con superficie, capienza e telemetria |

### BEMS (Building Energy Management System)
- **17 zone** su **2 piani** per la Sede Centrale Roma (asset_id=6)
- **7 impianti** monitorati (HVAC, illuminazione, UPS, ecc.)
- Telemetria real-time: potenza kW, temperatura, umidità, CO₂, occupancy
- Storico 48 ore con intervalli da 15 minuti
- Viewer planimetrie interattivo con colorazione zone per metrica

### Gateway Simulator

```bash
# Backfill storico 48 ore
python3 gateway_simulator_pg.py --mode backfill --hours 48

# Loop real-time (ogni 60s)
python3 gateway_simulator_pg.py --mode realtime
```

---

## API principali

| Endpoint | Descrizione |
|----------|-------------|
| `GET /api/assets` | Lista asset (con `?geojson=true` per GeoJSON) |
| `GET /api/energy/readings/{id}` | Letture energetiche per asset |
| `GET /api/energy/heatmap` | Efficienza energetica per mappa |
| `GET /api/bems/buildings/{id}/floors` | Piani BEMS |
| `GET /api/bems/buildings/{id}/zones` | Zone BEMS |
| `GET /api/bems/buildings/{id}/plants` | Impianti BEMS |
| `GET /api/bems/buildings/{id}/telemetry/latest` | Ultima telemetria per zona |
| `GET /api/bems/buildings/{id}/telemetry/history` | Storico telemetria |
| `POST /api/bems/telemetry/batch` | Inserimento batch telemetria |

---

## Stack tecnologico

| Layer | Tecnologia |
|-------|-----------|
| Backend | Python 3.11, FastAPI, SQLAlchemy |
| Database | PostgreSQL 16 + TimescaleDB |
| Frontend | HTML5, Vanilla JS, CSS3 |
| Mappa | Leaflet.js 1.9.4, Jawg Maps |
| Grafici | Plotly.js 2.27 |
| Auth | JWT (python-jose) |
| Deploy | Docker, Docker Compose |

---

## Licenza

Proprietà di KeyBiz S.r.l. — Tutti i diritti riservati.
