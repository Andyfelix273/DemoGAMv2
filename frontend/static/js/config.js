/**
 * config.js — Configurazione centralizzata del GIS Asset Manager
 *
 * Questo file contiene tutte le costanti di configurazione che in precedenza
 * erano hardcoded nei moduli JS. Modificare questo file per personalizzare
 * il comportamento dell'applicazione senza toccare la logica applicativa.
 *
 * @module config
 *
 * @example
 * // Accesso alla configurazione:
 * const token = GAM_CONFIG.JAWG_TOKEN;
 */

/**
 * Configurazione globale dell'applicazione GIS Asset Manager.
 *
 * @constant {Object} GAM_CONFIG
 * @property {string}   JAWG_TOKEN            Token di accesso per i tile layer Jawg Maps
 * @property {number}   LIVE_REFRESH_INTERVAL Intervallo di polling live in millisecondi (default: 60000 ms)
 *
 * NOTA: BIM_ASSET_IDS e IFC_ASSET_ID sono stati rimossi.
 * La disponibilità di BIM/Planimetria/Modello 3D è ora gestita dal DB
 * tramite le colonne has_bim, has_planimetria, has_modello_3d in assets
 * e l'endpoint GET /api/bim/{asset_id}/config.
 */
const GAM_CONFIG = {
  /**
   * Token Jawg Maps per i tile layer della mappa Leaflet.
   * Ottenibile su https://www.jawg.io/
   */
  JAWG_TOKEN: 'QHoHKE9mfIrm3sUkmrrM1v95NtcsqYNtMOdLeC91Hb1n1mLrqMzLWKzTkHLON1bD',

  /**
   * Intervallo di aggiornamento live in millisecondi.
   * Usato dal polling _aggiornaLive() per aggiornare panoramica e dettaglio asset.
   */
  LIVE_REFRESH_INTERVAL: 60000,
};
