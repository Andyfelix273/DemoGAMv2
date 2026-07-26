# Changelog

Tutte le modifiche rilevanti al progetto **GAM + BEMS** sono documentate in questo file.

Il formato segue [Keep a Changelog](https://keepachangelog.com/it/1.0.0/).
Le versioni seguono [Semantic Versioning](https://semver.org/lang/it/).

---

## [Unreleased] — branch `bems-v2`

### Aggiunto
- **Modulo Tariffe & Bollette** (`invoices_pg.py`): gestione forniture energetiche (elettricità, gas, acqua) con upload PDF, estrazione dati tramite LLM (GPT-4o-mini + pdfplumber), calcolo costo unitario automatico e storico bollette per asset
- **Tab "Tariffe & Bollette"** nella modale di dettaglio asset (modulo Efficiency): KPI costi unitari per commodity, tabella forniture, upload drag-and-drop con progress bar, inserimento manuale, storico bollette con colonna **Quota oneri**
- **Pagina sidebar `efficiency-invoices.html`**: dashboard aggregata costi unitari su tutti gli asset con filtri commodity/tipo e apertura diretta modale dettaglio
- **Voce di menu "Tariffe & Bollette"** nella sidebar del modulo Asset Efficiency

### Modificato
- **Flusso bollette**: eliminato prerequisito fornitura obbligatoria — le forniture vengono create automaticamente dal POD/PDR estratto dalla bolletta
- **Validazione cross-asset**: se il POD estratto appartiene già a un altro asset, la bolletta viene marcata `wrong_asset` con avviso visivo (bordo rosso) invece di essere abbinata silenziosamente
- **Prompt LLM**: aggiunte descrizioni esplicite per `total_amount_eur` (totale bolletta IVA inclusa), `quota_oneri_eur` (costi diversi dalla materia prima) e `point_code` (POD/PDR/matricola)
- **Tab "Zone & Occupancy"**: le tab "Occupancy" e "Zone" della modale dettaglio asset (modulo Efficiency) sono state unificate in un'unica tab con KPI aggregati in cima e card zone dettagliate
- **Colorazione marker mappa Efficiency**: rimosso doppio mapping hardcoded `color→efficiency_level` nel JS; il backend ora restituisce direttamente `efficiency_level: "alta"/"media"/"bassa"` nell'endpoint `/api/energy/heatmap`
- **Terminologia**: sostituito "flotta" con "asset" in tutti i file del modulo Efficiency

### Corretto
- Badge `wrong_asset` aggiunto a `statusBadge()` con classe `badge-scaduta` (rosso)
- Classe CSS `edm-inv-wrong-asset` aggiunta con bordo rosso e sfondo semi-trasparente

---

## [Unreleased — commodity] — 2026-07-26

### Aggiunto
- **Set commodity esteso**: aggiunti `GAS_GPL` (GPL, kg), `HEATING_OIL` (Gasolio riscaldamento, litri), `DIESEL` (Gasolio autotrazione, litri), `PETROL` (Benzina, litri)
- Classi CSS `edm-inv-commodity-card.*` per tutte le 7 commodity con colori distinti

### Modificato
- Rinominato `GAS` → `GAS_METHANE` con migrazione automatica dati esistenti (`ALTER TABLE` + `UPDATE`)
- `COMMODITY_META` è ora l'unica fonte di verità per label, unità, icone e colori in tutto il modulo
- Dashboard aggregata `efficiency-invoices.html` genera KPI strip e colonne tabella **dinamicamente** in base alle commodity presenti nei dati (nessun hardcoding)
- Select commodity/unità aggiornati in tutti i form (inserimento manuale e nuova fornitura)
- Prompt LLM aggiornato con tutti i 7 codici commodity

---

## [1.3.0] — 2026-07-26

### Aggiunto
- **Modulo Asset Efficiency** (`efficiency-map.html`, `efficiency-assets.html`, `efficiency-detail-modal.js`): mappa heatmap con marker colorati per livello di efficienza energetica, pannello KPI laterale, modale dettaglio con tab Anagrafica, Consumi, Allarmi, ESG, Impianti, Zone & Occupancy, Tariffe & Bollette
- **`efficiency-map-core.js`**: logica mappa Leaflet con heatmap, pannello HUD, polling live
- **`efficiency-map-stats.js`**: KPI aggregati pannello laterale (kWh totali, CO₂, costo/giorno, anomalie, top consumi)
- **`efficiency-detail-modal.js`**: modale condivisa dettaglio asset per il modulo Efficiency

### Modificato
- **`energy_pg.py`**: aggiunto campo `efficiency_level` nell'endpoint `/api/energy/heatmap` (mantenuto `color` per retrocompatibilità)
- **`efficiency-map-core.js`**: rimosso doppio mapping colore→livello, usa direttamente `efficiency_level` dal backend

---

## [1.2.0] — 2026-07-25

### Aggiunto
- **Gestione Documenti globale** (`documents.html`): pagina con KPI, filtri per tipo/asset/data, lista documenti, viewer PDF inline con token JWT, voce menu sidebar
- **Codici univoci** `DOC-YYYY-NNNN` per documenti e `SCA-YYYY-NNNN` per scadenze, visualizzati in lista
- **Viewer PDF inline** nella tab Documenti della modale asset (Blob URL con autenticazione JWT)
- **Dettaglio scadenza cliccabile** nella tab Scadenze della modale asset
- **Gestione Referenti asset**: tabelle DB, endpoint CRUD, seed dati, UI nella modale asset
- **Design system centralizzato** `bems-ui.css`: applicato a 13 pagine HTML, elimina CSS inline sparso
- **`documents.js`** e **`deadlines.js`**: moduli panel condivisi per WO, Scadenze, Documenti — eliminata duplicazione CRUD tra mappa e anagrafica

### Modificato
- **Font Awesome**: aggiornato da 4.7.0 a 6.4.0 con v4-shims per retrocompatibilità; sostituite tutte le icone `-o` (outline) con equivalenti FA6
- **Icone CRUD**: unificate su tutta la piattaforma con set FA6 ufficiale (`fa-eye`, `fa-pen`, `fa-trash`, `fa-plus`)
- **Sidebar**: centralizzata in `renderSidebar()` con supporto modulo `gam`/`efficiency`; aggiunta voce Documenti
- **BIM/Planimetria**: rimosso hardcoding `BIM_ASSET_IDS`, tutto gestito da DB; tab sempre visibili con messaggio assenza dati
- **`map.js`**: eliminato blocco Planimetria+BIM duplicato (248 righe), usa `map-bim.js` centralizzato; rimossa funzione `apriModaleAsset` duplicata

### Corretto
- `date()` SQLite → PostgreSQL in `deadlines/stats`; rimosso `last_insert_rowid()`
- Formattazione data grezza ISO in tab Scadenze della modale
- Badge tipo duplicato rimosso da `documents.js`
- `API.request` esposto nell'oggetto pubblico per uso in moduli generici
- `utils.js` aggiunto in `map.html` ed `efficiency-map.html` per `renderSidebar` centralizzata
- Barra filtri uniformata su riga singola (`filtri-bar`) in assets, workorders, efficiency-assets
- `mount(null)` inietta solo le modali senza sovrascrivere il body nelle pagine standalone
- Permessi `users.*` aggiunti al ruolo admin
- Endpoint `/api/users` CRUD e permessi corretti

---

## [1.1.0] — 2026-07-24

### Aggiunto
- **BEMS Studio**: configuratore integratori multi-step con planimetria SVG BIM-ready interattiva (Step 2), accessibile dalla schermata di selezione moduli
- **Redesign Quadro Sinottico**: titolo centrato, 3 KPI per riga, intestazioni con bordo accent
- **Pulsante upload documenti** nella modale asset
- **Gestione Referenti**: base per anagrafica contatti per asset

### Modificato
- **Modale dettaglio asset**: unificata tra `assets.html` e `map.html` tramite `map-modal.js`
- **Rinomina ESG → Efficienza energetica** in tutto il frontend (GIS + dimostratore)
- **Work Order → Manutenzione** nelle intestazioni KPI
- **BEMS Studio Step 2**: `pointer-events:none` su elementi decorativi SVG; tooltip corretto per zona

### Corretto
- `_CompatRow.fetchone()[0]` compatibile con `RealDictCursor` PostgreSQL
- BEMS Studio Step 2: usa sempre SVG BIM-ready (ignora `svg_file` dal DB)
- Listener click tab modale in `assets.html`
- `null-safe getElementById` in `map-modal.js` per `assets.html`
- Coerenza dati WO/scadenze tra mappa e anagrafica
- Intestazioni KPI group centrate, rimosso `border-left` azzurro

---

## [1.0.0] — 2026-07-24

### Aggiunto
- **GIS Asset Manager** (`map.html`, `assets.html`): mappa Leaflet con marker asset, pannello laterale KPI, modale dettaglio con tab Anagrafica, Monitoraggio, Efficienza energetica, Allarmi, Work Order, Documenti, Scadenze, Planimetria, BIM, 3D
- **Backend FastAPI** (`main_pg.py`): autenticazione JWT, gestione utenti e permessi, API REST per asset, telemetria, allarmi, work order, documenti, scadenze, BIM
- **`energy_pg.py`**: modulo energetico con heatmap, KPI consumi, anomalie, storico
- **`occupancy_pg.py`**: modulo occupancy con zone, telemetria ambientale
- **Database PostgreSQL**: schema completo con seed dati demo (20 asset, telemetria, WO, documenti, scadenze)
- **`bems-ui.css`**: design system dark theme con variabili CSS, componenti badge, modal, form, tabelle
- **`api.js`**: client API centralizzato con gestione token JWT e permessi

[Unreleased]: https://github.com/Andyfelix273/DemoGAMv2/compare/bems-v2...HEAD
