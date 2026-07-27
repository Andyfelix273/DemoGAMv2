# Note specifiche KPI — Catalogo v3.0

## Tab Energia — 3 sezioni
1. **SINTESI** (E-1..E-6): card numeriche KPI
2. **ANALISI CONSUMI** (E-7..E-12): grafici interattivi
3. **TREND E CONFRONTO** (E-13..E-14): grafici storici

## CSS summary (es-*) vs modal (ee-*)
- es-kpi-card: padding 14px 16px, border-radius 10px, font-size value 24px
- ee-kpi-card: deve avere stessa struttura visiva
- es-kpi-label: font-size 10px, uppercase, letter-spacing 0.5px, color text-muted, font-weight 600
- es-kpi-value: font-size 24px, font-weight 700, color text-primary, line-height 1.1
- es-kpi-unit: font-size 11px, color text-muted
- es-kpi-delta.up: color #E74C3C; .down: color #27AE60

## Separatori sezione summary (es-page-section-sep)
- full-width, border-top, label uppercase, icona FA

## baseLayout Plotly summary
- paper_bgcolor/plot_bgcolor: transparent
- font: Inter, 11px, #7BAFC4
- xaxis/yaxis gridcolor: rgba(30,58,95,0.4), tickfont.size: 10
- legend: orientation h, y -0.22, x 0, bgcolor transparent
- margin: t:6, r:10, b:42, l:46
- bargap: 0.25 (per bar chart)

## Problemi da correggere nel modal JS
1. Le ee-kpi-card hanno CSS diverso (font-size value, padding, border-radius) rispetto alle es-kpi-card
2. I separatori di sezione nella griglia KPI usano ee-kpi-section-sep (9px, solo dentro la griglia)
   → devono diventare separatori full-width come nel summary (es-page-section-sep style)
3. I grafici ancora hanno override che differiscono dal baseLayout (gridcolor .5 invece di .4, legend.y -0.25 invece di -0.22)
4. Le chart-label sono uppercase ma il summary usa titoli con icona FA e badge ID (es "TREND CONSUMI MENSILI (KWH) 7 PUNTI P-7B")
