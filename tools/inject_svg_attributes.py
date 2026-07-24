#!/usr/bin/env python3
"""
Inject SVG Attributes — KeyBiz HQ Planimetrie
==============================================
Per ogni SVG di planimetria:
  1. Rimuove tutti gli elementi decorativi (frecce ascensori, schermi,
     legenda, sfondo, bordi colorati non-stanza)
  2. Inietta data-zone-id, data-ifc-guid, data-bems-type e id
     sugli elementi path che corrispondono agli spazi IFC
  3. Salva gli SVG "BIM-ready" in frontend/static/svg/bim/

Gli SVG originali NON vengono modificati.

Utilizzo:
    python3 inject_svg_attributes.py
"""

import json
import re
from pathlib import Path
from xml.etree import ElementTree as ET

# ── Percorsi ─────────────────────────────────────────────────────────────────
BASE_DIR  = Path(__file__).parent.parent
SVG_DIR   = BASE_DIR / "frontend" / "static" / "svg"
OUT_DIR   = BASE_DIR / "frontend" / "static" / "svg" / "bim"
OUT_DIR.mkdir(exist_ok=True)

SPACES_FILE = Path(__file__).parent / "output" / "spaces_with_guid.json"

SVG_FILES = {
    "P4": SVG_DIR / "piano4_clean_opt.svg",
    "P5": SVG_DIR / "piano5_final_opt.svg",
}

# ── Elementi decorativi da rimuovere ─────────────────────────────────────────
# Fill che identificano elementi decorativi puri
DECORATIVE_FILLS = {
    '#f59e0b',   # frecce ascensori gialle
    '#38bdf8',   # frecce ascensori blu
    '#0a0f1a',   # sfondo totale (rettangolo M0 0h...)
}

# Stroke che identificano contorni decorativi
DECORATIVE_STROKES = {
    '#f59e0b',   # frecce/bordi gialli
    '#38bdf8',   # frecce/bordi blu
    '#a855f7',   # schermi/flip chart viola
}


def is_decorative(el: ET.Element, vb_h: float) -> bool:
    """Ritorna True se l'elemento è decorativo e va rimosso."""
    tag = el.tag.split('}')[-1] if '}' in el.tag else el.tag
    fill   = el.get('fill', '')
    stroke = el.get('stroke', '')
    d      = el.get('d', '')
    
    # Sfondo totale (path che copre tutto il viewBox)
    if tag == 'path' and fill in DECORATIVE_FILLS:
        return True
    
    # Path con stroke decorativo (frecce, schermi come path)
    if tag == 'path' and stroke in DECORATIVE_STROKES and fill in ('none', ''):
        return True
    
    # Path frecce con fill giallo/blu
    if tag == 'path' and fill in DECORATIVE_FILLS:
        return True
    
    # Rect con stroke viola (schermi/flip chart)
    if tag == 'rect' and stroke == '#a855f7':
        return True
    
    # Rect della barra legenda in basso (y vicino al fondo)
    if tag == 'rect':
        try:
            y = float(el.get('y', 0))
            h = float(el.get('height', 0))
            if y > vb_h * 0.85:
                return True
        except (ValueError, TypeError):
            pass
    
    # Circle (pallini legenda)
    if tag == 'circle':
        return True
    
    # Testi nella legenda (y > 85% viewBox)
    if tag == 'text':
        try:
            y = float(el.get('y', 0))
            if y > vb_h * 0.85:
                return True
        except (ValueError, TypeError):
            pass
        # Testo "LEGENDA" o "LEGENDA:"
        txt = ''.join(el.itertext()).strip().upper()
        if txt.startswith('LEGENDA'):
            return True
    
    # Path piccoli della legenda (quadratini colorati in basso)
    if tag == 'path' and d:
        nums = re.findall(r'[-+]?\d*\.?\d+', d)
        if nums:
            try:
                tokens = re.findall(r'[MmLlHhVvZz]|[-+]?\d*\.?\d+', d)
                i = 0
                y_vals = []
                while i < len(tokens):
                    if tokens[i] == 'M' and i+2 < len(tokens):
                        try:
                            y_vals.append(float(tokens[i+2]))
                        except ValueError:
                            pass
                    i += 1
                if y_vals and min(y_vals) > vb_h * 0.85:
                    return True
            except (ValueError, IndexError):
                pass
    
    return False


def _path_bbox_simple(d: str) -> tuple:
    """Calcola bbox semplice di un path (solo M, H, V, h, v, L, l, Z)."""
    tokens = re.findall(r'[MmLlHhVvZz]|[-+]?\d*\.?\d+', d)
    xs, ys = [], []
    cx, cy = 0.0, 0.0
    cmd = 'M'
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t.isalpha():
            cmd = t
            i += 1
            continue
        try:
            v = float(t)
        except ValueError:
            i += 1
            continue
        if cmd == 'M':
            if i+1 < len(tokens):
                try:
                    cx, cy = v, float(tokens[i+1])
                    xs.append(cx); ys.append(cy)
                    i += 2; cmd = 'L'; continue
                except (ValueError, IndexError): pass
        elif cmd == 'm':
            if i+1 < len(tokens):
                try:
                    cx += v; cy += float(tokens[i+1])
                    xs.append(cx); ys.append(cy)
                    i += 2; cmd = 'l'; continue
                except (ValueError, IndexError): pass
        elif cmd == 'L':
            if i+1 < len(tokens):
                try:
                    cx, cy = v, float(tokens[i+1])
                    xs.append(cx); ys.append(cy)
                    i += 2; continue
                except (ValueError, IndexError): pass
        elif cmd == 'l':
            if i+1 < len(tokens):
                try:
                    cx += v; cy += float(tokens[i+1])
                    xs.append(cx); ys.append(cy)
                    i += 2; continue
                except (ValueError, IndexError): pass
        elif cmd == 'H': cx = v; xs.append(cx); ys.append(cy)
        elif cmd == 'h': cx += v; xs.append(cx); ys.append(cy)
        elif cmd == 'V': cy = v; xs.append(cx); ys.append(cy)
        elif cmd == 'v': cy += v; xs.append(cx); ys.append(cy)
        i += 1
    
    if not xs or not ys:
        return 0, 0, 0, 0
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    return x_min, y_min, x_max - x_min, y_max - y_min


def inject_attributes(svg_path: Path, floor_id: str, spaces: list) -> ET.ElementTree:
    """
    Processa un SVG:
    - Rimuove elementi decorativi
    - Inietta attributi data-* sugli elementi delle stanze
    
    Algoritmo di matching migliorato:
    - Calcola score per ogni elemento SVG candidato
    - Preferisce elementi con fill non-none (stanze reali vs contorni)
    - Evita di assegnare lo stesso elemento a due spazi diversi
    - Non crea path sintetici: se non trova match, segnala l'errore
    """
    # Registra namespace SVG per preservarlo nell'output
    ET.register_namespace('', 'http://www.w3.org/2000/svg')
    ET.register_namespace('xlink', 'http://www.w3.org/1999/xlink')
    
    tree = ET.parse(svg_path)
    root = tree.getroot()
    
    # Rimuovi namespace dai tag per semplicità di processing
    for el in root.iter():
        if '}' in el.tag:
            ns, tag = el.tag.split('}', 1)
            el.tag = tag
    
    # Ottieni viewBox height
    vb = root.get('viewBox', '0 0 1460 900')
    vb_parts = vb.split()
    vb_h = float(vb_parts[3]) if len(vb_parts) >= 4 else 900.0
    
    # Filtra spazi per questo piano
    floor_spaces = [s for s in spaces if s["floor_id"] == floor_id]
    
    print(f"\n  Piano {floor_id}: {len(floor_spaces)} spazi da iniettare")
    
    # ── Rimuovi elementi decorativi ──────────────────────────────────────────
    removed = 0
    for parent in list(root.iter()):
        to_remove = []
        for child in list(parent):
            if is_decorative(child, vb_h):
                to_remove.append(child)
        for el in to_remove:
            parent.remove(el)
            removed += 1
    
    print(f"  Elementi decorativi rimossi: {removed}")
    
    # ── Costruisci lista di tutti gli elementi candidati ─────────────────────
    # Raccoglie tutti i path/rect con le loro bbox calcolate
    candidates = []
    for el in root.iter():
        tag = el.tag.split('}')[-1] if '}' in el.tag else el.tag
        if tag not in ('path', 'rect'):
            continue
        
        fill = el.get('fill', 'none')
        stroke = el.get('stroke', 'none')
        
        if tag == 'rect':
            try:
                ex = float(el.get('x', 0))
                ey = float(el.get('y', 0))
                ew = float(el.get('width', 0))
                eh = float(el.get('height', 0))
            except (ValueError, TypeError):
                continue
        else:  # path
            d = el.get('d', '')
            if not d:
                continue
            ex, ey, ew, eh = _path_bbox_simple(d)
            if ew < 10 or eh < 10:
                continue
        
        candidates.append({
            'el': el,
            'tag': tag,
            'fill': fill,
            'stroke': stroke,
            'ex': ex, 'ey': ey, 'ew': ew, 'eh': eh,
            'cx': ex + ew / 2,
            'cy': ey + eh / 2,
            'assigned': False,  # flag per evitare doppia assegnazione
        })
    
    print(f"  Candidati SVG trovati: {len(candidates)}")
    
    # ── Inietta attributi sugli spazi ────────────────────────────────────────
    injected = 0
    
    for space in floor_spaces:
        bbox = space["bbox"]
        zone_id = space["zone_id"]
        ifc_guid = space.get("ifc_guid", "")
        svg_element_id = space["svg_element_id"]
        bems_type = space["bems_type"]
        name = space["name"]
        
        cx_sp = bbox["cx"]
        cy_sp = bbox["cy"]
        w_sp  = bbox["w"]
        h_sp  = bbox["h"]
        
        best_cand = None
        best_score = float('inf')
        
        for cand in candidates:
            if cand['assigned']:
                continue
            
            # Distanza tra centri
            dist_center = ((cand['cx'] - cx_sp)**2 + (cand['cy'] - cy_sp)**2) ** 0.5
            
            # Differenza dimensioni
            dist_size = abs(cand['ew'] - w_sp) + abs(cand['eh'] - h_sp)
            
            # Score base
            score = dist_center * 2 + dist_size
            
            # Penalità per elementi con fill=none (contorni decorativi, non stanze)
            # Preferiamo elementi con fill colorato (le stanze reali)
            if cand['fill'] in ('none', ''):
                score += 200
            
            if score < best_score:
                best_score = score
                best_cand = cand
        
        # Soglia aumentata: accetta match fino a score=500
        # (i path irregolari come il TERRAZZO hanno bbox molto diversa dalla stanza)
        if best_cand is None or best_score > 500:
            print(f"  ✗ Nessun match accettabile per '{name}' (best_score={best_score:.0f})")
            # NON creare path sintetici — segnala l'errore e continua
            continue
        
        # Marca come assegnato per evitare doppia assegnazione
        best_cand['assigned'] = True
        el = best_cand['el']
        
        # Inietta attributi
        el.set('id', svg_element_id)
        el.set('data-zone-id', zone_id)
        el.set('data-ifc-guid', ifc_guid)
        el.set('data-bems-type', bems_type)
        el.set('data-name', name)
        el.set('data-area-mq', str(space["area_mq"]))
        el.set('data-capacita', str(space["capacita_persone"]))
        
        # Aggiungi classe CSS per styling
        existing_class = el.get('class', '')
        el.set('class', f"{existing_class} bems-space bems-{bems_type}".strip())
        
        # Aggiungi stile hover (cursore pointer)
        existing_style = el.get('style', '')
        if 'cursor' not in existing_style:
            el.set('style', (existing_style + ';cursor:pointer').lstrip(';'))
        
        injected += 1
        print(f"  ✓ '{name}' → id='{svg_element_id}' zone_id='{zone_id}' (score={best_score:.0f})")
    
    print(f"  Attributi iniettati: {injected}/{len(floor_spaces)}")
    
    # Ripristina namespace SVG
    root.set('xmlns', 'http://www.w3.org/2000/svg')
    
    return tree


def main():
    # Carica spazi con GUID
    print(f"Caricamento spazi da: {SPACES_FILE}")
    with open(SPACES_FILE, 'r', encoding='utf-8') as f:
        spaces = json.load(f)
    print(f"Spazi caricati: {len(spaces)}")
    
    for floor_id, svg_path in SVG_FILES.items():
        if not svg_path.exists():
            print(f"⚠ File non trovato: {svg_path}")
            continue
        
        print(f"\n{'='*60}")
        print(f"Processing {floor_id}: {svg_path.name}")
        print('='*60)
        
        tree = inject_attributes(svg_path, floor_id, spaces)
        
        # Salva SVG BIM-ready
        out_name = f"piano{floor_id[-1].lower()}_bim.svg"
        out_path = OUT_DIR / out_name
        
        # Scrivi con dichiarazione XML
        tree.write(str(out_path), encoding='unicode', xml_declaration=False)
        
        # Aggiungi header SVG corretto
        content = out_path.read_text(encoding='utf-8')
        if not content.startswith('<?xml'):
            content = '<?xml version="1.0" encoding="UTF-8"?>\n' + content
            out_path.write_text(content, encoding='utf-8')
        
        size_kb = out_path.stat().st_size // 1024
        print(f"\n  ✓ Salvato: {out_path} ({size_kb} KB)")
    
    print(f"\n{'='*60}")
    print(f"SVG BIM-ready salvati in: {OUT_DIR}")
    print("File generati:")
    for f in sorted(OUT_DIR.glob("*.svg")):
        print(f"  {f.name} ({f.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
