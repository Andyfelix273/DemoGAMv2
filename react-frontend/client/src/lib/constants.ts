/**
 * GAM Platform — Application Constants
 * Nessun valore hardcoded nei componenti: tutto qui.
 */

// ── API ──────────────────────────────────────────────────────────────
/** Base URL del backend FastAPI. In produzione è lo stesso host. */
export const API_BASE = '';

/** Intervallo polling live (ms) */
export const LIVE_REFRESH_INTERVAL = 60_000;

/** Intervallo polling allarmi (ms) */
export const ALARM_POLL_INTERVAL = 30_000;

// ── Mappa ────────────────────────────────────────────────────────────
export const JAWG_TOKEN = 'QHoHKE9mfIrm3sUkmrrM1v95NtcsqYNtMOdLeC91Hb1n1mLrqMzLWKzTkHLON1bD';
export const MAP_DEFAULT_CENTER: [number, number] = [41.9028, 12.4964]; // Roma
export const MAP_DEFAULT_ZOOM = 6;

// ── Navigazione sidebar ──────────────────────────────────────────────
export const NAV_ITEMS = [
  {
    id: 'map',
    label: 'Mappa',
    icon: 'MapPin',
    path: '/map',
    module: 'asset-management',
  },
  {
    id: 'assets',
    label: 'Anagrafica',
    icon: 'Building2',
    path: '/assets',
    module: 'asset-management',
  },
  {
    id: 'workorders',
    label: 'Work Order',
    icon: 'Wrench',
    path: '/workorders',
    module: 'asset-management',
  },
  {
    id: 'documents',
    label: 'Documenti',
    icon: 'FileText',
    path: '/documents',
    module: 'asset-management',
  },
  {
    id: 'deadlines',
    label: 'Scadenze',
    icon: 'CalendarClock',
    path: '/deadlines',
    module: 'asset-management',
  },
  {
    id: 'alarms',
    label: 'Allarmi',
    icon: 'Bell',
    path: '/alarms',
    module: 'asset-management',
  },
  { id: 'divider-1', label: '', icon: '', path: '', module: 'divider' },
  {
    id: 'efficiency-map',
    label: 'Efficienza',
    icon: 'Zap',
    path: '/efficiency/map',
    module: 'asset-efficiency',
  },
  {
    id: 'efficiency-assets',
    label: 'Asset KPI',
    icon: 'BarChart3',
    path: '/efficiency/assets',
    module: 'asset-efficiency',
  },
  {
    id: 'energy-summary',
    label: 'Energy Summary',
    icon: 'LineChart',
    path: '/efficiency/energy',
    module: 'asset-efficiency',
  },
  {
    id: 'anomaly',
    label: 'Anomalie',
    icon: 'AlertTriangle',
    path: '/efficiency/anomalies',
    module: 'asset-efficiency',
  },
  { id: 'divider-2', label: '', icon: '', path: '', module: 'divider' },
  {
    id: 'bems-studio',
    label: 'BEMS Studio',
    icon: 'Cpu',
    path: '/bems/studio',
    module: 'bems',
  },
  {
    id: 'bems-floorplan',
    label: 'Floorplan',
    icon: 'LayoutDashboard',
    path: '/bems/floorplan',
    module: 'bems',
  },
] as const;

// ── Lookup labels ────────────────────────────────────────────────────
export const ASSET_STATO_LABEL: Record<string, string> = {
  attivo: 'Attivo',
  inattivo: 'Inattivo',
  manutenzione: 'Manutenzione',
};

export const ASSET_TIPO_LABEL: Record<string, string> = {
  ufficio: 'Ufficio',
  magazzino: 'Magazzino',
  retail: 'Retail',
  industriale: 'Industriale',
  residenziale: 'Residenziale',
};

export const ZONA_TIPO_LABEL: Record<string, string> = {
  ufficio: 'Ufficio',
  sala: 'Sala',
  sala_riunioni: 'Sala Riunioni',
  open_space: 'Open Space',
  laboratorio: 'Laboratorio',
  corridoio: 'Corridoio',
  servizi: 'Servizi',
  break: 'Break',
  reception: 'Reception',
  server_room: 'Server Room',
  vano_tecnico: 'Vano Tecnico',
  archivio: 'Archivio',
  altro: 'Altro',
};

export const ZONA_TIPO_ICON: Record<string, string> = {
  ufficio: 'Briefcase',
  sala: 'Users',
  sala_riunioni: 'Users',
  open_space: 'LayoutGrid',
  laboratorio: 'FlaskConical',
  corridoio: 'ArrowLeftRight',
  servizi: 'Droplets',
  break: 'Coffee',
  reception: 'Info',
  server_room: 'Server',
  vano_tecnico: 'Settings',
  archivio: 'Archive',
  altro: 'LayoutGrid',
};

export const WO_STATO_LABEL: Record<string, string> = {
  aperto: 'Aperto',
  in_corso: 'In corso',
  chiuso: 'Chiuso',
  annullato: 'Annullato',
};

export const WO_PRIORITA_LABEL: Record<string, string> = {
  bassa: 'Bassa',
  media: 'Media',
  alta: 'Alta',
  urgente: 'Urgente',
};

export const SCADENZA_TIPO_LABEL: Record<string, string> = {
  manutenzione: 'Manutenzione',
  certificazione: 'Certificazione',
  contratto: 'Contratto',
  ispezione: 'Ispezione',
  altro: 'Altro',
};

export const DOCUMENTO_CATEGORIA_LABEL: Record<string, string> = {
  contratto: 'Contratto',
  certificato: 'Certificato',
  planimetria: 'Planimetria',
  manuale: 'Manuale',
  fattura: 'Fattura',
  altro: 'Altro',
};

export const ALLARME_GRAVITA_LABEL: Record<string, string> = {
  critico: 'Critico',
  alto: 'Alto',
  medio: 'Medio',
  basso: 'Basso',
};

export const ENERGY_CLASS_COLOR: Record<string, string> = {
  A4: '#1a7f37', A3: '#1a7f37', A2: '#27AE60', A1: '#27AE60',
  A: '#27AE60', B: '#52BE80', C: '#F39C12', D: '#E67E22',
  E: '#E74C3C', F: '#C0392B', G: '#922B21',
};

// ── Colori semantici (usati nei grafici e badge) ─────────────────────
export const COLOR_SUCCESS = '#27AE60';
export const COLOR_WARNING = '#F39C12';
export const COLOR_DANGER  = '#E74C3C';
export const COLOR_INFO    = '#F1C40F';
export const COLOR_ACCENT  = '#00A3E0';
export const COLOR_MUTED   = '#7BAFC4';

// ── Soglie occupancy ─────────────────────────────────────────────────
export const OCC_HIGH_THRESHOLD = 80;   // % — rosso
export const OCC_MED_THRESHOLD  = 50;   // % — arancio

// ── Soglie IAQ ───────────────────────────────────────────────────────
export const CO2_CRITICAL_PPM = 1000;
export const CO2_WARNING_PPM  = 800;
export const TEMP_MIN_C = 19;
export const TEMP_MAX_C = 26;
