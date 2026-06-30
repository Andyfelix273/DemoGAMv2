/**
 * GIS Asset Manager - Internazionalizzazione (i18n)
 * Versione: 2.0 | Autore: Felix / KeyBiz
 *
 * Dizionario IT/EN. Utilizzo: i18n.t('chiave')
 * La lingua attiva viene letta da localStorage (gam_lingua).
 */

const i18n = (() => {

  const dict = {
    it: {
      // Navigazione
      'nav.mappa':           'Mappa',
      'nav.anagrafica':      'Anagrafica',
      'nav.allarmi':         'Allarmi',
      'nav.impostazioni':    'Impostazioni',
      'nav.logout':          'Esci',
      'nav.dashboard':       'Dashboard',

      // Login
      'login.titolo':        'Accedi alla piattaforma',
      'login.utente':        'Utente',
      'login.password':      'Password',
      'login.accedi':        'Accedi',
      'login.errore':        'Credenziali non valide',
      'login.caricamento':   'Accesso in corso...',
      'login.hint':          'Demo: admin / demo2026',

      // Dashboard
      'dashboard.benvenuto': 'Benvenuto',
      'dashboard.scegli':    'Seleziona il modulo da avviare',
      'dashboard.presto':    'Prossimamente',

      // Mappa
      'mappa.panoramica':       'Panoramica operativa',
      'mappa.aggiornato':       'Aggiornato alle',
      'mappa.totale':           'asset totali',
      'mappa.da_monitorare':    'Situazioni da monitorare',
      'mappa.torna':            '← Panoramica',
      'mappa.caricamento':      'Caricamento asset in corso...',
      'mappa.filtro_tutti':     'Tutti',
      'mappa.cerca':            'Cerca asset...',
      'mappa.nessun_risultato': 'Nessun risultato',
      'mappa.nessuna_critica':  'Nessuna situazione critica rilevata.',
      'mappa.allarmi_attivi':   'allarmi attivi',
      'mappa.critici':          'critici',
      'mappa.gestisci':         'Gestisci',
      'mappa.errore_panoramica':'Errore nel caricamento della panoramica.',
      'mappa.errore_dettaglio': 'Errore nel caricamento del dettaglio.',
      'mappa.quadro_sinottico': 'Quadro sinottico',
      'mappa.dettaglio_asset':  'Dettaglio asset',
      'mappa.tipologia':        'Tipologia asset',
      'mappa.legenda_caric':    'Caricamento...',
      'mappa.sim_note':         'Dati di monitoraggio simulati a scopo dimostrativo.',
      'mappa.dati_simulati':    'Dati simulati',
      // Mappa - sezioni dettaglio
      'det.anagrafica':         'Anagrafica',
      'det.georef':             'Georeferenziazione',
      'det.monitoraggio':       'Monitoraggio operativo',
      'det.allarmi_attivi':     'Allarmi attivi',
      'det.citta':              'Città',
      'det.provincia':          'Provincia',
      'det.indirizzo':          'Indirizzo',
      'det.referente':          'Referente',
      'det.telefono':           'Telefono',
      'det.superficie':         'Superficie',
      'det.anno':               'Anno',
      'det.latitudine':         'Latitudine',
      'det.longitudine':        'Longitudine',
      // Mappa - KPI ufficio
      'kpi.dip_presenti':       'Dipendenti presenti',
      'kpi.capienza':           'Capienza massima',
      'kpi.sale_riunioni':      'Sale riunioni occupate',
      'kpi.occupancy':          'Occupancy',
      // Mappa - KPI stabilimento
      'kpi.personale':          'Personale attivo',
      'kpi.linee_attive':       'Linee produzione attive',
      'kpi.media_pezzi':        'Media pezzi/giorno',
      'kpi.operatori_turno':    'Operatori turno attuale',
      // Mappa - KPI magazzino
      'kpi.saturazione':        'Saturazione stoccaggio',
      'kpi.operatori':          'Operatori presenti',
      'kpi.mezzi_op':           'Mezzi operativi',
      'kpi.spedizioni':         'Spedizioni/giorno',
      // Mappa - KPI deposito
      'kpi.mezzi_disp':         'Mezzi disponibili',
      'kpi.mezzi_manut':        'Mezzi in manutenzione',
      'kpi.autisti':            'Autisti presenti',
      'kpi.missioni':           'Missioni in corso',
      // Filtri tipo
      'tipo.tutti':             'Tutti',
      'tipo.stabilimenti':      'Stabilimenti',
      'tipo.uffici':            'Uffici',
      'tipo.magazzini':         'Magazzini',
      'tipo.depositi':          'Depositi',

      // Anagrafica
      'ana.titolo':          'Anagrafica asset',
      'ana.nuovo':           'Nuovo asset',
      'ana.importa':         'Importa Excel',
      'ana.cerca':           'Cerca...',
      'ana.codice':          'Codice',
      'ana.nome':            'Nome',
      'ana.tipo':            'Tipo',
      'ana.citta':           'Città',
      'ana.stato':           'Stato',
      'ana.azioni':          'Azioni',
      'ana.modifica':        'Modifica',
      'ana.elimina':         'Elimina',
      'ana.conferma_elimina':'Confermi l\'eliminazione dell\'asset?',
      'ana.salva':           'Salva',
      'ana.annulla':         'Annulla',
      'ana.nuovo_titolo':    'Nuovo asset',
      'ana.modifica_titolo': 'Modifica asset',
      'ana.import_ok':       'Importazione completata',
      'ana.nessun_asset':    'Nessun asset trovato',

      // Campi asset
      'campo.codice':        'Codice',
      'campo.nome':          'Nome',
      'campo.tipo':          'Tipo',
      'campo.indirizzo':     'Indirizzo',
      'campo.citta':         'Città',
      'campo.provincia':     'Provincia',
      'campo.cap':           'CAP',
      'campo.lat':           'Latitudine',
      'campo.lon':           'Longitudine',
      'campo.referente':     'Referente',
      'campo.telefono':      'Telefono',
      'campo.email':         'Email',
      'campo.superficie':    'Superficie (mq)',
      'campo.anno':          'Anno costruzione',
      'campo.stato':         'Stato',
      'campo.note':          'Note',

      // Tipi asset
      'tipo.stabilimento':   'Stabilimento',
      'tipo.ufficio':        'Ufficio',
      'tipo.magazzino':      'Magazzino',
      'tipo.deposito':       'Deposito mezzi',

      // Stato asset
      'stato.attivo':        'Attivo',
      'stato.manutenzione':  'In manutenzione',
      'stato.inattivo':      'Inattivo',

      // Monitoraggio
      'mon.titolo':          'Monitoraggio operativo',
      'mon.dipendenti':      'Dipendenti presenti',
      'mon.capienza':        'Capienza massima',
      'mon.sale_riunioni':   'Sale riunioni occupate',
      'mon.linee_attive':    'Linee produzione attive',
      'mon.linee_totali':    'Linee totali',
      'mon.media_pezzi':     'Media pezzi/giorno',
      'mon.operatori':       'Operatori presenti',
      'mon.mezzi_mag':       'Mezzi operativi',
      'mon.saturazione':     'Saturazione stoccaggio',
      'mon.mezzi_disp':      'Mezzi disponibili',
      'mon.mezzi_missione':  'In missione',
      'mon.mezzi_manut':     'In manutenzione',
      'mon.mezzi_totali':    'Mezzi totali',

      // Allarmi
      'all.titolo':          'Gestione allarmi',
      'all.soglie':          'Soglie',
      'all.attivi':          'Allarmi attivi',
      'all.storico':         'Storico',
      'all.asset':           'Asset',
      'all.campo':           'Campo',
      'all.valore':          'Valore',
      'all.livello':         'Livello',
      'all.data':            'Data/Ora',
      'all.azione':          'Azione',
      'all.conferma':        'Conferma',
      'all.nessuno':         'Nessun allarme attivo',
      'all.warning':         'Warning',
      'all.alarm':           'Allarme',
      'all.soglia_warning':  'Soglia warning',
      'all.soglia_alarm':    'Soglia allarme',
      'all.salva_soglie':    'Salva soglie',
      'all.ack_ok':           'Allarme confermato',
      'all.nessuno_storico':  'Nessun allarme nello storico',
      'all.rilevato':         'Rilevato',
      'all.confermato':       'Confermato',
      'all.nessuna_soglia':   'Nessuna soglia configurata',
      'all.errore_soglia':    'Errore soglia',
      'all.soglie_salvate':   'Soglie salvate',

      // Impostazioni
      'imp.titolo':          'Impostazioni',
      'imp.tema':            'Tema interfaccia',
      'imp.tema_dark':       'Scuro',
      'imp.tema_light':      'Chiaro',
      'imp.lingua':          'Lingua',
      'imp.rotte':           'Rotte marittime',
      'imp.rotte_on':        'Visibili',
      'imp.rotte_off':       'Nascoste',
      'imp.salva':           'Salva impostazioni',
      'imp.salvato':         'Impostazioni salvate',
      'imp.profilo':         'Profilo utente',
      'imp.ruolo':           'Ruolo',
      'imp.ruolo_admin':     'Amministratore',
      'imp.ruolo_user':      'Utente',

      // ESG
      'esg.titolo':              'Dati ESG',
      'esg.energia':             'Energia',
      'esg.acqua':               'Acqua',
      'esg.co2':                 'CO₂ totale',
      'esg.scope1':              'Scope 1',
      'esg.scope2':              'Scope 2',
      'esg.rating':              'Rating ESG',
      'esg.benchmark_kwh':       'Benchmark kWh',
      'esg.benchmark_m3':        'Benchmark m³',
      'esg.unita_kwh':           'kWh/g',
      'esg.unita_m3':            'm³/g',
      'esg.unita_co2':           'kg/g',
      'esg.flotta_co2':          'CO₂ totale asset',
      'esg.flotta_kwh':          'Energia media asset',
      'esg.flotta_rating':       'Rating medio',
      'esg.unita_tannno':        't/anno',
      'esg.unita_kwh_asset':     'kWh/asset/g',

      // Meteo
      'meteo.titolo':            'Meteo live',
      'meteo.temperatura':       'Temperatura',
      'meteo.vento':             'Vento',
      'meteo.umidita':           'Umidità',
      'meteo.precipitazioni':    'Precipitazioni',
      'meteo.caricamento':       'Caricamento meteo...',
      'meteo.errore':            'Dati meteo non disponibili',
      'meteo.kmh':               'km/h',
      'meteo.mm':                'mm',

      // Generici
      'gen.caricamento':     'Caricamento...',
      'gen.errore':          'Si è verificato un errore',
      'gen.conferma':        'Conferma',
      'gen.annulla':         'Annulla',
      'gen.salva':           'Salva',
      'gen.chiudi':          'Chiudi',
      'gen.si':              'Sì',
      'gen.no':              'No',
      'gen.solo_admin':      'Funzione riservata agli amministratori',
    },

    en: {
      // Navigation
      'nav.mappa':           'Map',
      'nav.anagrafica':      'Assets',
      'nav.allarmi':         'Alarms',
      'nav.impostazioni':    'Settings',
      'nav.logout':          'Logout',
      'nav.dashboard':       'Dashboard',

      // Login
      'login.titolo':        'Sign in to the platform',
      'login.utente':        'Username',
      'login.password':      'Password',
      'login.accedi':        'Sign in',
      'login.errore':        'Invalid credentials',
      'login.caricamento':   'Signing in...',
      'login.hint':          'Demo: admin / demo2026',

      // Dashboard
      'dashboard.benvenuto': 'Welcome',
      'dashboard.scegli':    'Select a module to launch',
      'dashboard.presto':    'Coming soon',

      // Map
      'mappa.panoramica':       'Operational overview',
      'mappa.aggiornato':       'Updated at',
      'mappa.totale':           'total assets',
      'mappa.da_monitorare':    'Situations to monitor',
      'mappa.torna':            '← Overview',
      'mappa.caricamento':      'Loading assets...',
      'mappa.filtro_tutti':     'All',
      'mappa.cerca':            'Search asset...',
      'mappa.nessun_risultato': 'No results',
      'mappa.nessuna_critica':  'No critical situations detected.',
      'mappa.allarmi_attivi':   'active alarms',
      'mappa.critici':          'critical',
      'mappa.gestisci':         'Manage',
      'mappa.errore_panoramica':'Error loading overview.',
      'mappa.errore_dettaglio': 'Error loading asset detail.',
      'mappa.quadro_sinottico': 'Operational panel',
      'mappa.dettaglio_asset':  'Asset detail',
      'mappa.tipologia':        'Asset type',
      'mappa.legenda_caric':    'Loading...',
      'mappa.sim_note':         'Monitoring data simulated for demo purposes.',
      'mappa.dati_simulati':    'Simulated data',
      // Map - detail sections
      'det.anagrafica':         'Registry',
      'det.georef':             'Geolocation',
      'det.monitoraggio':       'Operational monitoring',
      'det.allarmi_attivi':     'Active alarms',
      'det.citta':              'City',
      'det.provincia':          'Province',
      'det.indirizzo':          'Address',
      'det.referente':          'Contact',
      'det.telefono':           'Phone',
      'det.superficie':         'Area (sqm)',
      'det.anno':               'Year',
      'det.latitudine':         'Latitude',
      'det.longitudine':        'Longitude',
      // Map - KPI office
      'kpi.dip_presenti':       'Employees present',
      'kpi.capienza':           'Max capacity',
      'kpi.sale_riunioni':      'Meeting rooms in use',
      'kpi.occupancy':          'Occupancy',
      // Map - KPI plant
      'kpi.personale':          'Active staff',
      'kpi.linee_attive':       'Active production lines',
      'kpi.media_pezzi':        'Avg units/day',
      'kpi.operatori_turno':    'Operators on shift',
      // Map - KPI warehouse
      'kpi.saturazione':        'Storage saturation',
      'kpi.operatori':          'Operators present',
      'kpi.mezzi_op':           'Operational vehicles',
      'kpi.spedizioni':         'Shipments/day',
      // Map - KPI depot
      'kpi.mezzi_disp':         'Available vehicles',
      'kpi.mezzi_manut':        'Vehicles under maintenance',
      'kpi.autisti':            'Drivers present',
      'kpi.missioni':           'Missions in progress',
      // Type filters
      'tipo.tutti':             'All',
      'tipo.stabilimenti':      'Plants',
      'tipo.uffici':            'Offices',
      'tipo.magazzini':         'Warehouses',
      'tipo.depositi':          'Depots',

      // Assets
      'ana.titolo':          'Asset registry',
      'ana.nuovo':           'New asset',
      'ana.importa':         'Import Excel',
      'ana.cerca':           'Search...',
      'ana.codice':          'Code',
      'ana.nome':            'Name',
      'ana.tipo':            'Type',
      'ana.citta':           'City',
      'ana.stato':           'Status',
      'ana.azioni':          'Actions',
      'ana.modifica':        'Edit',
      'ana.elimina':         'Delete',
      'ana.conferma_elimina':'Confirm asset deletion?',
      'ana.salva':           'Save',
      'ana.annulla':         'Cancel',
      'ana.nuovo_titolo':    'New asset',
      'ana.modifica_titolo': 'Edit asset',
      'ana.import_ok':       'Import completed',
      'ana.nessun_asset':    'No assets found',

      // Asset fields
      'campo.codice':        'Code',
      'campo.nome':          'Name',
      'campo.tipo':          'Type',
      'campo.indirizzo':     'Address',
      'campo.citta':         'City',
      'campo.provincia':     'Province',
      'campo.cap':           'ZIP',
      'campo.lat':           'Latitude',
      'campo.lon':           'Longitude',
      'campo.referente':     'Contact',
      'campo.telefono':      'Phone',
      'campo.email':         'Email',
      'campo.superficie':    'Area (sqm)',
      'campo.anno':          'Year built',
      'campo.stato':         'Status',
      'campo.note':          'Notes',

      // Asset types
      'tipo.stabilimento':   'Plant',
      'tipo.ufficio':        'Office',
      'tipo.magazzino':      'Warehouse',
      'tipo.deposito':       'Vehicle depot',

      // Asset status
      'stato.attivo':        'Active',
      'stato.manutenzione':  'Under maintenance',
      'stato.inattivo':      'Inactive',

      // Monitoring
      'mon.titolo':          'Operational monitoring',
      'mon.dipendenti':      'Employees present',
      'mon.capienza':        'Max capacity',
      'mon.sale_riunioni':   'Meeting rooms in use',
      'mon.linee_attive':    'Active production lines',
      'mon.linee_totali':    'Total lines',
      'mon.media_pezzi':     'Avg units/day',
      'mon.operatori':       'Operators present',
      'mon.mezzi_mag':       'Operational vehicles',
      'mon.saturazione':     'Storage saturation',
      'mon.mezzi_disp':      'Available vehicles',
      'mon.mezzi_missione':  'On mission',
      'mon.mezzi_manut':     'Under maintenance',
      'mon.mezzi_totali':    'Total vehicles',

      // Alarms
      'all.titolo':          'Alarm management',
      'all.soglie':          'Thresholds',
      'all.attivi':          'Active alarms',
      'all.storico':         'History',
      'all.asset':           'Asset',
      'all.campo':           'Field',
      'all.valore':          'Value',
      'all.livello':         'Level',
      'all.data':            'Date/Time',
      'all.azione':          'Action',
      'all.conferma':        'Acknowledge',
      'all.nessuno':         'No active alarms',
      'all.warning':         'Warning',
      'all.alarm':           'Alarm',
      'all.soglia_warning':  'Warning threshold',
      'all.soglia_alarm':    'Alarm threshold',
      'all.salva_soglie':    'Save thresholds',
      'all.ack_ok':           'Alarm acknowledged',
      'all.nessuno_storico':  'No alarms in history',
      'all.rilevato':         'Detected',
      'all.confermato':       'Acknowledged',
      'all.nessuna_soglia':   'No thresholds configured',
      'all.errore_soglia':    'Threshold error',
      'all.soglie_salvate':   'Thresholds saved',

      // Settings
      'imp.titolo':          'Settings',
      'imp.tema':            'Interface theme',
      'imp.tema_dark':       'Dark',
      'imp.tema_light':      'Light',
      'imp.lingua':          'Language',
      'imp.rotte':           'Maritime routes',
      'imp.rotte_on':        'Visible',
      'imp.rotte_off':       'Hidden',
      'imp.salva':           'Save settings',
      'imp.salvato':         'Settings saved',
      'imp.profilo':         'User profile',
      'imp.ruolo':           'Role',
      'imp.ruolo_admin':     'Administrator',
      'imp.ruolo_user':      'User',

      // ESG
      'esg.titolo':              'ESG Data',
      'esg.energia':             'Energy',
      'esg.acqua':               'Water',
      'esg.co2':                 'Total CO₂',
      'esg.scope1':              'Scope 1',
      'esg.scope2':              'Scope 2',
      'esg.rating':              'ESG Rating',
      'esg.benchmark_kwh':       'kWh benchmark',
      'esg.benchmark_m3':        'm³ benchmark',
      'esg.unita_kwh':           'kWh/d',
      'esg.unita_m3':            'm³/d',
      'esg.unita_co2':           'kg/d',
      'esg.flotta_co2':          'Total CO₂',
      'esg.flotta_kwh':          'Avg energy/asset',
      'esg.flotta_rating':       'Avg rating',
      'esg.unita_tannno':        't/yr',
      'esg.unita_kwh_asset':     'kWh/asset/d',

      // Weather
      'meteo.titolo':            'Live weather',
      'meteo.temperatura':       'Temperature',
      'meteo.vento':             'Wind',
      'meteo.umidita':           'Humidity',
      'meteo.precipitazioni':    'Precipitation',
      'meteo.caricamento':       'Loading weather...',
      'meteo.errore':            'Weather data unavailable',
      'meteo.kmh':               'km/h',
      'meteo.mm':                'mm',

      // Generic
      'gen.caricamento':     'Loading...',
      'gen.errore':          'An error occurred',
      'gen.conferma':        'Confirm',
      'gen.annulla':         'Cancel',
      'gen.salva':           'Save',
      'gen.chiudi':          'Close',
      'gen.si':              'Yes',
      'gen.no':              'No',
      'gen.solo_admin':      'Feature reserved for administrators',
    }
  };

  function getLang() {
    return localStorage.getItem('gam_lingua') || 'it';
  }

  function setLang(lang) {
    localStorage.setItem('gam_lingua', lang);
  }

  function t(key) {
    const lang = getLang();
    return (dict[lang] && dict[lang][key]) || dict['it'][key] || key;
  }

  // Applica le traduzioni a tutti gli elementi con data-i18n
  function apply() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
  }

  return { t, getLang, setLang, apply };

})();
