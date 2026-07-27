# Differenze visive: tab Energia modale vs Energy Summary

## Card KPI

| Elemento | Summary (target) | Modale (attuale) | Problema |
|---|---|---|---|
| Sfondo card | `#0d1b2a` scuro uniforme | Più chiaro / diverso | `--card-bg` non risolto correttamente nella modale |
| Label | 10px uppercase, `#7BAFC4` | Simile ma font-weight diverso | Verificare |
| Valore | 22px bold, `#E8F4FD` | Simile ma dimensione diversa | Verificare |
| Bordo card | `1px solid rgba(30,58,95,0.6)` neutro | Neutro ora (OK dopo fix) | OK |
| Larghezza card | `flex:1 1 130px` — tutte uguali | Alcune card più larghe (EUI, Fuori orario) | EUI e E-5 hanno contenuto extra che le allarga |
| Separatore sezione | Linea blu `SINTESI` con icona | Presente ma stile diverso | Verificare CSS |
| Separatore ANALISI CONSUMI | Linea blu con icona | Presente (OK) | OK |

## Problemi specifici osservati nello screenshot modale

1. **Card "COSTO PER M²"**: mostra "Benchmark undefined: € 0,00–0,00/m²/mese" — bug nel rendering del benchmark
2. **Card "FUORI ORARIO (E-5)"**: ha il donut SVG che la rende molto più alta delle altre card
3. **Card "EUI"**: ha il gauge SVG che la rende più alta — OK per design, ma la card è più larga
4. **Separatore "SINTESI"**: ha sfondo diverso / stile diverso dal summary
5. **Grafici**: sono dentro `.es-section` con `.es-section-title` (OK strutturalmente) ma lo sfondo della card del grafico sembra diverso
6. **Larghezza modale**: la modale è più stretta della pagina summary — le card si comprimono di più

## Azioni necessarie

1. Correggere il bug "Benchmark undefined" nella card E-2
2. Uniformare l'altezza delle card KPI: usare `align-items: flex-start` sulla griglia così le card non si allungano
3. Verificare che `--card-bg` sia definito nel contesto della modale
4. Allineare il separatore SINTESI al design del summary
