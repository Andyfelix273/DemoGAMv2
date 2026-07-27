#!/usr/bin/env python3
"""Sostituisce analisiHtml (righe 1840-1877) e trendHtml (1879-1891) nel modal JS."""

path = '/home/ubuntu/gam-project/frontend/static/js/efficiency-detail-modal.js'

with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# 0-indexed: analisiHtml = 1839..1876, trendHtml = 1879..1890
# (riga 1877 è il commento "// ── Sezione Trend", riga 1878 è blank)
ANALISI_START = 1839   # 0-indexed
ANALISI_END   = 1876   # 0-indexed inclusive (riga 1877 in 1-indexed)
TREND_START   = 1879   # 0-indexed
TREND_END     = 1890   # 0-indexed inclusive (riga 1891 in 1-indexed)

# Verifica
print("Riga analisi start:", lines[ANALISI_START].rstrip())
print("Riga analisi end  :", lines[ANALISI_END].rstrip())
print("Riga trend start  :", lines[TREND_START].rstrip())
print("Riga trend end    :", lines[TREND_END].rstrip())

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

new_lines = (
    lines[:ANALISI_START] +
    [new_analisi] +
    lines[ANALISI_END+1:TREND_START] +
    [new_trend] +
    lines[TREND_END+1:]
)

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print(f"Salvato: {len(new_lines)} righe (era {len(lines)})")
