/**
 * GAM Platform — API Client
 * Wrapper tipizzato attorno al backend FastAPI.
 * Gestisce auth JWT, refresh token, errori HTTP.
 */

import { API_BASE } from './constants';
import type {
  Asset, AssetGeoJSON, Allarme, WorkOrder, Documento, Scadenza,
  GlobalStats, Zona, TelemetriaMap, Impianto, Bolletta, EfficienzaKpi,
} from './types';

// ── Token storage ────────────────────────────────────────────────────
const TOKEN_KEY = 'gam_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  const token = getToken();
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export function getAuthPayload(): { sub: string; role: string; nome: string; permissions: string[] } | null {
  const token = getToken();
  if (!token) return null;
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

// ── Core request ─────────────────────────────────────────────────────
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<T = unknown>(
  method: Method,
  path: string,
  body?: unknown,
  isFormData = false,
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (body && !isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body
      ? isFormData
        ? (body as FormData)
        : JSON.stringify(body)
      : undefined,
  });

  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new Error('Non autenticato');
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      msg = err.detail || err.message || msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

// ── Auth ─────────────────────────────────────────────────────────────
export const auth = {
  login: async (username: string, password: string) => {
    // Il backend usa OAuth2PasswordRequestForm → form-encoded, non JSON
    const body = new URLSearchParams({ username, password });
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).detail || `HTTP ${res.status}`);
    }
    return res.json() as Promise<{ access_token: string; token_type: string; role: string; nome_completo: string }>;
  },

  logout: () => {
    clearToken();
    window.location.href = '/login';
  },

  me: () => request<{ sub: string; nome: string; role: string; permissions: string[] }>('GET', '/auth/me'),
};

// ── Assets ───────────────────────────────────────────────────────────
export const assets = {
  list: (params?: Record<string, string | number | boolean>) => {
    const q = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<Asset[]>('GET', `/api/assets${q}`);
  },
  geojson: () => request<AssetGeoJSON>('GET', '/api/assets?format=geojson'),
  get: (id: number) => request<Asset>('GET', `/api/assets/${id}`),
  create: (data: Partial<Asset>) => request<Asset>('POST', '/api/assets', data),
  update: (id: number, data: Partial<Asset>) => request<Asset>('PUT', `/api/assets/${id}`, data),
  delete: (id: number) => request<void>('DELETE', `/api/assets/${id}`),
  importExcel: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ importati: number; errori: number }>('POST', '/api/assets/import', fd, true);
  },
  referenti: {
    list: (assetId: number) => request<unknown[]>('GET', `/api/assets/${assetId}/referenti`),
    create: (assetId: number, data: unknown) => request<unknown>('POST', `/api/assets/${assetId}/referenti`, data),
    delete: (assetId: number, refId: number) => request<void>('DELETE', `/api/assets/${assetId}/referenti/${refId}`),
  },
};

// ── Stats ────────────────────────────────────────────────────────────
export const stats = {
  global: () => request<GlobalStats>('GET', '/api/stats'),
  esg: () => request<unknown>('GET', '/api/stats/esg'),
  operational: () => request<unknown>('GET', '/api/stats/operational'),
};

// ── Allarmi ──────────────────────────────────────────────────────────
export const alarms = {
  list: () => request<Allarme[]>('GET', '/api/alarms'),
  byAsset: (assetId: number) => request<Allarme[]>('GET', `/api/assets/${assetId}/alarms`),
  ack: (id: number) => request<void>('POST', `/api/alarms/${id}/ack`),
};

// ── Work Orders ──────────────────────────────────────────────────────
export const workOrders = {
  list: (params?: Record<string, string | number>) => {
    const q = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<WorkOrder[]>('GET', `/api/work-orders${q}`);
  },
  stats: () => request<unknown>('GET', '/api/work-orders/stats'),
  get: (id: number) => request<WorkOrder>('GET', `/api/work-orders/${id}`),
  create: (data: Partial<WorkOrder>) => request<WorkOrder>('POST', '/api/work-orders', data),
  update: (id: number, data: Partial<WorkOrder>) => request<WorkOrder>('PUT', `/api/work-orders/${id}`, data),
  delete: (id: number) => request<void>('DELETE', `/api/work-orders/${id}`),
  byAsset: (assetId: number) => request<WorkOrder[]>('GET', `/api/assets/${assetId}/work-orders`),
};

// ── Documenti ────────────────────────────────────────────────────────
export const documents = {
  list: (params?: Record<string, string | number>) => {
    const q = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<Documento[]>('GET', `/api/documents${q}`);
  },
  stats: () => request<unknown>('GET', '/api/documents/stats'),
  byAsset: (assetId: number) => request<Documento[]>('GET', `/api/assets/${assetId}/documents`),
  upload: (assetId: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<Documento>('POST', `/api/assets/${assetId}/documents`, fd, true);
  },
  delete: (docId: number) => request<void>('DELETE', `/api/documents/${docId}`),
  downloadUrl: (docId: number) => {
    const token = getToken();
    return `${API_BASE}/api/documents/${docId}/download?token=${token}`;
  },
};

// ── Scadenze ─────────────────────────────────────────────────────────
export const deadlines = {
  list: (params?: Record<string, string | number>) => {
    const q = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<Scadenza[]>('GET', `/api/deadlines${q}`);
  },
  stats: () => request<unknown>('GET', '/api/deadlines/stats'),
  get: (id: number) => request<Scadenza>('GET', `/api/deadlines/${id}`),
  create: (data: Partial<Scadenza>) => request<Scadenza>('POST', '/api/deadlines', data),
  update: (id: number, data: Partial<Scadenza>) => request<Scadenza>('PUT', `/api/deadlines/${id}`, data),
  delete: (id: number) => request<void>('DELETE', `/api/deadlines/${id}`),
  byAsset: (assetId: number) => request<Scadenza[]>('GET', `/api/assets/${assetId}/deadlines`),
};

// ── BEMS ─────────────────────────────────────────────────────────────
export const bems = {
  floors: (assetId: number) => request<Array<{id: number; floor_id: string; nome: string; level: number; superficie_mq: number | null; svg_file: string | null}>>('GET', `/api/bems/buildings/${assetId}/floors`),
  zones: (assetId: number) => request<Zona[]>('GET', `/api/bems/buildings/${assetId}/zones`),
  plants: (assetId: number) => request<Impianto[]>('GET', `/api/bems/buildings/${assetId}/plants`),
  telemetryLatest: (assetId: number) => request<TelemetriaMap>('GET', `/api/bems/buildings/${assetId}/telemetry/latest`),
  // Alias per compatibilità modale
  impianti: (assetId: number) => request<Impianto[]>('GET', `/api/bems/buildings/${assetId}/plants`),
  zone: (assetId: number) => request<Zona[]>('GET', `/api/bems/buildings/${assetId}/zones`),
  telemetriaLatest: (assetId: number) => request<TelemetriaMap>('GET', `/api/bems/buildings/${assetId}/telemetry/latest`),
  consumiTimeseries: (assetId: number, ore = 168) => request<{timestamp: string; power_kw: number}[]>('GET', `/api/bems/buildings/${assetId}/telemetry/history?ore=${ore}`),
  consumiVsOccupancy: (assetId: number, ore = 168) => request<{timestamp: string; power_kw: number; occupancy_pct: number}[]>('GET', `/api/efficiency/${assetId}/occupancy?giorni=${Math.ceil(ore/24)}`),
  consumiPerImpianto: (assetId: number, ore = 168) => request<{nome: string; kwh_totale: number}[]>('GET', `/api/efficiency/${assetId}/breakdown?giorni=${Math.ceil(ore/24)}`),
  tariffe: (assetId: number) => request<unknown[]>('GET', `/api/bems/buildings/${assetId}/suppliers`),
  telemetryHistory: (assetId: number, params: { zone_id?: string; plant_id?: string; ore?: number }) => {
    const q = '?' + new URLSearchParams(params as Record<string, string>).toString();
    return request<unknown[]>('GET', `/api/bems/buildings/${assetId}/telemetry/history${q}`);
  },
  invoices: (assetId: number) => request<Bolletta[]>('GET', `/api/bems/buildings/${assetId}/invoices`),
  invoiceUpload: (assetId: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<unknown>('POST', `/api/bems/buildings/${assetId}/invoices/upload`, fd, true);
  },
  suppliers: (assetId: number) => request<unknown[]>('GET', `/api/bems/buildings/${assetId}/suppliers`),
  supplyPoints: (assetId: number) => request<unknown[]>('GET', `/api/bems/buildings/${assetId}/supply-points`),
  energyCosts: (assetId: number) => request<unknown>('GET', `/api/bems/buildings/${assetId}/energy-costs`),
  // Studio
  studioSessions: () => request<unknown[]>('GET', '/api/bems/studio/sessions'),
  sensorCatalog: () => request<unknown[]>('GET', '/api/bems/studio/sensor-catalog'),
};

// ── Efficienza ───────────────────────────────────────────────────────
export const efficiency = {
  kpi: (assetId: number) => request<EfficienzaKpi>('GET', `/api/efficiency/${assetId}/kpi`),
  trend: (assetId: number) => request<unknown>('GET', `/api/efficiency/${assetId}/trend`),
  breakdown: (assetId: number) => request<unknown>('GET', `/api/efficiency/${assetId}/breakdown`),
  baseline: (assetId: number) => request<unknown>('GET', `/api/efficiency/${assetId}/baseline`),
  commodity: (assetId: number) => request<unknown>('GET', `/api/efficiency/${assetId}/commodity`),
  heatmap7d: (assetId: number) => request<unknown>('GET', `/api/efficiency/${assetId}/heatmap7d`),
  profile24h: (assetId: number) => request<unknown>('GET', `/api/efficiency/${assetId}/profile24h`),
  hvacVsTemp: (assetId: number) => request<unknown>('GET', `/api/efficiency/${assetId}/hvac_vs_temp`),
  occupancy: (assetId: number) => request<unknown>('GET', `/api/efficiency/${assetId}/occupancy`),
  // Portfolio
  portfolioSummary: () => request<unknown>('GET', '/api/efficiency/portfolio/summary'),
  portfolioBudget: () => request<unknown>('GET', '/api/efficiency/portfolio/budget'),
  portfolioWeekday: () => request<unknown>('GET', '/api/efficiency/portfolio/weekday'),
  portfolioCommodity: () => request<unknown>('GET', '/api/efficiency/portfolio/commodity'),
  portfolioTrendYoy: () => request<unknown>('GET', '/api/efficiency/portfolio/trend_yoy'),
};

// ── Occupancy ────────────────────────────────────────────────────────
export const occupancy = {
  summary: (assetId: number, params?: { giorni?: number }) => {
    const q = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<unknown>('GET', `/api/occupancy/${assetId}/summary${q}`);
  },
  heatmap: (assetId: number, params?: { giorni?: number }) => {
    const q = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<unknown>('GET', `/api/occupancy/${assetId}/heatmap${q}`);
  },
  dailyProfile: (assetId: number, params?: { giorni?: number }) => {
    const q = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<unknown>('GET', `/api/occupancy/${assetId}/daily_profile${q}`);
  },
  weeklyPattern: (assetId: number, params?: { giorni?: number }) => {
    const q = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<unknown>('GET', `/api/occupancy/${assetId}/weekly_pattern${q}`);
  },
  ovi: (assetId: number, params?: { mesi?: number }) => {
    const q = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<unknown>('GET', `/api/occupancy/${assetId}/ovi${q}`);
  },
  iaqSummary: (assetId: number, params?: { giorni?: number }) => {
    const q = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<unknown>('GET', `/api/occupancy/${assetId}/iaq_summary${q}`);
  },
  iaqTrend: (assetId: number, params?: { giorni?: number }) => {
    const q = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<unknown>('GET', `/api/occupancy/${assetId}/iaq_trend${q}`);
  },
  hourly: (assetId: number) => request<unknown>('GET', `/api/occupancy/${assetId}/hourly`),
  globalSummary: () => request<unknown[]>('GET', '/api/occupancy/summary'),
  portfolioSummary: () => request<unknown>('GET', '/api/occupancy/portfolio/summary'),
  portfolioIaqSummary: () => request<unknown>('GET', '/api/occupancy/portfolio/iaq_summary'),
  portfolioWeeklyPattern: () => request<unknown>('GET', '/api/occupancy/portfolio/weekly_pattern_v2'),
  portfolioScatterEui: () => request<unknown>('GET', '/api/occupancy/portfolio/scatter_eui'),
};

// ── Energia ──────────────────────────────────────────────────────────
export const energy = {
  summary: (params?: Record<string, string | number>) => {
    const q = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<unknown>('GET', `/api/energy/summary${q}`);
  },
  heatmap: (params?: Record<string, string | number>) => {
    const q = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<unknown>('GET', `/api/energy/heatmap${q}`);
  },
  anomalies: (params?: Record<string, string | number>) => {
    const q = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<unknown>('GET', `/api/energy/anomalies${q}`);
  },
  readings: (assetId: number) => request<unknown>('GET', `/api/energy/readings/${assetId}`),
};

// ── Config / Soglie ──────────────────────────────────────────────────
export const config = {
  get: () => request<unknown>('GET', '/api/config'),
  update: (data: unknown) => request<unknown>('PUT', '/api/config', data),
  thresholds: {
    get: () => request<unknown>('GET', '/api/thresholds'),
    update: (data: unknown) => request<unknown>('PUT', '/api/thresholds', data),
  },
};

// ── Export ───────────────────────────────────────────────────────────
export const exports = {
  assetsExcel: () => `${API_BASE}/api/export/assets/excel?token=${getToken()}`,
  deadlinesExcel: () => `${API_BASE}/api/export/deadlines/excel?token=${getToken()}`,
  documentsExcel: () => `${API_BASE}/api/export/documents/excel?token=${getToken()}`,
  workordersExcel: () => `${API_BASE}/api/export/workorders/excel?token=${getToken()}`,
  reportPdf: () => `${API_BASE}/api/export/report/pdf?token=${getToken()}`,
};

// ── BIM ──────────────────────────────────────────────────────────────
export const bim = {
  config: (assetId: number) => request<unknown>('GET', `/api/bim/${assetId}`),
  uploadSvg: (assetId: number, floorId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<unknown>('POST', `/api/bim/${assetId}/floors/${floorId}/upload-svg`, fd, true);
  },
};

// ── Generic shortcut (per endpoint non mappati) ──────────────────────
export const api = {
  get: <T = unknown>(path: string) => request<T>('GET', path),
  post: <T = unknown>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T = unknown>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T = unknown>(path: string) => request<T>('DELETE', path),
};
