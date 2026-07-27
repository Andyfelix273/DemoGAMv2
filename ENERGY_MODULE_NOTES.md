# Note implementazione Modulo Efficienza Energetica — v1.5.0

## Mapping campi specifica → DB

| Campo specifica | Campo DB | Note |
|---|---|---|
| building_category | tipo (assets) | ufficio=OFFICE, stabilimento=WAREHOUSE, magazzino=WAREHOUSE, deposito=STORAGE |
| gross_floor_area_sqm | superficie_mq (assets) | già presente, 3200 per asset 6 |
| construction_year | anno_costruzione (assets) | già presente, 2010 per asset 6 |
| annual_energy_budget_eur | config table (chiave: energy_budget_{asset_id}) | nelle impostazioni |
| working_hours_start | working_hours_start (assets) | NUOVO — TIME |
| working_hours_end | working_hours_end (assets) | NUOVO — TIME |
| working_days | working_days (assets) | NUOVO — TEXT (es. "MON,TUE,WED,THU,FRI") |
| energy_class | energy_class (assets) | NUOVO — VARCHAR(10) |

## Mapping tipologie carico

| Specifica | Tipo DB (plants.tipo) | Impianti asset 6 |
|---|---|---|
| HVAC | hvac | IMP-P4-HVAC, IMP-P5-HVAC |
| LIGHTING | illuminazione | IMP-P4-LUX, IMP-P5-LUX |
| IT/CED | ced | IMP-CED |
| OUTLETS | altri_carichi | IMP-P4-SUB, IMP-P5-SUB |
| ELEVATORS/SERVIZI | servizi_em | IMP-SERV-EM |
| MAIN METER | contatore | IMP-MAIN-MTR |

## Dati disponibili asset 6

- Telemetria: 38.818 righe, 21-26 lug 2026, ~14 min granularità, 9 impianti
- Energy readings: 3.631 righe per tipo (elettrico/gas/termico), 33 giorni
- Occupancy snapshot: 26.340 righe, 33 giorni
- energy_unit_costs: VUOTO per asset 6 → seed con elettricità 0.285€/kWh, gas 0.98€/m³

## Valori seed asset 6

- working_hours_start: '08:00'
- working_hours_end: '19:00'
- working_days: 'MON,TUE,WED,THU,FRI'
- energy_class: 'C'
- energy_unit_costs: ELECTRICITY 0.285, GAS_METHANE 0.980

## Endpoint backend da creare (energy_pg.py)

1. GET /api/bems/buildings/{id}/energy/load-profile?date=&period=day|week|month
   → potenza media kW per slot 15min su 24h (da telemetry, plant_id != contatore)
   
2. GET /api/bems/buildings/{id}/energy/breakdown?from=&to=
   → kWh per tipo impianto (hvac, illuminazione, ced, altri_carichi, servizi_em)
   
3. GET /api/bems/buildings/{id}/energy/heatmap?from=&to=
   → matrice 7×24 consumo medio kWh per (giorno_settimana, ora)
   
4. GET /api/bems/buildings/{id}/energy/baseline?from=&to=
   → consumo orario reale + baseline (media ± 1σ per slot ora×giorno_settimana)
   
5. GET /api/bems/buildings/{id}/energy/kpi?month=YYYY-MM
   → E-1 costo mese, E-2 €/mq, E-3 EUI, E-4 anomalie, E-5 % fuori orario, E-6 €/persona-ora
   
6. GET /api/energy/portfolio/kpi
   → P-1..P-10 aggregati su tutti gli asset

## Struttura tab modale (efficiency-detail-modal.js)

Tab esistente: "Efficienza energetica" (già presente, da riscrivere)
Sezioni interne:
  - Sintesi: E-1..E-6 (KPI cards + gauge EUI)
  - Analisi: E-7..E-12 (grafici Plotly)
  - Trend: E-13, E-14 (grafici Plotly)

## Pagina Energy Summary

File: /static/energy-summary.html
Voce menu: "Energy Summary" nel modulo efficiency
KPI: P-1..P-10

## Regole CSS

- Classi nuove in bems-ui.css (componenti generici) o map.css (componenti modale)
- ZERO inline style salvo casi eccezionali documentati
- ZERO hardcoding colori/dimensioni fuori dai file CSS
