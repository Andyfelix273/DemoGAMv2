# GAM Platform — Design System React

## Tre approcci stilistici

### A. Tactical Dark (0.07)
Dashboard militare-industriale. Sfondo quasi nero con griglia sottile, accent ciano-elettrico, tipografia monospace per i dati numerici. Evoca sale controllo e sistemi SCADA.

### B. Slate & Amber (0.05)
Toni slate profondi con accent ambra/arancio. Ispirato a Bloomberg Terminal e strumenti finanziari professionali. Dati densi, leggibilità massima.

### C. Midnight Blueprint (0.88) ← SCELTO
Riprende fedelmente il design token del frontend esistente (`#0D1B2A`, `#00A3E0`) ma lo eleva con gerarchia tipografica forte, micro-animazioni precise e layout asimmetrico sidebar-first. Non è un reskin — è una versione "crafted" dello stesso linguaggio visivo che gli utenti già conoscono.

---

## Design scelto: Midnight Blueprint

### Design Movement
**Operational Dark UI** — interfacce di controllo industriale modernizzate. Riferimento: Grafana, Linear, Vercel Dashboard. Non cyberpunk, non neon: professionale, denso, preciso.

### Core Principles
1. **Densità informativa senza caos** — ogni pixel porta dati, ma la gerarchia è cristallina
2. **Coerenza assoluta** — stessa card, stesso badge, stesso grafico ovunque nella piattaforma
3. **Nessun inline, nessun hardcoded** — tutto via token CSS e componenti parametrici
4. **Feedback immediato** — ogni azione ha risposta visiva < 160ms

### Color Philosophy
- **Base**: `#0D1B2A` (navy profondo) — evoca notte, controllo, serietà
- **Surface**: `#132338` (card), `#1A2E45` (input/hover)
- **Border**: `#1E3A5F` — sottile, non invadente
- **Accent primario**: `#00A3E0` (ciano KeyBiz) — azioni, link, selezioni attive
- **Accent semantici**: verde `#27AE60` (ok), arancio `#F39C12` (warning), rosso `#E74C3C` (danger), giallo `#F1C40F` (info)
- **Testo**: `#E8F4FD` (primario), `#7BAFC4` (secondario), `#4A7A9B` (muted)

### Layout Paradigm
**Sidebar fissa 56px (icone) / 220px (espansa) + content area full-height**.
Nessun layout centrato. La sidebar è sempre visibile. Il contenuto principale usa tutta la larghezza disponibile.
Topbar sottile (48px) con breadcrumb + azioni contestuali + badge allarmi.

### Signature Elements
1. **KpiCard**: card con numero grande, label piccola, trend arrow, colore semantico — identica in tutti i moduli
2. **StatusBadge**: pill colorata per stato asset, tipo zona, classe energetica — sempre lo stesso componente
3. **SectionDivider**: linea accent-blue con label uppercase — separa le sezioni nelle modali

### Interaction Philosophy
Hover: `bg-surface` → `bg-surface-hover` (transizione 120ms). Click: scale(0.97) 160ms. Modal: slide-up 220ms ease-out. Tab switch: fade 150ms.

### Animation
- Sidebar collapse/expand: 200ms ease-out
- Modal open: translateY(8px)→0 + opacity 0→1, 220ms
- Card hover: translateY(-1px) + shadow, 120ms
- Numero KPI: count-up 600ms ease-out al primo render
- Nessuna animazione su azioni frequenti (click, input)

### Typography System
- **Display/Titoli**: `Montserrat` 600/700 — forte, geometrico
- **Body/Label**: `Inter` 400/500 — leggibile, neutro
- **Dati numerici**: `JetBrains Mono` — monospace per allineamento colonne
- Gerarchia: 24px titolo modale → 13px label → 11px muted

### Brand Essence
**"Il sistema nervoso degli edifici intelligenti"** — per facility manager e energy manager che gestiscono patrimoni immobiliari complessi.
Aggettivi: **Preciso. Affidabile. Professionale.**

### Brand Voice
- Headline: "Controllo totale del tuo patrimonio immobiliare"
- CTA: "Apri dettaglio" / "Configura soglie" / "Esporta report"
- Niente: "Benvenuto!", "Inizia ora", "Scopri di più"

### Wordmark & Logo
Monogramma **GAM** in Montserrat Bold con accent-blue sul carattere G. Nessun testo decorativo.

### Signature Brand Color
`#00A3E0` — ciano KeyBiz. Unico, riconoscibile, coerente con il brand madre.
