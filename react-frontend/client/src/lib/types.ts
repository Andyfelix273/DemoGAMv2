/**
 * GAM Platform — Domain Types
 * Tutti i tipi del dominio, derivati dagli endpoint del backend FastAPI.
 */

// ── Auth ─────────────────────────────────────────────────────────────
export interface AuthUser {
  sub: string;
  nome: string;
  role: 'admin' | 'editor' | 'viewer';
  permissions: string[];
}

// ── Asset ────────────────────────────────────────────────────────────
export type AssetTipo = 'ufficio' | 'magazzino' | 'retail' | 'industriale' | 'residenziale' | string;
export type AssetStato = 'attivo' | 'inattivo' | 'manutenzione';

export interface Asset {
  id: number;
  codice: string;
  nome: string;
  tipo: AssetTipo;
  stato: AssetStato;
  indirizzo: string;
  citta: string;
  provincia: string;
  cap: string;
  lat: number;
  lng: number;
  superficie_mq: number | null;
  anno_costruzione: number | null;
  piani: number | null;
  note: string | null;
  has_bim: boolean;
  has_planimetria: boolean;
  has_modello_3d: boolean;
  // Efficienza energetica
  energy_class: string | null;
  building_category: string | null;
  annual_energy_budget_eur: number | null;
  // Working hours
  working_hours_start: string | null;
  working_hours_end: string | null;
  working_days: string | null;
  // Timestamps
  created_at: string;
  updated_at: string;
}

export interface AssetGeoJSON {
  type: 'FeatureCollection';
  features: AssetFeature[];
}

export interface AssetFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: Asset & {
    allarmi_attivi: number;
    consumo_oggi_kwh: number | null;
    occupancy_pct: number | null;
  };
}

// ── Zone BEMS ────────────────────────────────────────────────────────
export type ZonaTipo =
  | 'ufficio' | 'sala' | 'sala_riunioni' | 'open_space' | 'laboratorio'
  | 'corridoio' | 'servizi' | 'break' | 'reception' | 'server_room'
  | 'vano_tecnico' | 'archivio' | 'altro';

export interface Zona {
  zone_id: string;
  floor_id: string;
  floor_nome: string | null;
  asset_id: number;
  nome: string;
  tipo: ZonaTipo;
  capacita_persone: number;
  superficie_mq: number | null;
}

// ── Telemetria ───────────────────────────────────────────────────────
export interface TelemetriaZona {
  power_kw: number | null;
  temp_c: number | null;
  humidity: number | null;
  co2_ppm: number | null;
  occupancy: boolean | null;
  occupancy_pct: number | null;
  persone_presenti: number | null;
  ts: string | null;
}

export type TelemetriaMap = Record<string, TelemetriaZona>;

// ── Impianti ─────────────────────────────────────────────────────────
export type ImpiantoTipo = 'elettrico' | 'hvac' | 'illuminazione' | 'contatore_principale' | string;

export interface Impianto {
  plant_id: string;
  floor_id: string | null;
  nome: string;
  tipo: ImpiantoTipo;
  energia_baseline_kw: number;
  asset_id: number;
}

// ── Allarmi ──────────────────────────────────────────────────────────
// Campi reali restituiti da /api/alarms
export type AllarmeGravita = 'alarm' | 'warning' | 'info';

export interface Allarme {
  id: number;
  asset_id: number;
  asset_nome: string;
  asset_tipo: string;
  citta: string;
  campo: string;          // es. 'dipendenti_presenti'
  valore: number | null;
  livello: AllarmeGravita;
  stato: string;          // 'alarm' | 'warning' | 'ack'
  created_at: string;
  ack_at: string | null;
  // Alias derivati per compatibilità UI
  tipo?: string;          // = campo
  messaggio?: string;     // = campo + ' = ' + valore
  acknowledged?: boolean; // = stato === 'ack'
  ts?: string;            // = created_at
}

// ── Work Orders ──────────────────────────────────────────────────────
export type WOStato = 'aperto' | 'in_corso' | 'chiuso' | 'annullato';
export type WOPriorita = 'bassa' | 'media' | 'alta' | 'urgente';

export interface WorkOrder {
  id: number;
  asset_id: number;
  asset_nome?: string;
  titolo: string;
  descrizione: string | null;
  stato: WOStato;
  priorita: WOPriorita;
  assegnato_a: string | null;
  data_apertura: string;
  data_chiusura: string | null;
  created_at: string;
}

// ── Documenti ────────────────────────────────────────────────────────
export type DocumentoCategoria = 'contratto' | 'certificato' | 'planimetria' | 'manuale' | 'fattura' | 'altro';

export interface Documento {
  id: number;
  asset_id: number;
  asset_nome?: string;
  nome: string;
  categoria: DocumentoCategoria;
  dimensione_bytes: number | null;
  mime_type: string | null;
  note: string | null;
  created_at: string;
}

// ── Scadenze ─────────────────────────────────────────────────────────
export type ScadenzaTipo = 'manutenzione' | 'certificazione' | 'contratto' | 'ispezione' | 'altro';
export type ScadenzaStato = 'attiva' | 'scaduta' | 'completata';

export interface Scadenza {
  id: number;
  asset_id: number;
  asset_nome?: string;
  titolo: string;
  tipo: ScadenzaTipo;
  stato: ScadenzaStato;
  data_scadenza: string;
  note: string | null;
  created_at: string;
}

// ── Efficienza energetica ────────────────────────────────────────────
export interface EfficienzaKpi {
  asset_id: number;
  eui_kwh_mq: number | null;
  eui_target: number | null;
  consumo_ytd_kwh: number | null;
  budget_ytd_kwh: number | null;
  risparmio_pct: number | null;
  co2_ton: number | null;
  costo_eur: number | null;
}

// ── Bollette ─────────────────────────────────────────────────────────
export interface Bolletta {
  invoice_id: number;
  asset_id: number;
  fornitore: string | null;
  commodity: string;
  periodo_inizio: string;
  periodo_fine: string;
  importo_eur: number | null;
  kwh: number | null;
  stato: string;
  created_at: string;
}

// ── Stats globali ────────────────────────────────────────────────────
// Struttura reale di /api/stats
export interface GlobalStats {
  totale_asset: number;
  per_tipo: Record<string, number>;
  allarmi: {
    totale_attivi: number;
    livello_alarm: number;
  };
  da_monitorare: Array<{
    id: number;
    nome: string;
    tipo: string;
    citta: string;
    livello_max: string;
  }>;
  aggiornato_il: string;
  // Campi opzionali da altri endpoint
  wo_aperti?: number;
  scadenze_urgenti?: number;
}

// ── Pagination helper ────────────────────────────────────────────────
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}
