#!/usr/bin/env python3
"""Riscrive analisiHtml e trendHtml nel modal JS con card es-section e layout 2 colonne."""

path = '/home/ubuntu/gam-project/frontend/static/js/efficiency-detail-modal.js'

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# ── 1. Sostituisce analisiHtml ──────────────────────────────────────────────
old_analisi = '''    const analisiHtml = `
      <div class="ee-section-title" data-kpi-tip="risponde alla domanda: dove e quando consumiamo? grafici interattivi per l'analisi operativa dei consumi dell'asset."><i class="fa fa-chart-bar" style="margin-right:5px;"></i>Analisi Consumi</div>
      <div class="ee-chart-row">
        <div>
          <div class="ee-chart-label">PROFILO 24H PER TIPO IMPIANTO</div>
          <div class="ee-chart" id="ee-chart-profile24h-${assetId}"></div>
        </div>
        <div>
          <div class="ee-chart-label">RIPARTIZIONE CONSUMI (30 GG)</div>
          <div class="ee-chart" id="ee-chart-breakdown-${assetId}"></div>
        </div>
      </div>
      <div class="ee-chart-row">
        <div>
          <div class="ee-chart-label">HEATMAP ORA × GIORNO (28 GG)</div>
          <div class="ee-chart" id="ee-chart-heatmap-${assetId}"></div>
        </div>
        <div>
          <div class="ee-chart-label">BASELINE PER IMPIANTO</div>
          <div class="ee-chart" id="ee-chart-baseline-${assetId}"></div>
        </div>
      </div>
      <div class="ee-chart-row">
        <div>
          <div class="ee-chart-label">OCCUPANCY VS COSTO (14 GG)</div>
          <div class="ee-chart" id="ee-chart-occ-${assetId}"></div>
        </div>
        <div>
          <div class="ee-chart-label">HVAC VS TEMPERATURA ESTERNA (E-11)</div>
          <div class="ee-chart" id="ee-chart-hvac-temp-${assetId}"></div>
        </div>
      </div>
      <div class="ee-chart-row">
        <div style="grid-column:1/-1;">
          <div class="ee-chart-label">DECOMPOSIZIONE COSTO PER COMMODITY — 12 MESI (E-14)</div>
          <div class="ee-chart ee-chart-lg" id="ee-chart-commodity14-${assetId}"></div>
        </div>
      </div>`;'''

new_analisi = '''    const analisiHtml = `
      <div class="ee-section-title" data-kpi-tip="risponde alla domanda: dove e quando consumiamo? grafici interattivi per l'analisi operativa dei consumi dell'asset."><i class="fa fa-chart-bar"></i>Analisi Consumi</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div class="es-section" style="margin-bottom:0;">
          <div class="es-section-title" data-kpi-tip="e-7 — potenza media (kw) per slot di 15 minuti nelle 24 ore, aggregata per tipo impianto."><i class="fa fa-bolt"></i>Profilo di carico 24h <span style="font-size:10px;font-weight:400;color:var(--text-muted);margin-left:auto;">E-7</span></div>
          <div class="ee-chart" id="ee-chart-profile24h-${assetId}"></div>
        </div>
        <div class="es-section" style="margin-bottom:0;">
          <div class="es-section-title" data-kpi-tip="e-9 — distribuzione dei consumi per tipologia di impianto (hvac, illuminazione, it, prese, ascensori, processo, altro). richiede sub-metering."><i class="fa fa-chart-pie"></i>Ripartizione consumi per impianto <span style="font-size:10px;font-weight:400;color:var(--text-muted);margin-left:auto;">E-9</span></div>
          <div class="ee-chart" id="ee-chart-breakdown-${assetId}"></div>
        </div>
        <div class="es-section" style="margin-bottom:0;">
          <div class="es-section-title" data-kpi-tip="e-10 — mappa cromatica dei consumi medi per ora del giorno × giorno della settimana. identifica fasce orarie anomale e pattern di consumo."><i class="fa fa-th"></i>Heatmap ora × giorno <span style="font-size:10px;font-weight:400;color:var(--text-muted);margin-left:auto;">E-10</span></div>
          <div class="ee-chart" id="ee-chart-heatmap-${assetId}"></div>
        </div>
        <div class="es-section" style="margin-bottom:0;">
          <div class="es-section-title" data-kpi-tip="e-8 — confronto tra il consumo reale e la baseline storica (media ±1σ). i punti oltre 2σ indicano anomalie di consumo."><i class="fa fa-chart-line"></i>Baseline vs consumo reale <span style="font-size:10px;font-weight:400;color:var(--text-muted);margin-left:auto;">E-8</span></div>
          <div class="ee-chart" id="ee-chart-baseline-${assetId}"></div>
        </div>
        <div class="es-section" style="margin-bottom:0;">
          <div class="es-section-title" data-kpi-tip="e-12 — scatter plot occupancy media giornaliera vs costo energetico. il quadrante bassa occupancy + alto costo evidenzia lo spreco potenziale."><i class="fa fa-users"></i>Occupancy vs costo <span style="font-size:10px;font-weight:400;color:var(--text-muted);margin-left:auto;">E-12</span></div>
          <div class="ee-chart" id="ee-chart-occ-${assetId}"></div>
        </div>
        <div class="es-section" style="margin-bottom:0;">
          <div class="es-section-title" data-kpi-tip="e-11 — scatter plot kwh hvac giornaliero vs temperatura esterna con regressione lineare. r² indica la qualità della correlazione."><i class="fa fa-thermometer-half"></i>HVAC vs temperatura esterna <span style="font-size:10px;font-weight:400;color:var(--text-muted);margin-left:auto;">E-11</span></div>
          <div class="ee-chart" id="ee-chart-hvac-temp-${assetId}"></div>
        </div>
      </div>`;'''

# ── 2. Sostituisce trendHtml ────────────────────────────────────────────────
old_trend = '''    const trendHtml = `
      <div class="ee-section-title" data-kpi-tip="risponde alla domanda: stiamo migliorando? grafici storici per valutare l'andamento nel tempo dell'asset."><i class="fa fa-chart-line" style="margin-right:5px;"></i>Trend e Confronto</div>
      <div class="ee-chart-row">
        <div>
          <div class="ee-chart-label">CONSUMI MENSILI (kWh)</div>
          <div class="ee-chart" id="ee-chart-trend-kwh-${assetId}"></div>
        </div>
        <div>
          <div class="ee-chart-label">COSTI MENSILI (€)</div>
          <div class="ee-chart" id="ee-chart-trend-cost-${assetId}"></div>
        </div>
      </div>`;'''

new_trend = '''    const trendHtml = `
      <div class="ee-section-title" data-kpi-tip="risponde alla domanda: stiamo migliorando? grafici storici per valutare l'andamento nel tempo dell'asset."><i class="fa fa-chart-line"></i>Trend e Confronto</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div class="es-section" style="margin-bottom:0;">
          <div class="es-section-title" data-kpi-tip="e-13 — consumo mensile totale (kwh) e costo mensile totale (€) per gli ultimi 24 mesi con confronto anno su anno. toggle kwh/€ disponibile."><i class="fa fa-calendar-alt"></i>Trend mensile anno su anno <span style="font-size:10px;font-weight:400;color:var(--text-muted);margin-left:auto;">E-13</span></div>
          <div class="ee-chart" id="ee-chart-trend-kwh-${assetId}"></div>
        </div>
        <div class="es-section" style="margin-bottom:0;">
          <div class="es-section-title" data-kpi-tip="e-14 — costo mensile scomposto per commodity (elettricità, gas, acqua, carburanti) negli ultimi 12 mesi."><i class="fa fa-layer-group"></i>Decomposizione costo per commodity <span style="font-size:10px;font-weight:400;color:var(--text-muted);margin-left:auto;">E-14</span></div>
          <div class="ee-chart" id="ee-chart-commodity14-${assetId}"></div>
        </div>
      </div>`;'''

if old_analisi in content:
    content = content.replace(old_analisi, new_analisi)
    print("analisiHtml: sostituito OK")
else:
    print("ERRORE: analisiHtml non trovato")

if old_trend in content:
    content = content.replace(old_trend, new_trend)
    print("trendHtml: sostituito OK")
else:
    print("ERRORE: trendHtml non trovato")

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("File salvato.")
