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
 * const bimIds = GAM_CONFIG.BIM_ASSET_IDS;
 */

/**
 * Configurazione globale dell'applicazione GIS Asset Manager.
 *
 * @constant {Object} GAM_CONFIG
 * @property {string}   JAWG_TOKEN            Token di accesso per i tile layer Jawg Maps
 * @property {number[]} BIM_ASSET_IDS         Array di asset_id con tab Planimetria/BIM abilitata nella modale
 * @property {number}   IFC_ASSET_ID          asset_id con planimetrie IFC reali (Sede Centrale Roma)
 * @property {number}   LIVE_REFRESH_INTERVAL Intervallo di polling live in millisecondi (default: 60000 ms)
 */
const GAM_CONFIG = {
  /**
   * Token Jawg Maps per i tile layer della mappa Leaflet.
   * Ottenibile su https://www.jawg.io/
   */
  JAWG_TOKEN: 'QHoHKE9mfIrm3sUkmrrM1v95NtcsqYNtMOdLeC91Hb1n1mLrqMzLWKzTkHLON1bD',

  /**
   * Asset ID con tab Planimetria e BIM abilitata nella modale dettaglio.
   * - 1, 2, 7: planimetrie schematiche (non IFC reale)
   * - 6: Sede Centrale Roma → planimetrie estratte da file IFC4 reale (ArchiCAD)
   */
  BIM_ASSET_IDS: [1, 2, 6, 7],

  /**
   * Asset ID con planimetrie IFC reali (estratte da AC20-Institute-Var-2.ifc).
   * Solo questo asset mostra le piante SVG generate da ifcopenshell.
   * Corrisponde alla Sede Centrale Roma.
   */
  IFC_ASSET_ID: 6,

  /**
   * Intervallo di aggiornamento live in millisecondi.
   * Usato dal polling _aggiornaLive() per aggiornare panoramica e dettaglio asset.
   */
  LIVE_REFRESH_INTERVAL: 60000,
};
