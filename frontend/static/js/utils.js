/**
 * GIS Asset Manager - Utilities
 * Versione: 2.1 | Autore: Felix / KeyBiz
 *
 * Funzioni condivise: toast, modal conferma, gestione tema, topbar, sidebar.
 */

// ── Toast notifiche ──────────────────────────────────────────────────────────
function showToast(msg, tipo = 'info', durata = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, durata);
}

// ── Modal di conferma ────────────────────────────────────────────────────────
function showConfirm(messaggio, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:380px">
      <div class="modal-header">
        <span class="modal-title">${i18n.t('gen.conferma')}</span>
      </div>
      <p style="color:var(--text-secondary);margin-bottom:4px">${messaggio}</p>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="conf-no">${i18n.t('gen.annulla')}</button>
        <button class="btn btn-danger"    id="conf-si">${i18n.t('gen.si')}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#conf-no').onclick = () => overlay.remove();
  overlay.querySelector('#conf-si').onclick = () => { overlay.remove(); onConfirm(); };
}

// ── Gestione tema ────────────────────────────────────────────────────────────
const Tema = (() => {
  const JAWG_TOKEN = 'QHoHKE9mfIrm3sUkmrrM1v95NtcsqYNtMOdLeC91Hb1n1mLrqMzLWKzTkHLON1bD';

  function get()    { return localStorage.getItem('gam_tema') || 'dark'; }
  function set(t)   { localStorage.setItem('gam_tema', t); apply(t); }
  function toggle() { set(get() === 'dark' ? 'light' : 'dark'); }

  function apply(tema) {
    tema = tema || get();
    if (tema === 'light') {
      document.body.classList.add('light');
    } else {
      document.body.classList.remove('light');
    }
    // Aggiorna logo topbar se presente
    const logoEl = document.getElementById('topbar-logo');
    if (logoEl) {
      logoEl.src = tema === 'dark'
        ? '/static/img/logodark.png'
        : '/static/img/logolight.png';
    }
    // Aggiorna toggle se presente
    const toggleInput = document.getElementById('tema-toggle');
    if (toggleInput) toggleInput.checked = (tema === 'light');
  }

  function jawgUrl(style) {
    return `https://tile.jawg.io/${style}/{z}/{x}/{y}{r}.png?access-token=${JAWG_TOKEN}`;
  }

  function getJawgUrl() {
    return jawgUrl(get() === 'dark' ? 'jawg-dark' : 'jawg-light');
  }

  return { get, set, toggle, apply, getJawgUrl, jawgUrl };
})();

// ── Sidebar verticale ────────────────────────────────────────────────────────
// Inietta la sidebar nell'elemento <nav id="sidebar"> se presente.
// paginaAttiva: 'mappa' | 'anagrafica' | 'allarmi' | 'impostazioni'
function renderSidebar(paginaAttiva) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  sidebar.innerHTML = `
    <a href="/static/map.html"
       class="sidebar-btn ${paginaAttiva === 'mappa' ? 'active' : ''}"
       title="Mappa">
      <i class="fa fa-map-marker"></i>
    </a>


    <a href="/static/assets.html"
       class="sidebar-btn ${paginaAttiva === 'anagrafica' ? 'active' : ''}"
       title="Anagrafica asset">
      <i class="fa fa-database"></i>
    </a>

    <a href="/static/alarms.html"
       class="sidebar-btn ${paginaAttiva === 'allarmi' ? 'active' : ''}"
       title="Allarmi" id="sidebar-allarmi">
      <i class="fa fa-bell"></i>
      <span class="sidebar-dot" id="sidebar-alarm-dot"></span>
    </a>

    <a href="/static/workorders.html"
       class="sidebar-btn ${paginaAttiva === 'workorders' ? 'active' : ''}"
       title="Work Order">
      <i class="fa fa-wrench"></i>
    </a>

    <a href="/static/deadlines.html"
       class="sidebar-btn ${paginaAttiva === 'scadenze' ? 'active' : ''}"
       title="Scadenze">
      <i class="fa fa-calendar"></i>
    </a>

    <a href="/static/asset-efficiency.html"
       class="sidebar-btn ${paginaAttiva === 'efficiency' ? 'active' : ''}"
       title="Asset Efficiency">
      <i class="fa fa-bolt"></i>
    </a>

    <a href="/static/settings.html"
       class="sidebar-btn ${paginaAttiva === 'impostazioni' ? 'active' : ''}"
       title="Impostazioni">
      <i class="fa fa-cog"></i>
    </a>

    <div class="sidebar-spacer"></div>

    <button class="sidebar-btn" onclick="API.logout()" title="Esci">
      <i class="fa fa-sign-out"></i>
    </button>
  `;

  // Carica badge allarmi (pallino rosso)
  aggiornaAlarmDot();
}

// ── Topbar ───────────────────────────────────────────────────────────────────
// La topbar mantiene: logo, titolo, ricerca asset, filtro tipo, toggle tema,
// nome utente, logout. Le voci di navigazione sono spostate nella sidebar.
function renderTopbar(paginaAttiva, opzioni) {
  opzioni = opzioni || {};
  const isAdmin    = API.isAdmin();
  const nome       = API.getNome() || '';
  const mostraFiltri = opzioni.filtri !== false; // default true

  const html = `
    <img id="topbar-logo" class="topbar-logo"
         src="/static/img/${Tema.get() === 'dark' ? 'logodark' : 'logolight'}.png"
         alt="Logo">
    <div class="topbar-divider"></div>
    <span class="topbar-title">GIS Asset Manager</span>

    ${mostraFiltri ? `
    <div class="topbar-divider"></div>

    <!-- Ricerca asset -->
    <div class="topbar-search-wrap">
      <i class="fa fa-search topbar-search-icon"></i>
      <input type="text" id="topbar-search" class="topbar-search"
             placeholder="Cerca asset..." autocomplete="off">
    </div>

    <!-- Filtro tipo asset -->
    <div class="topbar-filter-wrap" id="topbar-tipo-filter">
      <button class="topbar-filter-btn active" data-tipo="">Tutti</button>
      <button class="topbar-filter-btn" data-tipo="stabilimento">
        <i class="fa fa-industry"></i> Stabilimenti
      </button>
      <button class="topbar-filter-btn" data-tipo="ufficio">
        <i class="fa fa-building"></i> Uffici
      </button>
      <button class="topbar-filter-btn" data-tipo="magazzino">
        <i class="fa fa-archive"></i> Magazzini
      </button>
      <button class="topbar-filter-btn" data-tipo="deposito">
        <i class="fa fa-truck"></i> Depositi
      </button>
    </div>
    ` : ''}

    <div class="topbar-spacer"></div>

    <!-- Campanella allarmi -->
    <div class="topbar-alarm-wrap" id="topbar-alarm-wrap" style="position:relative;margin-right:12px;cursor:pointer" onclick="window.location.href='/static/alarms.html'" title="Vai agli allarmi">
      <i class="fa fa-bell" style="font-size:16px;color:var(--text-secondary)"></i>
      <span id="topbar-alarm-badge" style="
        display:none;
        position:absolute;top:-6px;right:-8px;
        background:var(--stato-inattivo,#e74c3c);color:#fff;
        border-radius:10px;padding:1px 5px;font-size:10px;font-weight:700;
        min-width:16px;text-align:center;line-height:16px;
      ">0</span>
    </div>

    <span style="font-size:12px;color:var(--text-secondary);margin-right:8px;white-space:nowrap">
      ${nome} ${isAdmin ? '<span class="badge badge-ok" style="font-size:10px">admin</span>' : ''}
    </span>

    <button class="btn btn-ghost btn-sm" onclick="API.logout()" title="${i18n.t('nav.logout')}">
      <i class="fa fa-sign-out"></i>
    </button>
  `;

  const topbar = document.getElementById('topbar');
  if (topbar) {
    topbar.innerHTML = html;
    i18n.apply();

    // Toggle tema rimosso dalla topbar (gestito in settings.html)

    // Listener filtri tipo (delega evento al wrapper)
    const filterWrap = document.getElementById('topbar-tipo-filter');
    if (filterWrap) {
      filterWrap.addEventListener('click', (e) => {
        const btn = e.target.closest('.topbar-filter-btn');
        if (!btn) return;
        filterWrap.querySelectorAll('.topbar-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Emette evento custom che le pagine possono ascoltare
        document.dispatchEvent(new CustomEvent('filtro-tipo-changed', {
          detail: { tipo: btn.dataset.tipo }
        }));
      });
    }

    // Listener ricerca (debounce 300ms)
    const searchInput = document.getElementById('topbar-search');
    if (searchInput) {
      let debounceTimer;
      searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          document.dispatchEvent(new CustomEvent('ricerca-changed', {
            detail: { query: searchInput.value.trim() }
          }));
        }, 300);
      });
    }
  }
}

// Aggiorna il pallino rosso nella sidebar e il badge campanella in topbar
let _prevAlarmTotale = null;
function aggiornaAlarmDot(totale) {
  // Pallino sidebar
  const dot = document.getElementById('sidebar-alarm-dot');
  if (dot) {
    if (totale > 0) {
      dot.classList.add('visible');
      dot.title = `${totale} allarmi attivi`;
    } else {
      dot.classList.remove('visible');
    }
  }
  // Badge campanella topbar
  const badge = document.getElementById('topbar-alarm-badge');
  const wrap  = document.getElementById('topbar-alarm-wrap');
  if (badge) {
    const cambiato = _prevAlarmTotale !== null && totale !== _prevAlarmTotale;
    if (totale > 0) {
      badge.textContent = totale > 99 ? '99+' : totale;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
    // Animazione flash quando il contatore cambia
    if (cambiato && wrap) {
      wrap.style.transition = 'transform 0.15s ease';
      wrap.style.transform = 'scale(1.4)';
      if (totale > (_prevAlarmTotale || 0)) {
        // Aumentato: flash rosso sulla campanella
        wrap.querySelector('i').style.color = '#e74c3c';
        setTimeout(() => { wrap.querySelector('i').style.color = 'var(--text-secondary)'; }, 800);
      }
      setTimeout(() => { wrap.style.transform = 'scale(1)'; }, 200);
    }
  }
  _prevAlarmTotale = totale;
}

// Mantiene compatibilità con il vecchio aggiornaAlarmBadge
function aggiornaAlarmBadge() {}

// Toast specifico per nuovo allarme critico
function showAlarmToast(allarme) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const livello = (allarme.livello || 'warning').toLowerCase();
  const colore  = livello === 'alarm' ? '#e74c3c' : '#f39c12';
  const icona   = livello === 'alarm' ? 'fa-exclamation-circle' : 'fa-exclamation-triangle';

  const toast = document.createElement('div');
  toast.className = 'toast toast-error';
  toast.style.cssText = `
    cursor:pointer;
    border-left:4px solid ${colore};
    display:flex;align-items:flex-start;gap:10px;
    padding:12px 16px;max-width:320px;
  `;
  toast.innerHTML = `
    <i class="fa ${icona}" style="color:${colore};font-size:18px;margin-top:2px;flex-shrink:0"></i>
    <div>
      <div style="font-weight:700;font-size:13px;margin-bottom:2px">Nuovo allarme</div>
      <div style="font-size:12px;color:var(--text-secondary)">${allarme.asset_nome || ''}</div>
      <div style="font-size:12px;margin-top:2px">${allarme.descrizione || ''}</div>
    </div>
  `;
  toast.onclick = () => { window.location.href = '/static/alarms.html'; };
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.4s';
    setTimeout(() => toast.remove(), 400);
  }, 6000);
}

/**
 * Inizializza il sistema di notifica allarmi globale.
 * Va chiamato una volta su ogni pagina dopo renderSidebar/renderTopbar.
 * Avvia il polling, aggiorna badge e mostra toast per nuovi allarmi critici.
 */
function initAlarmNotifications() {
  // Inietta la campanella nella topbar se non esiste già
  // (funziona anche se renderTopbar è in versione cache senza campanella)
  if (!document.getElementById('topbar-alarm-wrap')) {
    const topbar = document.getElementById('topbar');
    if (topbar) {
      const logoutBtn = topbar.querySelector('button[onclick*="logout"]');
      const wrap = document.createElement('div');
      wrap.id = 'topbar-alarm-wrap';
      wrap.style.cssText = 'position:relative;margin-right:12px;cursor:pointer;display:flex;align-items:center';
      wrap.title = 'Vai agli allarmi';
      wrap.onclick = () => { window.location.href = '/static/alarms.html'; };
      wrap.innerHTML = `
        <i class="fa fa-bell" style="font-size:16px;color:var(--text-secondary)"></i>
        <span id="topbar-alarm-badge" style="
          display:none;
          position:absolute;top:-6px;right:-8px;
          background:#e74c3c;color:#fff;
          border-radius:10px;padding:1px 5px;font-size:10px;font-weight:700;
          min-width:16px;text-align:center;line-height:16px;
        ">0</span>
      `;
      if (logoutBtn) {
        topbar.insertBefore(wrap, logoutBtn);
      } else {
        topbar.appendChild(wrap);
      }
    }
  }

  API.onAlarmUpdate(({ totale, nuovi }) => {
    // Aggiorna badge sidebar e campanella
    aggiornaAlarmDot(totale);
    // Toast per ogni nuovo allarme (max 3 per non sommergere lo schermo)
    const daNotificare = nuovi.slice(0, 3);
    daNotificare.forEach(a => showAlarmToast(a));
  });
  API.startAlarmPolling(60000);
}

// ── Protezione pagine (redirect se non autenticato) ──────────────────────────
function requireAuth() {
  if (!API.isAuthenticated()) {
    window.location.href = '/static/login.html';
    return false;
  }
  return true;
}

// ── Icone per tipo asset ─────────────────────────────────────────────────────
const TIPO_ICONE = {
  stabilimento: 'fa-industry',
  ufficio:      'fa-building',
  magazzino:    'fa-archive',
  deposito:     'fa-truck'
};

function iconaTipo(tipo) {
  return TIPO_ICONE[tipo] || 'fa-map-marker';
}
