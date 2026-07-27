#!/usr/bin/env python3
"""Sostituisce analisiHtml (righe 1840-1878) e trendHtml (1880-1891) nel modal JS."""

path = '/home/ubuntu/gam-project/frontend/static/js/efficiency-detail-modal.js'

with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Righe 1-indexed: analisiHtml = 1840..1878, trendHtml = 1880..1891
# Python 0-indexed: 1839..1877, 1879..1890

new_analisi = '''    const analisiHtml = `
      <div class="ee-section-title" data-kpi-tip="risponde alla domanda: dove e quando consumiamo? grafici interattivi per l\u2019analisi operativa dei consumi dell\u2019asset."><i class="fa fa-chart-bar"></i>Analisi Consumi</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div class="es-section" style="margin-bottom:0;">
          <div class="es-section-title" data-kpi-tip="e-7 \u2014 potenza media (kw) per slot di 15 minuti nelle 24 ore, aggregata per tipo impianto."><i class="fa fa-bolt"></i>Profilo di carico 24h <span style="font-size:10px;font-weight:400;color:var(--text-muted);margin-left:auto;">E-7</span></div>
          <div class="ee-chart" id="ee-chart-profile24h-${assetId}"></div>
        </div>
        <div class="es-section" style="margin-bottom:0;">
          <div class="es-section-title" data-kpi-tip="e-9 \u2014 distribuzione dei consumi per tipologia di impianto (hvac, illuminazione, it, prese, ascensori, processo, altro). richiede sub-metering."><i class="fa fa-chart-pie"></i>Ripartizione consumi per impianto <span style="font-size:10px;font-weight:400;color:var(--text-muted);margin-left:auto;">E-9</span></div>
          <div class="ee-chart" id="ee-chart-breakdown-${assetId}"></div>
        </div>
        <div class="es-section" style="margin-bottom:0;">
          <div class="es-section-title" data-kpi-tip="e-10 \u2014 mappa cromatica dei consumi medi per ora del giorno \u00d7 giorno della settimana. identifica fasce orarie anomale e pattern di consumo."><i class="fa fa-th"></i>Heatmap ora \u00d7 giorno <span style="font-size:10px;font-weight:400;color:var(--text-muted);margin-left:auto;">E-10</span></div>
          <div class="ee-chart" id="ee-chart-heatmap-${assetId}"></div>
        </div>
        <div class="es-section" style="margin-bottom:0;">
          <div class="es-section-title" data-kpi-tip="e-8 \u2014 confronto tra il consumo reale e la baseline storica (media \u00b11\u03c3). i punti oltre 2\u03c3 indicano anomalie di consumo."><i class="fa fa-chart-line"></i>Baseline vs consumo reale <span style="font-size:10px;font-weight:400;color:var(--text-muted);margin-left:auto;">E-8</span></div>
          <div class="ee-chart" id="ee-chart-baseline-${assetId}"></div>
        </div>
        <div class="es-section" style="margin-bottom:0;">
          <div class="es-section-title" data-kpi-tip="e-12 \u2014 scatter plot occupancy media giornaliera vs costo energetico. il quadrante bassa occupancy + alto costo evidenzia lo spreco potenziale."><i class="fa fa-users"></i>Occupancy vs costo <span style="font-size:10px;font-weight:400;color:var(--text-muted);margin-left:auto;">E-12</span></div>
          <div class="ee-chart" id="ee-chart-occ-${assetId}"></div>
        </div>
        <div class="es-section" style="margin-bottom:0;">
          <div class="es-section-title" data-kpi-tip="e-11 \u2014 scatter plot kwh hvac giornaliero vs temperatura esterna con regressione lineare. r\u00b2 indica la qualit\u00e0 della correlazione."><i class="fa fa-thermometer-half"></i>HVAC vs temperatura esterna <span style="font-size:10px;font-weight:400;color:var(--text-muted);margin-left:auto;">E-11</span></div>
          <div class="ee-chart" id="ee-chart-hvac-temp-${assetId}"></div>
        </div>
      </div>`;
'''

new_trend = '''    const trendHtml = `
      <div class="ee-section-title" data-kpi-tip="risponde alla domanda: stiamo migliorando? grafici storici per valutare l\u2019andamento nel tempo dell\u2019asset."><i class="fa fa-chart-line"></i>Trend e Confronto</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div class="es-section" style="margin-bottom:0;">
          <div class="es-section-title" data-kpi-tip="e-13 \u2014 consumo mensile totale (kwh) e costo mensile totale (\u20ac) per gli ultimi 24 mesi con confronto anno su anno. toggle kwh/\u20ac disponibile."><i class="fa fa-calendar-alt"></i>Trend mensile anno su anno <span style="font-size:10px;font-weight:400;color:var(--text-muted);margin-left:auto;">E-13</span></div>
          <div class="ee-chart" id="ee-chart-trend-kwh-${assetId}"></div>
        </div>
        <div class="es-section" style="margin-bottom:0;">
          <div class="es-section-title" data-kpi-tip="e-14 \u2014 costo mensile scomposto per commodity (elettricit\u00e0, gas, acqua, carburanti) negli ultimi 12 mesi."><i class="fa fa-layer-group"></i>Decomposizione costo per commodity <span style="font-size:10px;font-weight:400;color:var(--text-muted);margin-left:auto;">E-14</span></div>
          <div class="ee-chart" id="ee-chart-commodity14-${assetId}"></div>
        </div>
      </div>`;
'''

# Sostituisce analisiHtml: righe 1840-1878 (0-indexed: 1839-1877 incluse)
# Sostituisce trendHtml: righe 1880-1891 (0-indexed: 1879-1890 incluse)
# Prima trova i confini esatti cercando le righe chiave
analisi_start = None
analisi_end = None
trend_start = None
trend_end = None

for i, line in enumerate(lines):
    stripped = line.strip()
    if 'const analisiHtml = `' in stripped and analisi_start is None:
        analisi_start = i
    if 'const trendHtml = `' in stripped and trend_start is None:
        trend_start = i
    # Fine analisiHtml: la riga con solo "};" o "`;" prima di trendHtml
    if analisi_start is not None and trend_start is None and stripped == '`;':
        analisi_end = i
    # Fine trendHtml: la riga con "};" o "`;" prima di el.innerHTML
    if trend_start is not None and analisi_end is not None and stripped == '`;':
        trend_end = i
        break

print(f"analisiHtml: righe {analisi_start+1}-{analisi_end+1}")
print(f"trendHtml:   righe {trend_start+1}-{trend_end+1}")

# Ricostruisce il file
new_lines = (
    lines[:analisi_start] +
    [new_analisi] +
    lines[analisi_end+1:trend_start] +
    [new_trend] +
    lines[trend_end+1:]
)

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("File salvato OK.")
