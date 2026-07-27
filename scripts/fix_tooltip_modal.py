#!/usr/bin/env python3
"""Rimuove il blocco CSS tooltip duplicato dal modal JS (righe 188-226 circa)."""
path = '/home/ubuntu/gam-project/frontend/static/js/efficiency-detail-modal.js'

with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Trova la riga di inizio del blocco tooltip
start = None
end = None
for i, line in enumerate(lines):
    stripped = line.strip()
    if 'Tooltip scuro KPI' in stripped and 'data-kpi-tip' in stripped:
        start = i
    if start is not None and stripped == "[data-kpi-tip]:hover::after," :
        # la riga successiva è [data-kpi-tip]:hover::before { opacity:1; }
        end = i + 2  # includi anche la riga successiva
        break

if start is None or end is None:
    print(f"WARN: blocco non trovato (start={start}, end={end})")
    exit(1)

print(f"Rimuovo righe {start+1}..{end+1}")
print("Prima:", lines[start].rstrip())
print("Dopo:", lines[end].rstrip())

# Sostituisci con commento
replacement = "/* tooltip data-kpi-tip definito in bems-ui.css */\n"
new_lines = lines[:start] + [replacement] + lines[end+1:]

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("OK")
