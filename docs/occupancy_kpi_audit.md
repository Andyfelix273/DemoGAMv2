# Audit Applicabilità KPI Occupancy — 27 Luglio 2026

## Dati Disponibili nel DB

### Tabelle rilevanti
- `occupancy_snapshot`: 91.091 righe, da 2026-06-23 a 2026-07-27 (~34 giorni)
  - Campi: id, zone_id, asset_id, ts, presenti, capacita_max, pct_occupancy
- `occupancy_zones`: 13 zone su 4 asset (1, 2, 6, 7)
- `occupancy_events`: 0 righe (vuota)
- `telemetry`: 158.904 righe solo asset 6, ma co2_ppm=0, temp_c=0, humidity=0, occupancy=0 (tutti NULL)
- `zones`: tabella separata con ifc_space_guid, svg_element_id (per floorplan)
- `floors`: tabella piani con asset_id, floor_id, nome, level, superficie_mq

### Asset con dati occupancy
| asset_id | zone_id | zone_nome | area_m2 | capacita_max | avg_pct |
|---|---|---|---|---|---|
| 1 | 1 | Piano Terra | 450 | 80 | 20.3% |
| 1 | 2 | Piano 1 - Open Space | 380 | 65 | 20.1% |
| 1 | 3 | Piano 2 - Uffici Direzionali | 320 | 40 | 19.7% |
| 2 | 4 | Area Produzione A | 1200 | 120 | 20.4% |
| 2 | 5 | Area Produzione B | 800 | 80 | 20.2% |
| 2 | 6 | Uffici | 300 | 35 | 19.6% |
| 6 | 7 | Piano Terra - Reception | 350 | 60 | 20.1% |
| 6 | 8 | Piano 1 - Open Space | 420 | 75 | 20.2% |
| 6 | 9 | Piano 1 - Sale Riunioni | 180 | 30 | 19.5% |
| 6 | 10 | Piano 2 - Direzione | 280 | 25 | 19.2% |
| 7 | 11 | Magazzino Area A | 2000 | 30 | 19.4% |
| 7 | 12 | Magazzino Area B | 1500 | 25 | 19.2% |
| 7 | 13 | Uffici Operativi | 200 | 20 | 18.8% |

### Orario lavorativo configurato
Tutti e 4 gli asset: 08:00–19:00, MON–FRI

### Dati CO2/Temperatura/Umidità
- NON disponibili in telemetry (tutti NULL per asset 6, nessun altro asset)
- Nessuna tabella separata per sensori ambientali

## Applicabilità KPI per Asset (Tab Modale)

| KPI | Nome | Dati disponibili | Applicabile |
|---|---|---|---|
| O-1 | Tasso Occupazione Medio | occupancy_snapshot + working_hours | ✅ PIENO |
| O-2 | CO2 Media Ore Occupate | co2_ppm NULL in telemetry | ❌ NASCOSTO |
| O-3 | % Ore Qualità Aria Critica | co2_ppm NULL | ❌ NASCOSTO |
| O-4 | Spreco Impianti su Spazi Vuoti | No consumo per piano, no costo unitario per piano | ⚠️ PARZIALE (solo kWh se disponibile) |
| O-5 | Heatmap Occupancy zona×ora | occupancy_snapshot con zone | ✅ PIENO |
| O-6 | Pattern Settimanale | ~34 giorni dati (< 4 settimane) | ⚠️ PARZIALE (dati insufficienti per media robusta) |
| O-7 | Profilo Giornaliero 24h | ~34 giorni (< 2 settimane ok) | ✅ PIENO |
| O-8 | Qualità Aria per Zona | Nessun sensore CO2/temp/umidità | ❌ NASCOSTO |
| O-9 | Consumo per Piano vs Occupancy | No consumo per piano | ❌ NASCOSTO |
| O-10 | Trend Mensile YoY | Solo 34 giorni (< 13 mesi) | ❌ NASCOSTO (dati insufficienti) |
| O-11 | OVI Trend Settimanale | ~34 giorni (~5 settimane, < 8) | ⚠️ PARZIALE |

## Applicabilità KPI Portafoglio

| KPI | Nome | Applicabile |
|---|---|---|
| P-O1 | Tasso Utilizzo Medio Portafoglio | ✅ PIENO (4 asset con dati) |
| P-O2 | Pattern Settimanale Portafoglio | ⚠️ PARZIALE (34 giorni) |
| P-O3 | Asset Qualità Aria Critica | ❌ NASCOSTO (no CO2) |
| P-O4 | Spreco Energetico Totale Stimato | ❌ NASCOSTO (no consumo per piano) |
| P-O5 | Mappa Portafoglio Occupancy vs EUI | ✅ PIENO (4 asset con occupancy + EUI) |

## KPI da implementare (priorità)

### Tab Modale — implementare:
1. **O-1** card KPI tasso occupazione + Δ%
2. **O-5** heatmap zona×ora (Plotly heatmap)
3. **O-7** profilo giornaliero 24h (line chart)
4. **O-6** pattern settimanale (bar chart lun-dom, con avviso dati parziali)
5. **O-11** OVI trend (line chart, con avviso dati parziali)
6. **O-2, O-3, O-8, O-9, O-10, O-4** → card/sezione "non disponibile" con messaggio

### Portafoglio — implementare:
1. **P-O1** card KPI + bar chart asset
2. **P-O5** scatter plot strategico Occupancy vs EUI
3. **P-O2** bar chart settimanale (con avviso dati parziali)
4. **P-O3, P-O4** → card "non disponibile"

## Endpoint backend da creare
- `GET /api/occupancy/{asset_id}/summary?giorni=30` → O-1 (tasso medio, Δ%, zone count)
- `GET /api/occupancy/{asset_id}/heatmap?giorni=30` → O-5 (zona × ora)
- `GET /api/occupancy/{asset_id}/daily_profile?giorni=30` → O-7 (media per ora)
- `GET /api/occupancy/{asset_id}/weekly_pattern?giorni=90` → O-6 (media per giorno settimana)
- `GET /api/occupancy/{asset_id}/ovi?mesi=6` → O-11 (OVI mensile)
- `GET /api/occupancy/portfolio/summary` → P-O1 (tasso medio portafoglio per asset)
- `GET /api/occupancy/portfolio/weekly_pattern?giorni=90` → P-O2
- `GET /api/occupancy/portfolio/scatter` → P-O5 (occupancy + EUI per asset)
