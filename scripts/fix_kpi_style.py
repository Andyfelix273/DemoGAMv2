#!/usr/bin/env python3
"""
Allinea lo stile delle card KPI della tab Energia al design del summary.
Correzioni:
1. Rimuove border-top colorato dalle classi accent-* in bems-ui.css (non usato nel summary)
2. Rimuove le classi accent-orange/accent-red/accent-green dalle card nel modal JS
   (il colore va solo sul valore, non sul bordo)
3. Allinea ee-kpi-grid a flex wrap gap:10px come il summary
"""

import re

# ─── 1. bems-ui.css: rimuove border-top colorato dalle classi accent-* ───────
css_path = '/home/ubuntu/gam-project/frontend/static/css/bems-ui.css'
with open(css_path, 'r', encoding='utf-8') as f:
    css = f.read()

# Rimuove le 3 righe border-top colorato (non usate nel summary)
css = css.replace(
    '.ee-kpi-card.accent-orange { border-top: 2px solid var(--accent-orange); }\n'
    '.ee-kpi-card.accent-green  { border-top: 2px solid var(--accent-green); }\n'
    '.ee-kpi-card.accent-red    { border-top: 2px solid var(--accent-red); }',
    '/* accent-* border-top rimosso: il colore va solo sul valore, non sul bordo (allineato a es-kpi-card) */'
)

# Allinea ee-kpi-grid a flex wrap come il summary
css = css.replace(
    '.ee-kpi-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-bottom:12px; }',
    '.ee-kpi-grid { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:12px; }'
)

with open(css_path, 'w', encoding='utf-8') as f:
    f.write(css)
print("bems-ui.css aggiornato")

# ─── 2. efficiency-detail-modal.js: rimuove classi accent-* dalle card ────────
js_path = '/home/ubuntu/gam-project/frontend/static/js/efficiency-detail-modal.js'
with open(js_path, 'r', encoding='utf-8') as f:
    js = f.read()

# Rimuove accent-orange dalla card consumi mese
js = js.replace(
    '<div class="ee-kpi-card accent-orange" data-kpi-tip="consumo elettrico totale',
    '<div class="ee-kpi-card" data-kpi-tip="consumo elettrico totale'
)

# Rimuove accent-* dalla card E-5 (fuori orario) — usa variabile offOk
js = re.sub(
    r'return `<div class="ee-kpi-card \$\{offOk \? \'accent-green\' : \'accent-red\'\}"',
    'return `<div class="ee-kpi-card"',
    js
)

# Rimuove accent-* dalla card E-4 (allarmi) — usa variabile alTot/alCrit
js = re.sub(
    r'<div class="ee-kpi-card \$\{alTot > 0 \? \(alCrit > 0 \? \'accent-red\' : \'accent-orange\'\) : \'accent-green\'\}"',
    '<div class="ee-kpi-card"',
    js
)

# Rimuove border-color inline dalla card EUI (E-3) — usa border-color inline style
# Sostituisce lo style border-color con niente (la card non ha bordo colorato nel summary)
js = re.sub(
    r'<div class="ee-kpi-card" style="border-color:\$\{kpi\.eui_gauge_color[^"]*\};"',
    '<div class="ee-kpi-card"',
    js
)

with open(js_path, 'w', encoding='utf-8') as f:
    f.write(js)
print("efficiency-detail-modal.js aggiornato")

# Verifica
import subprocess
result = subprocess.run(
    ['grep', '-n', 'accent-orange\|accent-red\|accent-green\|border-color.*gauge', js_path],
    capture_output=True, text=True
)
remaining = [l for l in result.stdout.splitlines() if 'ee-kpi-card' in l]
if remaining:
    print("ATTENZIONE - rimasti:", remaining)
else:
    print("Verifica OK: nessuna classe accent-* rimasta nelle card KPI")
