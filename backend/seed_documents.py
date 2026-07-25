"""
seed_documents.py — Genera PDF demo e li registra nel DB per tutti gli asset.

Logica:
- Per ogni asset vengono creati almeno 4 documenti (2-3 per tipologia).
- Le tipologie sono: CPI, DVR, APE, Contratto_manutenzione, Planimetria_catastale,
  Libretto_impianto, Collaudo_ascensore, Certificato_conformita.
- Ogni asset riceve 2-3 tipologie con 2 documenti ciascuna (anno diverso).
- I PDF hanno copertina con metadati asset + prima pagina con testo Lorem Ipsum.
- I codici DOC-YYYY-NNNN vengono assegnati progressivamente.
- Lo script è idempotente: cancella i record esistenti (tranne test_upload.pdf)
  e rigenera tutto.
"""

import os
import sys
import random
import psycopg2
from psycopg2.extras import RealDictCursor
from fpdf import FPDF
from datetime import datetime, date

# ── Configurazione ──────────────────────────────────────────────────────────
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://gamuser:gampassword@localhost:5432/gamdb")
UPLOAD_DIR   = os.environ.get("UPLOAD_DIR", "/app/uploads")

# ── Tipologie documenti ─────────────────────────────────────────────────────
TIPOLOGIE = [
    ("CPI",                    "Certificato di Prevenzione Incendi",   "Certificato"),
    ("DVR",                    "Documento di Valutazione dei Rischi",  "Documento"),
    ("APE",                    "Attestato di Prestazione Energetica",  "Attestato"),
    ("Contratto_manutenzione", "Contratto di Manutenzione Ordinaria",  "Contratto"),
    ("Planimetria_catastale",  "Planimetria Catastale",                "Planimetria"),
    ("Libretto_impianto",      "Libretto di Impianto Termico",         "Libretto"),
    ("Collaudo_ascensore",     "Verbale di Collaudo Ascensore",        "Verbale"),
    ("Certificato_conformita", "Certificato di Conformità Impianti",   "Certificato"),
]

LOREM = (
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor "
    "incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud "
    "exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure "
    "dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. "
    "Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt "
    "mollit anim id est laborum.\n\n"
    "Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque "
    "laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi "
    "architecto beatae vitae dicta sunt explicabo. Nemo enim ipsam voluptatem quia voluptas "
    "sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione "
    "voluptatem sequi nesciunt. Neque porro quisquam est, qui dolorem ipsum quia dolor sit "
    "amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incidunt ut "
    "labore et dolore magnam aliquam quaerat voluptatem."
)

ANNI_DISPONIBILI = [2022, 2023, 2024, 2025, 2026]

random.seed(42)


def genera_pdf(percorso: str, asset: dict, tipologia: tuple, anno: int, revisione: int):
    """Genera un PDF con copertina metadati + pagina Lorem Ipsum. Sfondo bianco, testo scuro."""
    cod_tipo, nome_tipo, tipo_doc = tipologia
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)

    def safe(s):
        """Rimuove caratteri non supportati da Helvetica (fuori latin-1)."""
        return str(s).encode('latin-1', errors='replace').decode('latin-1')

    # ── Copertina ────────────────────────────────────────────────────────────
    pdf.add_page()
    # Sfondo bianco (default FPDF)
    pdf.set_fill_color(255, 255, 255)
    pdf.rect(0, 0, 210, 297, 'F')

    # Banda colorata in cima (blu istituzionale)
    pdf.set_fill_color(10, 60, 120)
    pdf.rect(0, 0, 210, 45, 'F')

    # Titolo documento (su banda blu)
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(255, 255, 255)
    pdf.set_y(14)
    pdf.cell(0, 10, safe(nome_tipo), ln=True, align="C")

    # Sottotitolo asset (su banda blu)
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(200, 220, 255)
    nome_safe = safe(asset["nome"])
    pdf.cell(0, 7, nome_safe, ln=True, align="C")

    # Linea separatrice sotto la banda
    pdf.set_draw_color(10, 60, 120)
    pdf.set_line_width(0.8)
    pdf.line(20, 50, 190, 50)
    pdf.set_y(58)

    # Metadati (testo scuro su sfondo bianco)
    meta = [
        ("Codice asset",   safe(asset["codice"])),
        ("Tipo asset",     safe(asset["tipo"])),
        ("Indirizzo",      safe(asset["indirizzo"] + ", " + asset["citta"])),
        ("Tipo documento", safe(tipo_doc)),
        ("Anno",           str(anno)),
        ("Revisione",      f"Rev. {revisione:02d}"),
        ("Emesso da",      "Ufficio Tecnico"),
        ("Data emissione", f"01/01/{anno}"),
        ("Stato",          "Valido"),
    ]
    pdf.set_font("Helvetica", "", 10)
    for label, valore in meta:
        pdf.set_text_color(80, 100, 130)   # grigio-blu per le etichette
        pdf.cell(55, 8, label + ":", ln=False)
        pdf.set_text_color(20, 30, 50)     # quasi nero per i valori
        pdf.cell(0, 8, valore, ln=True)

    # Footer copertina
    pdf.set_y(278)
    pdf.set_draw_color(200, 210, 220)
    pdf.set_line_width(0.3)
    pdf.line(20, 277, 190, 277)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(140, 150, 165)
    pdf.cell(0, 5, safe(f"Documento generato automaticamente - {asset['codice']} - {anno}"), align="C")

    # ── Pagina 1 — Lorem Ipsum ───────────────────────────────────────────────
    pdf.add_page()
    pdf.set_fill_color(255, 255, 255)
    pdf.rect(0, 0, 210, 297, 'F')

    # Intestazione pagina
    pdf.set_fill_color(10, 60, 120)
    pdf.rect(0, 0, 210, 14, 'F')
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(200, 220, 255)
    pdf.set_y(4)
    pdf.cell(0, 6, safe(f"{nome_tipo} - {asset['codice']} - Rev. {revisione:02d}/{anno}"), align="C")
    pdf.set_y(20)

    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(10, 60, 120)
    pdf.cell(0, 8, "1. Premessa e ambito di applicazione", ln=True)
    pdf.ln(3)

    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(20, 30, 50)
    pdf.set_x(15)
    pdf.multi_cell(180, 6, safe(LOREM))

    pdf.set_font("Helvetica", "B", 11)
    pdf.set_text_color(10, 60, 120)
    pdf.ln(5)
    pdf.cell(0, 8, "2. Riferimenti normativi", ln=True)
    pdf.ln(2)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(20, 30, 50)
    pdf.set_x(15)
    pdf.multi_cell(180, 6, safe(
        "Il presente documento e' redatto in conformita' alle disposizioni vigenti in materia "
        "di sicurezza e gestione degli immobili, con particolare riferimento al D.Lgs. 81/2008, "
        "al D.P.R. 151/2011, alla norma UNI EN ISO 9001:2015 e alle Linee Guida ENEA per "
        "la certificazione energetica degli edifici."
    ))

    # Footer pagina
    pdf.set_y(278)
    pdf.set_draw_color(200, 210, 220)
    pdf.set_line_width(0.3)
    pdf.line(20, 277, 190, 277)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(140, 150, 165)
    pdf.cell(95, 5, safe(f"{nome_tipo} - {asset['codice']}"), align="L")
    pdf.cell(95, 5, "Pagina 1", align="R")

    pdf.output(percorso)


def main():
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Leggi tutti gli asset
    cur.execute("SELECT id, codice, nome, tipo, indirizzo, citta FROM assets ORDER BY id")
    assets = cur.fetchall()
    print(f"Asset trovati: {len(assets)}")

    # Cancella documenti seed esistenti (mantieni test_upload.pdf)
    cur.execute("DELETE FROM documents WHERE nome_file NOT LIKE '%test_upload%'")
    print(f"Record documenti seed rimossi.")

    # Contatore globale per codice DOC-YYYY-NNNN
    contatori = {}  # {anno: n}

    def next_codice(anno):
        contatori[anno] = contatori.get(anno, 0) + 1
        return f"DOC-{anno}-{contatori[anno]:04d}"

    # Assegna tipologie per asset (2-3 tipologie, 2 documenti ciascuna)
    records = []
    for asset in assets:
        asset_id = asset["id"]
        # Scegli 2-3 tipologie casuali per questo asset (seed fisso per riproducibilità)
        random.seed(asset_id * 7 + 13)
        n_tipologie = random.randint(2, 3)
        tipologie_asset = random.sample(TIPOLOGIE, n_tipologie)

        for tipologia in tipologie_asset:
            cod_tipo = tipologia[0]
            # 2 documenti per tipologia, anni diversi
            anni = random.sample(ANNI_DISPONIBILI, 2)
            anni.sort()
            for rev, anno in enumerate(anni, 1):
                nome_file = f"{tipologia[1]} - {asset['nome']}"
                nome_percorso = f"{asset_id}_{anno}{rev:02d}01_{cod_tipo}.pdf"
                percorso_completo = os.path.join(UPLOAD_DIR, nome_percorso)
                codice = next_codice(anno)
                ts = f"{anno}-06-01 10:00:00+00"
                records.append({
                    "asset_id":    asset_id,
                    "nome_file":   nome_file,
                    "tipo_mime":   "application/pdf",
                    "percorso":    nome_percorso,
                    "caricato_da": "system",
                    "codice":      codice,
                    "created_at":  ts,
                    "tipologia":   tipologia,
                    "anno":        anno,
                    "revisione":   rev,
                    "asset":       asset,
                    "percorso_completo": percorso_completo,
                })

    print(f"Documenti da generare: {len(records)}")

    for i, r in enumerate(records, 1):
        # Genera PDF
        genera_pdf(r["percorso_completo"], r["asset"], r["tipologia"], r["anno"], r["revisione"])
        # Dimensione file
        dimensione = os.path.getsize(r["percorso_completo"])
        # Inserisci nel DB
        cur.execute("""
            INSERT INTO documents
              (asset_id, nome_file, tipo_mime, dimensione, percorso, caricato_da, codice, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            r["asset_id"], r["nome_file"], r["tipo_mime"],
            dimensione, r["percorso"], r["caricato_da"],
            r["codice"], r["created_at"]
        ))
        if i % 10 == 0:
            print(f"  {i}/{len(records)} documenti generati...")

    conn.commit()
    cur.close()
    conn.close()

    # Verifica finale
    conn2 = psycopg2.connect(DATABASE_URL)
    cur2 = conn2.cursor()
    cur2.execute("SELECT asset_id, COUNT(*) FROM documents GROUP BY asset_id ORDER BY asset_id")
    rows = cur2.fetchall()
    print("\n=== Documenti per asset ===")
    for asset_id, count in rows:
        print(f"  Asset {asset_id:2d}: {count} documenti")
    cur2.close()
    conn2.close()
    print("\nSeed completato.")


if __name__ == "__main__":
    main()
