# GIS Asset Manager — Dimostratore

Applicazione web per la visualizzazione di asset georeferenziati su mappa interattiva.
Sviluppata come dimostratore per KeyBiz S.r.l.

**Stack:** FastAPI (Python) + SQLite + Leaflet.js + Jawg Maps

---

## Deploy su Render (piano Free)

### Prerequisiti

- Account GitHub (gratuito): https://github.com
- Account Render (gratuito): https://render.com

---

### Passo 1 — Crea un repository GitHub

1. Vai su https://github.com/new
2. Dai un nome al repository, es. `gis-asset-manager`
3. Impostalo come **privato** (consigliato)
4. Clicca **Create repository**

---

### Passo 2 — Carica i file del progetto

Dal terminale della tua macchina (oppure usa l'interfaccia web di GitHub):

```bash
cd /percorso/della/cartella/asset-demo
git init
git add .
git commit -m "primo deploy"
git branch -M main
git remote add origin https://github.com/TUO-USERNAME/gis-asset-manager.git
git push -u origin main
```

---

### Passo 3 — Crea il servizio su Render

1. Vai su https://dashboard.render.com
2. Clicca **New → Web Service**
3. Collega il tuo account GitHub e seleziona il repository `gis-asset-manager`
4. Render rileverà automaticamente il file `render.yaml` e precompilerà i campi
5. Verifica che i campi siano:
   - **Build Command:** `pip install -r requirements.txt && python init_db.py`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Plan:** Free
6. Clicca **Create Web Service**

Il primo deploy richiede circa 2-3 minuti. Al termine, Render fornisce un URL permanente del tipo:

```
https://gis-asset-manager.onrender.com
```

---

### Note importanti

**Ibernazione:** il piano Free iberna il servizio dopo 15 minuti di inattività.
Il primo accesso dopo l'ibernazione richiede circa 30 secondi di attesa (cold start).
Per una demo, avvia il link qualche minuto prima di mostrarlo al cliente.

**Database:** il file `assets.db` viene ricreato ad ogni deploy tramite `init_db.py`.
I dati sono fittizi e a scopo dimostrativo. Per un sistema reale, sostituire SQLite
con PostgreSQL (Render offre un'istanza Postgres gratuita).

**Token Jawg Maps:** il token è incluso nel codice frontend a scopo dimostrativo.
Per un deploy in produzione, spostarlo in una variabile d'ambiente Render.

---

## Struttura del progetto

```
asset-demo/
├── main.py              # Backend FastAPI (API REST)
├── init_db.py           # Script di inizializzazione database
├── assets.db            # Database SQLite (generato da init_db.py)
├── requirements.txt     # Dipendenze Python
├── render.yaml          # Configurazione deploy Render
├── .gitignore
├── README.md
└── static/
    ├── index.html       # Frontend (mappa + pannello)
    ├── keybiz_logo.png  # Logo KeyBiz
    ├── shipping_lanes.geojson   # Rotte marittime globali
    └── med_routes.geojson       # Rotte marittime Mediterraneo
```

---

## Avvio in locale

```bash
pip install -r requirements.txt
python init_db.py
uvicorn main:app --reload --port 8500
```

Apri il browser su: http://localhost:8500

---

*Versione 1.0 — Felix / KeyBiz S.r.l.*
