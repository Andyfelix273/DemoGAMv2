/**
 * map-bim.js — Viewer Planimetria SVG e scheda BIM nella modale asset
 *
 * @module map-bim
 * @requires map-config.js  Costanti globali
 * @requires api.js         Autenticazione, fetch helper
 *
 * Funzioni principali:
 *   mmCaricaPlanimetria(assetId)   Carica dati IFC e renderizza il panel Planimetria
 *   mmRenderPlanimetriaPanel()     Renderizza i pulsanti piano e il primo SVG
 *   mmSelezionaPiano(pianoId, btn) Cambia il piano visualizzato nel viewer SVG
 *   mmRenderSVG(pianoId)           Inietta l'SVG del piano nel contenitore
 *   mmCaricaBIM(assetId)           Carica dati IFC e renderizza il panel BIM
 *   mmRenderBIMPanel()             Renderizza la scheda informativa BIM (piani, elementi)
 *
 * Costanti:
 *   MM_IFC_ASSET_ID   asset_id con planimetrie IFC reali (Sede Centrale Roma = 6)
 *   BIM_IFC_ASSET_ID  asset_id con modello IFC reale per il panel BIM (= 6)
 */
/* global API, GAM_CONFIG */
// =============================================
// TAB PLANIMETRIA — viewer SVG nella modale
// =============================================
let _mmPlaniData = null;
let _mmPianoCorrente = null;
const MM_STATO_COLOR = { critico:'#E74C3C', warning:'#F39C12', ok:'#27AE60', nessuno:'rgba(123,175,196,0.6)' };
const MM_STATO_LABEL = { critico:'Critico', warning:'Attenzione', ok:'Operativo', nessuno:'' };

// Dati piani IFC reali per Sede Centrale Roma
const MM_IFC_PIANI = [
  { id: 'piano_terra',     label: 'Ground Floor' },
  { id: 'piano_1',         label: 'First Floor' },
  { id: 'piano_2',         label: 'Second Floor' },
  { id: 'piano_copertura', label: 'Roof Level' },
];

/**
 * Carica i dati IFC e renderizza il panel Planimetria nella modale.
 *
 * Per l'asset IFC reale (GAM_CONFIG.IFC_ASSET_ID) usa direttamente i piani
 * predefiniti MM_IFC_PIANI senza chiamare il backend. Per gli altri asset
 * chiama /api/bim/{assetId}.
 *
 * @async
 * @function mmCaricaPlanimetria
 * @param {number} assetId - ID dell'asset di cui caricare la planimetria
 * @returns {Promise<void>}
 */
async function mmCaricaPlanimetria(assetId) {
  document.getElementById('mm-panel-planimetria').innerHTML = '<div class="spinner" style="margin:24px auto"></div>';
  if (assetId === MM_IFC_ASSET_ID) {
    // Usa direttamente i piani IFC reali senza chiamare il backend BIM simulato
    _mmPlaniData = { bim: { piani: MM_IFC_PIANI, locali: [] } };
    mmRenderPlanimetriaPanel();
    return;
  }
  try {
    const res = await fetch(`/api/bim/${assetId}`, { headers: { 'Authorization': 'Bearer ' + API.getToken() } });
    if (!res.ok) throw new Error('Dati planimetria non disponibili');
    _mmPlaniData = await res.json();
    mmRenderPlanimetriaPanel();
  } catch(e) {
    console.warn('[mmCaricaPlanimetria] Impossibile caricare la planimetria per asset', assetId, ':', e.message);
    document.getElementById('mm-panel-planimetria').innerHTML =
      `<div style="text-align:center;padding:20px;color:var(--stato-inattivo)">
         <i class="fas fa-exclamation-triangle" style="font-size:24px;margin-bottom:8px;display:block;"></i>
         <div style="font-size:13px">Planimetria non disponibile.</div>
         <div style="font-size:11px;margin-top:4px;color:var(--text-secondary)">${e.message}</div>
       </div>`;
  }
}

// Mappa piano ID → file SVG IFC reale (per asset_id=6, Sede Centrale Roma)
const MM_IFC_SVG_MAP = {
  'piano_terra':      '/static/ifc/plans/piano_terra.svg',
  'piano_1':          '/static/ifc/plans/piano_1.svg',
  'piano_2':          '/static/ifc/plans/piano_2.svg',
  'piano_copertura':  '/static/ifc/plans/copertura.svg',
};
// ID asset con planimetrie IFC reali — letto dalla configurazione centralizzata (config.js)
const MM_IFC_ASSET_ID = GAM_CONFIG.IFC_ASSET_ID;

/**
 * Renderizza i pulsanti di selezione piano e il primo SVG nel panel Planimetria.
 *
 * Distingue tra asset con planimetrie IFC reali (immagine SVG) e asset con
 * planimetrie schematiche (SVG generato dinamicamente con dati locali).
 *
 * @function mmRenderPlanimetriaPanel
 * @returns {void}
 */
function mmRenderPlanimetriaPanel() {
  if (!_mmPlaniData) return;
  const bim = _mmPlaniData.bim;
  const piani = bim.piani;
  _mmPianoCorrente = piani[0].id;
  const hasIFC = (_assetAperto === MM_IFC_ASSET_ID);

  const pianiHtml = piani.map((p, i) =>
    `<button class="mm-piano-btn ${i===0?'active':''}" data-piano="${p.id}" onclick="mmSelezionaPiano('${p.id}', this)">${p.label}</button>`
  ).join('');

  const legendaHtml = hasIFC ? `
    <div class="mm-plani-legend">
      <div class="mm-plani-legend-item"><div class="mm-plani-legend-dot" style="background:#7ab0d0"></div> Pareti</div>
      <div class="mm-plani-legend-item"><div class="mm-plani-legend-dot" style="background:#40b0e0"></div> Finestre</div>
      <div class="mm-plani-legend-item"><div class="mm-plani-legend-dot" style="background:#e8a030"></div> Porte</div>
      <div class="mm-plani-legend-item"><div class="mm-plani-legend-dot" style="background:#2a5070"></div> Scale</div>
      <div class="mm-plani-legend-item" style="margin-left:12px;color:var(--text-secondary);font-size:10px"><i class="fa fa-file-code" style="margin-right:4px"></i>Estratto da modello IFC4</div>
    </div>` : `
    <div class="mm-plani-legend">
      <div class="mm-plani-legend-item"><div class="mm-plani-legend-dot" style="background:rgba(231,76,60,0.55);border:1px solid #E74C3C"></div> Critico</div>
      <div class="mm-plani-legend-item"><div class="mm-plani-legend-dot" style="background:rgba(243,156,18,0.45);border:1px solid #F39C12"></div> Attenzione</div>
      <div class="mm-plani-legend-item"><div class="mm-plani-legend-dot" style="background:rgba(39,174,96,0.35);border:1px solid #27AE60"></div> Operativo</div>
      <div class="mm-plani-legend-item"><div class="mm-plani-legend-dot" style="background:rgba(52,152,219,0.30);border:1px solid rgba(52,152,219,0.6)"></div> Area funzionale</div>
    </div>`;

  document.getElementById('mm-panel-planimetria').innerHTML = `
    <div class="mm-plani-wrap">
      <div class="mm-plani-toolbar">
        <span style="font-size:11px;color:var(--text-secondary);margin-right:4px">Piano:</span>
        ${pianiHtml}
      </div>
      <div class="mm-svg-container" id="mm-svg-container" style="position:relative">
        ${hasIFC ? '<div id="mm-plani-inline" style="width:100%;height:100%"></div>' : '<svg id="mm-plani-svg" viewBox="0 0 100 70" xmlns="http://www.w3.org/2000/svg"></svg>'}
      </div>
      <div id="mm-space-tooltip" style="
        display:none;position:fixed;z-index:9999;
        background:rgba(13,27,42,0.97);border:1px solid rgba(0,163,224,0.4);
        border-radius:8px;padding:10px 14px;pointer-events:none;
        min-width:180px;max-width:260px;box-shadow:0 4px 20px rgba(0,0,0,0.5);
      "></div>
      ${legendaHtml}
    </div>`;
  mmRenderSVG(_mmPianoCorrente);
}

/**
 * Cambia il piano visualizzato nel viewer planimetria.
 *
 * Aggiorna lo stato attivo dei pulsanti piano e chiama mmRenderSVG
 * per aggiornare il contenuto del viewer.
 *
 * @function mmSelezionaPiano
 * @param {string}      pianoId - ID del piano da visualizzare (es. 'piano_terra')
 * @param {HTMLElement} btnEl   - Pulsante piano cliccato (per aggiornare la classe 'active')
 * @returns {void}
 */
function mmSelezionaPiano(pianoId, btnEl) {
  document.querySelectorAll('.mm-piano-btn').forEach(b => b.classList.remove('active'));
  btnEl.classList.add('active');
  _mmPianoCorrente = pianoId;
  mmRenderSVG(pianoId);
}

/**
 * Inietta il contenuto SVG del piano nel viewer planimetria.
 *
 * Per asset con IFC reale imposta il src dell'elemento img.
 * Per asset con planimetria schematica genera l'SVG dinamicamente
 * dai dati locali (locali, stato operativo, tipo).
 *
 * @function mmRenderSVG
 * @param {string} pianoId - ID del piano da renderizzare (es. 'piano_terra')
 * @returns {void}
 */
function mmRenderSVG(pianoId) {
  if (!_mmPlaniData) return;
  // Se asset con IFC reale: carica SVG inline via fetch per abilitare tooltip
  const inlineEl = document.getElementById('mm-plani-inline');
  if (inlineEl && MM_IFC_SVG_MAP[pianoId]) {
    const svgUrl = MM_IFC_SVG_MAP[pianoId] + '?v=' + Date.now();
    fetch(svgUrl)
      .then(r => r.text())
      .then(svgText => {
        inlineEl.innerHTML = svgText;
        const svgEl = inlineEl.querySelector('svg');
        if (svgEl) {
          svgEl.style.width = '100%';
          svgEl.style.height = '100%';
          svgEl.style.display = 'block';
          _mmBindSpaceTooltips(svgEl);
        }
      })
      .catch(() => {
        inlineEl.innerHTML = '<p style="color:var(--stato-inattivo);padding:20px">Errore caricamento planimetria.</p>';
      });
    return;
  }
  const locali = _mmPlaniData.bim.locali.filter(l => l.piano === pianoId);
  const svg = document.getElementById('mm-plani-svg');
  if (!svg) return;
  svg.innerHTML = '';
  const NS = 'http://www.w3.org/2000/svg';
  // Sfondo
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('x','2'); bg.setAttribute('y','2'); bg.setAttribute('width','96'); bg.setAttribute('height','66');
  bg.setAttribute('rx','1'); bg.setAttribute('fill','rgba(19,35,56,0.6)'); bg.setAttribute('stroke','rgba(255,255,255,0.15)'); bg.setAttribute('stroke-width','0.5');
  svg.appendChild(bg);
  // Griglia
  for (let x=10;x<100;x+=10) { const l=document.createElementNS(NS,'line'); l.setAttribute('x1',x);l.setAttribute('y1','2');l.setAttribute('x2',x);l.setAttribute('y2','68');l.setAttribute('stroke','rgba(255,255,255,0.04)');l.setAttribute('stroke-width','0.3');svg.appendChild(l); }
  for (let y=10;y<70;y+=10) { const l=document.createElementNS(NS,'line'); l.setAttribute('x1','2');l.setAttribute('y1',y);l.setAttribute('x2','98');l.setAttribute('y2',y);l.setAttribute('stroke','rgba(255,255,255,0.04)');l.setAttribute('stroke-width','0.3');svg.appendChild(l); }
  // Locali
  locali.forEach(loc => {
    const g = document.createElementNS(NS,'g'); g.classList.add('mm-bim-room'); g.dataset.id = loc.id;
    const rect = document.createElementNS(NS,'rect');
    rect.setAttribute('x',loc.x); rect.setAttribute('y',loc.y); rect.setAttribute('width',loc.w); rect.setAttribute('height',loc.h);
    rect.setAttribute('rx','0.8'); rect.setAttribute('stroke-width','1');
    if (loc.asset_id) { rect.classList.add(`mm-fill-${loc.stato_operativo||'nessuno'}`); }
    else { rect.classList.add(`mm-fill-tipo-${loc.tipo||'comune'}`); }
    g.appendChild(rect);
    const text = document.createElementNS(NS,'text'); text.classList.add('mm-bim-room-label');
    text.setAttribute('x', loc.x + loc.w/2); text.setAttribute('y', loc.y + loc.h/2 - (loc.h>12?2:0));
    const maxChars = Math.floor(loc.w/1.8);
    text.textContent = loc.nome.length > maxChars ? loc.nome.substring(0,maxChars-1)+'…' : loc.nome;
    g.appendChild(text);
    if (loc.h > 12) {
      const sub = document.createElementNS(NS,'text'); sub.classList.add('mm-bim-room-sublabel');
      sub.setAttribute('x', loc.x+loc.w/2); sub.setAttribute('y', loc.y+loc.h/2+3.5);
      if (loc.asset_id && loc.stato_operativo !== 'ok' && loc.stato_operativo !== 'nessuno') {
        sub.textContent = MM_STATO_LABEL[loc.stato_operativo]||''; sub.setAttribute('fill', MM_STATO_COLOR[loc.stato_operativo]||'rgba(255,255,255,0.55)');
      } else { sub.textContent = `${(loc.mq||0).toLocaleString('it-IT')} m²`; }
      g.appendChild(sub);
    }
    svg.appendChild(g);
  });
}

// =============================================
// TOOLTIP SPAZI IFC — mouseover/click sui rect
// =============================================
/**
 * Aggiunge eventi mouseover, mousemove e click ai rettangoli .ifc-space
 * nell'SVG inline della planimetria, mostrando un tooltip con i dettagli dello spazio.
 *
 * @function _mmBindSpaceTooltips
 * @param {SVGElement} svgEl - Elemento SVG inline su cui operare
 * @returns {void}
 */
function _mmBindSpaceTooltips(svgEl) {
  const tooltip = document.getElementById('mm-space-tooltip');
  if (!tooltip) return;

  // Evidenzia il rettangolo selezionato
  let _selectedRect = null;

  svgEl.querySelectorAll('rect.ifc-space').forEach(rect => {
    // Hover: mostra tooltip
    rect.addEventListener('mouseenter', function(e) {
      const nome  = this.dataset.nome  || '—';
      const area  = this.dataset.area  || '—';
      const tipo  = this.dataset.tipo  || '—';
      const num   = this.dataset.num   || '—';
      const guid  = this.dataset.guid  || '—';
      tooltip.innerHTML = `
        <div style="font-size:12px;font-weight:700;color:#F0F4F8;margin-bottom:6px">${nome}</div>
        <table style="font-size:11px;border-collapse:collapse;width:100%">
          <tr><td style="color:#8FA8C0;padding:2px 0">Stanza</td><td style="color:#F0F4F8;text-align:right">${num}</td></tr>
          <tr><td style="color:#8FA8C0;padding:2px 0">Tipo</td><td style="color:#F0F4F8;text-align:right">${tipo}</td></tr>
          <tr><td style="color:#8FA8C0;padding:2px 0">Superficie netta</td><td style="color:#00A3E0;text-align:right;font-weight:600">${area}</td></tr>
          <tr><td style="color:#8FA8C0;padding:2px 0;font-size:9px">GUID</td><td style="color:#5A7A96;text-align:right;font-size:9px;font-family:monospace">${guid.substring(0,12)}…</td></tr>
        </table>`;
      tooltip.style.display = 'block';
      // Highlight
      this.style.filter = 'brightness(1.5)';
      this.style.strokeWidth = '2.5';
    });

    rect.addEventListener('mousemove', function(e) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let tx = e.clientX + 16;
      let ty = e.clientY - 10;
      // Evita uscita dallo schermo
      if (tx + 270 > vw) tx = e.clientX - 270;
      if (ty + 140 > vh) ty = e.clientY - 140;
      tooltip.style.left = tx + 'px';
      tooltip.style.top  = ty + 'px';
    });

    rect.addEventListener('mouseleave', function() {
      if (this !== _selectedRect) {
        this.style.filter = '';
        this.style.strokeWidth = '';
      }
      tooltip.style.display = 'none';
    });

    // Click: fissa la selezione
    rect.addEventListener('click', function(e) {
      e.stopPropagation();
      if (_selectedRect && _selectedRect !== this) {
        _selectedRect.style.filter = '';
        _selectedRect.style.strokeWidth = '';
        _selectedRect.style.outline = '';
      }
      _selectedRect = this;
      this.style.filter = 'brightness(1.8)';
      this.style.strokeWidth = '3';
    });
  });

  // Click fuori: deseleziona
  svgEl.addEventListener('click', function() {
    if (_selectedRect) {
      _selectedRect.style.filter = '';
      _selectedRect.style.strokeWidth = '';
      _selectedRect = null;
    }
  });
}

// =============================================
// TAB BIM — dati IFC reali nella modale
// =============================================
// ID asset con modello IFC reale per il panel BIM — letto dalla configurazione centralizzata (config.js)
const BIM_IFC_ASSET_ID = GAM_CONFIG.IFC_ASSET_ID;
let _mmBimData = null;

/**
 * Carica i dati IFC reali e renderizza il panel BIM nella modale.
 *
 * Disponibile solo per l'asset con GAM_CONFIG.IFC_ASSET_ID (Sede Centrale Roma).
 * Carica il file JSON /static/ifc/office_building_data.json e chiama mmRenderBIMPanel.
 * Per gli altri asset mostra un messaggio informativo.
 *
 * @async
 * @function mmCaricaBIM
 * @param {number} assetId - ID dell'asset di cui caricare il modello BIM
 * @returns {Promise<void>}
 */
async function mmCaricaBIM(assetId) {
  document.getElementById('mm-panel-bim').innerHTML = '<div class="spinner" style="margin:24px auto"></div>';
  if (assetId !== BIM_IFC_ASSET_ID) {
    document.getElementById('mm-panel-bim').innerHTML = '<p style="color:var(--text-secondary);font-size:13px"><i class="fa fa-info-circle"></i> Modello IFC non disponibile per questo asset. Disponibile per: Sede Centrale Roma.</p>';
    return;
  }
  try {
    const res = await fetch('/static/ifc/office_building_data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('Dati IFC non disponibili');
    _mmBimData = await res.json();
    mmRenderBIMPanel();
  } catch(e) {
    console.warn('[mmCaricaBIM] Impossibile caricare il modello BIM per asset', assetId, ':', e.message);
    document.getElementById('mm-panel-bim').innerHTML =
      `<div style="text-align:center;padding:20px;color:var(--stato-inattivo)">
         <i class="fas fa-exclamation-triangle" style="font-size:24px;margin-bottom:8px;display:block;"></i>
         <div style="font-size:13px">Dati BIM non disponibili.</div>
         <div style="font-size:11px;margin-top:4px;color:var(--text-secondary)">${e.message}</div>
       </div>`;
  }
}

/**
 * Renderizza la scheda informativa BIM con riepilogo strutturale e distribuzione elementi.
 *
 * Mostra: schema IFC, conteggi pareti/porte/finestre/scale, distribuzione elementi
 * per categoria, e la struttura per piano con elenco locali e tipi elementi.
 * I piani sono espandibili tramite click.
 *
 * @function mmRenderBIMPanel
 * @returns {void}
 */
function mmRenderBIMPanel() {
  if (!_mmBimData) return;
  const d = _mmBimData;
  const s = d.statistics;
  // Nomi piani e tipi elementi già in italiano nel JSON tradotto

  const storeyRows = d.storeys.map((st, idx) => {
    const nomeIt = st.long_name;
    const elems = Object.entries(st.element_types).sort((a,b)=>b[1]-a[1]);
    const elemsHtml = elems.map(([t,n]) => {
      return `<div class="mm-bim-elem-row"><span class="mm-bim-elem-name">${t}</span><div class="mm-bim-elem-bar-wrap"><div class="mm-bim-elem-bar" style="width:${Math.round(n/st.element_count*100)}%"></div></div><span class="mm-bim-elem-count">${n}</span></div>`;
    }).join('');
    const spacesHtml = st.spaces.length === 0
      ? `<div style="color:var(--text-secondary);font-size:11px;padding:8px 0;font-style:italic">
           <i class="fa fa-info-circle" style="margin-right:5px;color:var(--accent)"></i>
           Piano di copertura — nessuno spazio modellato nel file IFC4.
           Il piano contiene solo elementi costruttivi (solai, pareti perimetrali, vani tecnici di copertura).
           La mancanza di spazi è una scelta del modellatore: le coperture piane non vengono
           tipicamente suddivise in IfcSpace nel LOD 350 architettonico.
         </div>`
      : st.spaces.map(sp => {
          const area = sp.area ? ` <span style="color:var(--text-secondary);font-size:10px">${sp.area} m²</span>` : '';
          return `<div class="mm-bim-space-row"><i class="fa fa-square" style="color:var(--accent);font-size:8px;margin-right:5px"></i><span>${sp.long_name || sp.name}</span>${area}</div>`;
        }).join('');
    return `<div class="mm-bim-storey-block">
      <div class="mm-bim-storey-header" onclick="this.parentElement.classList.toggle('open')">
        <div class="mm-bim-storey-left">
          <i class="fa fa-layer-group" style="color:var(--accent);margin-right:8px"></i>
          <span class="mm-bim-storey-name">${nomeIt}</span>
          <span class="mm-bim-storey-counts">${st.spaces.length} spazi · ${st.element_count} elementi</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="mm-bim-storey-badge">${st.elevation >= 0 ? '+' : ''}${st.elevation}m</span>
          <i class="fa fa-chevron-down mm-bim-chevron"></i>
        </div>
      </div>
      <div class="mm-bim-storey-body">
        <div class="mm-bim-storey-cols">
          <div class="mm-bim-storey-col">
            <div class="mm-bim-col-title">Locali (${st.spaces.length})</div>
            <div class="mm-bim-spaces-list">${spacesHtml}</div>
          </div>
          <div class="mm-bim-storey-col">
            <div class="mm-bim-col-title">Elementi costruttivi</div>
            <div class="mm-bim-elems-list">${elemsHtml}</div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  // Distribuzione globale elementi
  const allTypes = {};
  d.storeys.forEach(st => Object.entries(st.element_types).forEach(([t,n]) => { allTypes[t] = (allTypes[t]||0)+n; }));
  const topTypes = Object.entries(allTypes).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const totalEl = Object.values(allTypes).reduce((a,b)=>a+b,0);
  const globalElemsHtml = topTypes.map(([t,n]) => {
    return `<div class="mm-bim-elem-row"><span class="mm-bim-elem-name">${t}</span><div class="mm-bim-elem-bar-wrap"><div class="mm-bim-elem-bar" style="width:${Math.round(n/totalEl*100)}%"></div></div><span class="mm-bim-elem-count">${n}</span></div>`;
  }).join('');

  // Sezione MEP (solo se presenti dati MEP)
  const hasMEP = s.flow_terminals > 0 || s.duct_segments > 0 || s.pipe_segments > 0;
  const mepHtml = hasMEP ? `
    <div>
      <div class="mm-bim-section-title">MEP Systems</div>
      <div class="mm-bim-stats-grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="mm-bim-stat-card"><div class="mm-bim-stat-val" style="color:#4A90D9">${s.flow_terminals||0}</div><div class="mm-bim-stat-lbl">Flow Terminals</div></div>
        <div class="mm-bim-stat-card"><div class="mm-bim-stat-val" style="color:#4A90D9">${s.duct_segments||0}</div><div class="mm-bim-stat-lbl">Duct Segments</div></div>
        <div class="mm-bim-stat-card"><div class="mm-bim-stat-val" style="color:#4A90D9">${s.pipe_segments||0}</div><div class="mm-bim-stat-lbl">Pipe Segments</div></div>
        <div class="mm-bim-stat-card"><div class="mm-bim-stat-val" style="color:#4A90D9">${s.light_fixtures||0}</div><div class="mm-bim-stat-lbl">Light Fixtures</div></div>
        <div class="mm-bim-stat-card"><div class="mm-bim-stat-val" style="color:#4A90D9">${s.air_terminals||0}</div><div class="mm-bim-stat-lbl">Air Terminals</div></div>
        <div class="mm-bim-stat-card"><div class="mm-bim-stat-val" style="color:#4A90D9">${s.columns||0}</div><div class="mm-bim-stat-lbl">Columns</div></div>
        <div class="mm-bim-stat-card"><div class="mm-bim-stat-val" style="color:#4A90D9">${s.slabs||0}</div><div class="mm-bim-stat-lbl">Slabs</div></div>
        <div class="mm-bim-stat-card"><div class="mm-bim-stat-val" style="color:#4A90D9">${s.stairs||0}</div><div class="mm-bim-stat-lbl">Stairs</div></div>
      </div>
    </div>` : '';

  document.getElementById('mm-panel-bim').innerHTML = `
    <div class="mm-bim-wrap">
      <div class="mm-bim-header">
        <div style="flex:1">
          <div class="mm-bim-title"><i class="fa fa-cube" style="color:var(--accent);margin-right:8px"></i>BIM Model — ${d.building.name || d.project.name}</div>
          <div class="mm-bim-subtitle">${d.project.schema} · ${d.statistics.total_storeys} floors · ${d.statistics.total_spaces} spaces · ${d.statistics.total_elements.toLocaleString()} IFC entities</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <div class="mm-bim-schema-badge">${d.project.schema}</div>
          <div style="font-size:10px;color:var(--text-secondary);white-space:nowrap">${d.statistics.lod ? d.statistics.lod.split('—')[0].trim() : ''}</div>
        </div>
      </div>
      <div style="padding:8px 12px;background:rgba(74,144,217,0.08);border-radius:6px;border:1px solid rgba(74,144,217,0.2);font-size:11px;color:var(--text-secondary);margin-bottom:4px">
        <i class="fa fa-info-circle" style="color:#4A90D9;margin-right:6px"></i>
        <strong style="color:rgba(255,255,255,0.8)">${d.statistics.lod || 'IFC4'}</strong>
        &nbsp;·&nbsp; Source: <code style="font-size:10px;color:var(--accent)">${d.project.source_file || 'IFC4'}</code>
        &nbsp;·&nbsp; Authoring tool: ${d.project.authoring_tool || 'Revit'}
        &nbsp;·&nbsp; Project GUID: <code style="font-size:10px;color:rgba(255,255,255,0.5)">${d.project.guid || ''}</code>
      </div>
      <div class="mm-bim-two-col">
        <div>
          <div class="mm-bim-section-title">Structural Elements</div>
          <div class="mm-bim-stats-grid">
            <div class="mm-bim-stat-card"><div class="mm-bim-stat-val">${s.walls}</div><div class="mm-bim-stat-lbl">Walls</div></div>
            <div class="mm-bim-stat-card"><div class="mm-bim-stat-val">${s.doors}</div><div class="mm-bim-stat-lbl">Doors</div></div>
            <div class="mm-bim-stat-card"><div class="mm-bim-stat-val">${s.columns}</div><div class="mm-bim-stat-lbl">Columns</div></div>
            <div class="mm-bim-stat-card"><div class="mm-bim-stat-val">${s.stairs}</div><div class="mm-bim-stat-lbl">Stairs</div></div>
          </div>
        </div>
        <div>
          <div class="mm-bim-section-title">Element Distribution</div>
          <div class="mm-bim-elems-list">${globalElemsHtml}</div>
        </div>
      </div>
      ${mepHtml}
      <div>
        <div class="mm-bim-section-title">Floor Structure <span style="font-size:11px;color:var(--text-secondary);font-weight:400">(click to expand)</span></div>
        <div class="mm-bim-storeys">${storeyRows}</div>
      </div>
    </div>`;
}

// =============================================
// TORNA ALLA PANORAMICA (non più usata per il pannello, mantenuta per compatibilità)
// =============================================
