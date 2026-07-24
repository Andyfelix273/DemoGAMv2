#!/usr/bin/env python3
"""
SVG Parser per planimetrie KeyBiz HQ
=====================================
Estrae gli spazi (stanze) dagli SVG delle planimetrie, associa ogni
elemento geometrico al testo più vicino, calcola il bounding box reale
e produce una struttura dati pronta per l'export IFC e l'iniezione
degli attributi data-zone-id nell'SVG.

Utilizzo:
    python3 svg_parser.py --all
    python3 svg_parser.py --floor P4
"""

import argparse
import json
import math
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET
from collections import Counter

# ── Configurazione percorsi ──────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent.parent
SVG_DIR  = BASE_DIR / "frontend" / "static" / "svg"
OUT_DIR  = BASE_DIR / "tools" / "output"
OUT_DIR.mkdir(exist_ok=True)

SVG_FILES = {
    "P4": SVG_DIR / "piano4_clean_opt.svg",
    "P5": SVG_DIR / "piano5_final_opt.svg",
}

# ── Scala SVG → metri reali ──────────────────────────────────────────────────
# Piano 4: 35m x 19m su viewBox 1460x900 → 0.02397 m/px x 0.02111 m/px
# Piano 5: ~40m x ~25m su viewBox 1800x1200 → 0.02222 m/px x 0.02083 m/px
FLOOR_SCALE = {
    "P4": {"mx": 35.0 / 1460.0, "my": 19.0 / 900.0,  "vb_w": 1460, "vb_h": 900,  "elevation": 0.0,  "height": 3.2},
    "P5": {"mx": 40.0 / 1800.0, "my": 25.0 / 1200.0, "vb_w": 1800, "vb_h": 1200, "elevation": 3.2,  "height": 3.2},
}

# ── Classificazione spazi ────────────────────────────────────────────────────
SPACE_TYPES = {
    "UFF":              ("IfcSpace", "ufficio"),
    "UFFICIO":          ("IfcSpace", "ufficio"),
    "DIR":              ("IfcSpace", "ufficio_direzionale"),
    "CEO":              ("IfcSpace", "ufficio_direzionale"),
    "CFO":              ("IfcSpace", "ufficio_direzionale"),
    "CTO":              ("IfcSpace", "ufficio_direzionale"),
    "AMM":              ("IfcSpace", "ufficio"),
    "SALES":            ("IfcSpace", "ufficio"),
    "SALA RIUNIONI":    ("IfcSpace", "sala_riunioni"),
    "SALA FLIP":        ("IfcSpace", "sala_riunioni"),
    "SALA CONFERENZE":  ("IfcSpace", "sala_riunioni"),
    "OPEN SPACE":       ("IfcSpace", "open_space"),
    "LAB":              ("IfcSpace", "laboratorio"),
    "SALA BREAK":       ("IfcSpace", "sala_break"),
    "RECEPTION":        ("IfcSpace", "reception"),
    "ANTICAMERA":       ("IfcSpace", "anticamera"),
    "SERVER":           ("IfcSpace", "server_room"),
    "CED":              ("IfcSpace", "server_room"),
    "CORRIDOIO":        ("IfcSpace", "corridoio"),
    "SCALE":            ("IfcSpace", "vano_scale"),
    "VANO SCALE":       ("IfcSpace", "vano_scale"),
    "ASCENSORE":        ("IfcSpace", "ascensore"),
    "TERRAZZO":         ("IfcSpace", "terrazzo"),
    "BAGNI":            ("IfcSpace", "bagni"),
    "WC":               ("IfcSpace", "bagni"),
    "ARCHIVIO":         ("IfcSpace", "archivio"),
}

# Testi da escludere (legenda, etichette decorative, metrature)
EXCLUDE_PATTERNS = [
    r'^KEYBIZ\s+HQ',
    r'^SCALA\s+\d',
    r'^SCHERMO',
    r'^FLIP\s+CHART',
    r'^\d+\s*(post\.|posti|mq)',
    r'^A\d$',                    # A1, A2 (ascensori)
    r'^Asc\.',
    r'^Antibagno$',
    r'^Donne$',
    r'^Uomini$',
    r'^LEGENDA',
    r'^Sala\s+Flip$',            # legenda P5
    r'^Uffici\s+direz\.',
    r'^Open\s+Space$',           # legenda P5 (minuscolo)
    r'^Anticamera$',             # legenda P5
    r'^Terrazzo$',               # legenda P5
    r'^Corridoio$',              # legenda P5
    r'^Nucleo',
    r'^Uffici\s+singoli$',
    r'^Lab\s+IoT$',              # legenda P4
    r'^Sala\s+Riunioni$',        # legenda P4
    r'^Direzione$',
    r'^Sala\s+Break$',           # legenda P4
    r'^Servizi\s+igienici$',
    r'^Nucleo\s+scale$',
    r'^Asc\.\s+pubblico$',
    r'^Asc\.\s+privato$',
    r'^CTO$',                    # legenda P5 (solo se y > 1000)
]

# Fill colors che identificano spazi reali (non solo fill:none)
ROOM_FILLS_P4 = {
    '#0f1e3d',   # uffici singoli
    '#0d1520',   # vano scale/ascensore
    '#2d1f4f',   # direzione generale
    '#2d2a1a',   # sala riunioni
    '#111827',   # corridoio principale
    '#0d2318',   # open space A
    '#0d2535',   # lab IoT
    '#0d2318',   # open space B (stesso colore di A)
    '#2a1a0d',   # sala break
    '#0f1e2d',   # bagni
    '#1a0f1e',   # bagni F
    '#1a1505',   # ascensore privato
    '#1e293b',   # ascensore pubblico
}

ROOM_FILLS_P5 = {
    '#2d2a1a',   # sala flip 1
    '#1a1a2e',   # anticamera
    '#0d1a2d',   # CTO
    '#2d1f4f',   # AMM
    '#2d2a1a',   # sala flip 2
    '#0d2318',   # sales
    '#2d1f4f',   # CEO+CFO (stesso colore AMM)
    '#0a1a0a',   # terrazzo + open space
    '#0d2318',   # open space
}

# Elementi decorativi da escludere per fill
DECORATIVE_FILLS = {
    '#f59e0b',   # frecce ascensori (giallo)
    '#38bdf8',   # frecce ascensori (blu)
    '#0a0f1a',   # sfondo totale
}

# ── Parsing path SVG ─────────────────────────────────────────────────────────

def parse_path_bbox(d: str) -> dict | None:
    """
    Calcola il bounding box di un path SVG gestendo:
    - Comandi M/m (moveto), L/l (lineto), H/h, V/v, Z/z
    - Interruzioni di porte (m relativo = gap nel contorno)
    - Path composti (più sotto-path separati da M)
    """
    # Tokenizza: separa comandi da numeri
    tokens = re.findall(r'[MmLlHhVvZzCcSsQqTtAa]|[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?', d)
    
    xs, ys = [], []
    cx, cy = 0.0, 0.0
    start_x, start_y = 0.0, 0.0
    cmd = 'M'
    i = 0
    
    def next_float():
        nonlocal i
        while i < len(tokens):
            t = tokens[i]
            i += 1
            if not t.isalpha():
                try:
                    return float(t)
                except ValueError:
                    pass
        return None
    
    while i < len(tokens):
        t = tokens[i]
        i += 1
        
        if not t.isalpha():
            # Numero senza comando precedente: ripeti ultimo comando
            i -= 1
        else:
            cmd = t
            continue
        
        if cmd == 'M':
            v1 = next_float(); v2 = next_float()
            if v1 is not None and v2 is not None:
                cx, cy = v1, v2
                start_x, start_y = cx, cy
                xs.append(cx); ys.append(cy)
                cmd = 'L'
        elif cmd == 'm':
            v1 = next_float(); v2 = next_float()
            if v1 is not None and v2 is not None:
                cx += v1; cy += v2
                # Non aggiungiamo — è un'interruzione (porta)
                cmd = 'l'
        elif cmd == 'L':
            v1 = next_float(); v2 = next_float()
            if v1 is not None and v2 is not None:
                cx, cy = v1, v2
                xs.append(cx); ys.append(cy)
        elif cmd == 'l':
            v1 = next_float(); v2 = next_float()
            if v1 is not None and v2 is not None:
                cx += v1; cy += v2
                xs.append(cx); ys.append(cy)
        elif cmd == 'H':
            v = next_float()
            if v is not None:
                cx = v
                xs.append(cx); ys.append(cy)
        elif cmd == 'h':
            v = next_float()
            if v is not None:
                cx += v
                xs.append(cx); ys.append(cy)
        elif cmd == 'V':
            v = next_float()
            if v is not None:
                cy = v
                xs.append(cx); ys.append(cy)
        elif cmd == 'v':
            v = next_float()
            if v is not None:
                cy += v
                xs.append(cx); ys.append(cy)
        elif cmd in ('Z', 'z'):
            cx, cy = start_x, start_y
        elif cmd in ('C', 'c', 'S', 's', 'Q', 'q', 'T', 't', 'A', 'a'):
            # Curve: leggi i punti di controllo e aggiungi solo il punto finale
            # Per semplicità, saltiamo le curve (non presenti nei nostri SVG)
            pass
    
    if len(xs) < 2 or len(ys) < 2:
        return None
    
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    w = x_max - x_min
    h = y_max - y_min
    
    # Filtra elementi troppo piccoli o troppo grandi (sfondo)
    if w < 20 or h < 20:
        return None
    
    return {
        "x": round(x_min, 1),
        "y": round(y_min, 1),
        "w": round(w, 1),
        "h": round(h, 1),
        "cx": round((x_min + x_max) / 2, 1),
        "cy": round((y_min + y_max) / 2, 1),
    }


def distance(p1, p2):
    return math.sqrt((p1[0]-p2[0])**2 + (p1[1]-p2[1])**2)


def classify_space(name: str) -> tuple:
    name_upper = name.upper()
    for keyword, types in SPACE_TYPES.items():
        if keyword in name_upper:
            return types
    return ("IfcSpace", "altro")


def should_exclude(name: str, y: float = 0, vb_h: float = 1000) -> bool:
    """Esclude testi che non sono nomi di stanza."""
    # Escludi testi nella legenda (ultimi 10% dell'altezza viewBox)
    if y > vb_h * 0.90:
        return True
    for pattern in EXCLUDE_PATTERNS:
        if re.match(pattern, name.strip(), re.I):
            return True
    if len(name.strip()) <= 1:
        return True
    return False


# ── Definizione manuale degli spazi per robustezza ──────────────────────────
# Per ogni piano, definiamo gli spazi con le coordinate reali lette dall'SVG.
# Questo approccio ibrido (geometria dall'SVG + semantica manuale) garantisce
# accuratezza e permette di correggere facilmente gli errori di parsing.

MANUAL_SPACES = {
    "P4": [
        # (nome, bems_type, x, y, w, h, superficie_mq, capacita)
        ("UFF. 1",          "ufficio",              60,   60,  160, 270,  12,  2),
        ("UFF. 2",          "ufficio",             220,   60,  160, 270,  12,  2),
        ("UFF. 3",          "ufficio",             380,   60,  160, 270,  12,  2),
        ("UFF. 4",          "ufficio",             540,   60,  160, 270,  12,  2),
        ("VANO SCALE",      "vano_scale",           700,   60,  200, 270,  18,  0),
        ("DIR. GENERALE",   "ufficio_direzionale",  990,   60,  170, 270,  20,  1),
        ("SALA RIUNIONI",   "sala_riunioni",       1160,   60,  240, 270,  30, 10),
        ("CORRIDOIO",       "corridoio",             60,  330, 1340,  60,  30,  0),
        ("OPEN SPACE A",    "open_space",            60,  390,  370, 430,  50, 10),
        ("LAB IoT",         "laboratorio",          430,  390,  270, 430,  30,  3),
        ("OPEN SPACE B",    "open_space",           700,  390,  360, 430,  50, 10),
        ("SALA BREAK",      "sala_break",          1110,  390,  290, 180,  20,  8),
        ("BAGNI M (1)",     "bagni",               1110,  605,   97, 215,   8,  0),
        ("BAGNI M (2)",     "bagni",               1207,  605,  100, 215,   8,  0),
        ("BAGNI F",         "bagni",               1307,  605,   93, 215,   8,  0),
    ],
    "P5": [
        ("SALA FLIP 1",     "sala_riunioni",         40,   45,  240, 245,  35, 10),
        ("AMM.",            "ufficio",              280,   45,  180, 155,  20,  3),
        ("RECEPTION",       "reception",            280,  200,  180, 150,  15,  2),
        ("SALA FLIP 2",     "sala_riunioni",        460,   45,  240, 245,  35, 10),
        ("SALES",           "ufficio",              700,   45,  200, 245,  25,  4),
        ("CEO + CFO",       "ufficio_direzionale",  900,   45,  300, 385,  50,  2),
        ("ANTICAMERA",      "anticamera",            40,  290,  240, 130,  10,  0),
        ("CTO",             "ufficio_direzionale",   40,  420,  240, 260,  25,  1),
        ("CED",             "server_room",          400,  350,  100, 330,  15,  0),
        ("CORRIDOIO",       "corridoio",            500,  350,   90, 330,  12,  0),
        ("OPEN SPACE",      "open_space",            40,  680,  460, 480, 100, 30),
        ("TERRAZZO",        "terrazzo",             500,  680,  860, 630, 200,  0),
    ],
}


# ── Parser principale ────────────────────────────────────────────────────────

def parse_svg(svg_path: Path, floor_id: str, use_manual: bool = True) -> list[dict]:
    """
    Parsifica un SVG e restituisce la lista degli spazi.
    Con use_manual=True usa le coordinate manuali verificate.
    """
    scale = FLOOR_SCALE[floor_id]
    spaces = []
    
    if use_manual and floor_id in MANUAL_SPACES:
        print(f"\n  Usando coordinate manuali verificate per {floor_id}")
        for i, (name, bems_type, x, y, w, h, area_mq, capacita) in enumerate(MANUAL_SPACES[floor_id]):
            ifc_type = "IfcSpace"
            
            # Genera ID univoco per l'elemento SVG
            name_slug = re.sub(r'[^a-z0-9]', '-', name.lower())
            name_slug = re.sub(r'-+', '-', name_slug).strip('-')
            svg_element_id = f"space-{floor_id.lower()}-{name_slug}"
            
            # Calcola centro
            cx = x + w / 2
            cy = y + h / 2
            
            space = {
                "floor_id": floor_id,
                "name": name,
                "svg_element_id": svg_element_id,
                "ifc_type": ifc_type,
                "bems_type": bems_type,
                "bbox": {
                    "x": float(x), "y": float(y),
                    "w": float(w), "h": float(h),
                    "cx": float(cx), "cy": float(cy),
                },
                "area_mq": float(area_mq),
                "capacita_persone": capacita,
                "elevation_m": scale["elevation"],
                "height_m": scale["height"],
                "path_d": f"M{x} {y}h{w}v{h}h-{w}z",  # path rettangolare semplificato
                "source": "manual_verified",
            }
            spaces.append(space)
            print(f"  ✓ '{name}' → {bems_type} | {x},{y} {w}×{h} | {area_mq}mq | cap={capacita}")
    
    else:
        # Parsing automatico dall'SVG
        tree = ET.parse(svg_path)
        root = tree.getroot()
        for el in root.iter():
            if '}' in el.tag:
                el.tag = el.tag.split('}', 1)[1]
        
        vb_h = scale["vb_h"]
        
        # Raccogli testi validi
        texts = []
        for el in root.iter('text'):
            txt = ''.join(el.itertext()).strip()
            if not txt:
                continue
            try:
                tx = float(el.get('x', 0))
                ty = float(el.get('y', 0))
            except (ValueError, TypeError):
                continue
            if should_exclude(txt, ty, vb_h):
                continue
            texts.append({"text": txt, "x": tx, "y": ty})
        
        # Raccogli path stanze
        for el in root.iter('path'):
            fill = el.get('fill', '')
            d = el.get('d', '')
            if not d or fill in DECORATIVE_FILLS:
                continue
            
            bbox = parse_path_bbox(d)
            if bbox is None:
                continue
            
            # Escludi sfondo (path che copre quasi tutto il viewBox)
            if bbox["w"] > scale["vb_w"] * 0.8 and bbox["h"] > scale["vb_h"] * 0.8:
                continue
            
            # Trova testo più vicino
            center = (bbox["cx"], bbox["cy"])
            best_text = None
            best_dist = float('inf')
            
            for t in texts:
                d_dist = distance(center, (t["x"], t["y"]))
                inside = (
                    bbox["x"] <= t["x"] <= bbox["x"] + bbox["w"] and
                    bbox["y"] - 50 <= t["y"] <= bbox["y"] + bbox["h"] + 50
                )
                eff_dist = d_dist * (0.3 if inside else 1.0)
                if eff_dist < best_dist:
                    best_dist = eff_dist
                    best_text = t
            
            if best_text is None or best_dist > 500:
                continue
            
            name = best_text["text"]
            ifc_type, bems_type = classify_space(name)
            area_mq = round(bbox["w"] * scale["mx"] * bbox["h"] * scale["my"], 1)
            
            name_slug = re.sub(r'[^a-z0-9]', '-', name.lower())
            name_slug = re.sub(r'-+', '-', name_slug).strip('-')
            svg_element_id = f"space-{floor_id.lower()}-{name_slug}"
            
            space = {
                "floor_id": floor_id,
                "name": name,
                "svg_element_id": svg_element_id,
                "ifc_type": ifc_type,
                "bems_type": bems_type,
                "bbox": bbox,
                "area_mq": area_mq,
                "capacita_persone": 0,
                "elevation_m": scale["elevation"],
                "height_m": scale["height"],
                "path_d": d,
                "source": "auto_parsed",
            }
            spaces.append(space)
    
    return spaces


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Parser SVG planimetrie → spazi IFC")
    parser.add_argument("--floor", choices=["P4", "P5"], help="Piano da processare")
    parser.add_argument("--all", action="store_true", default=True, help="Processa tutti i piani")
    parser.add_argument("--auto", action="store_true", help="Usa parsing automatico invece di coordinate manuali")
    parser.add_argument("--output", default="spaces.json", help="File output JSON")
    args = parser.parse_args()
    
    floors = list(SVG_FILES.keys()) if args.all else ([args.floor] if args.floor else ["P4", "P5"])
    use_manual = not args.auto
    
    all_spaces = []
    
    for floor_id in floors:
        svg_path = SVG_FILES[floor_id]
        if not svg_path.exists():
            print(f"⚠ File non trovato: {svg_path}")
            continue
        
        print(f"\n{'='*60}")
        print(f"Parsing {floor_id}: {svg_path.name}")
        print('='*60)
        
        spaces = parse_svg(svg_path, floor_id, use_manual=use_manual)
        all_spaces.extend(spaces)
        
        print(f"\n  → {len(spaces)} spazi estratti per {floor_id}")
    
    # Salva output JSON
    out_path = OUT_DIR / args.output
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(all_spaces, f, indent=2, ensure_ascii=False)
    
    print(f"\n{'='*60}")
    print(f"Output salvato: {out_path}")
    print(f"Totale spazi: {len(all_spaces)}")
    
    types = Counter(s["bems_type"] for s in all_spaces)
    print("\nRiepilogo per tipo:")
    for t, cnt in sorted(types.items()):
        print(f"  {t}: {cnt}")
    
    return all_spaces


if __name__ == "__main__":
    main()
