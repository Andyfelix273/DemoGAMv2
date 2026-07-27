/**
 * BemsStudioWizard — Wizard configurazione BEMS Studio
 * Struttura identica al vanilla bems-studio.html:
 *   Step 1: Selezione edificio + nome sessione
 *   Step 2: Zone & Planimetria (SVG interattivo)
 *   Step 3: Sensori & MQTT
 *   Step 4: Export Documento
 *
 * Montato dentro BemsLayout (header + stepper).
 */
import { useState, useEffect, useRef } from 'react';
import { assets, bems } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import type { Asset } from '@/lib/types';

// ── Tipi ─────────────────────────────────────────────────────────────
interface Floor {
  id: number;
  floor_id: string;
  nome: string;
  level: number;
  svg_file: string | null;
}

interface SelectedZone {
  id: string;
  nome: string;
  tipo: string;
}

interface SensorConfig {
  id: number;
  nome: string;
  tipo: string;
  zone_id_sensor: string | null;
  mqtt_topic: string;
  mqtt_broker: string;
  mqtt_port: number;
}

// ── Step 1: Selezione edificio ────────────────────────────────────────
function Step1({
  sessionName, setSessionName,
  integrator, setIntegrator,
  selectedAssetId, setSelectedAssetId,
  onNext,
}: {
  sessionName: string; setSessionName: (v: string) => void;
  integrator: string; setIntegrator: (v: string) => void;
  selectedAssetId: number | null; setSelectedAssetId: (id: number) => void;
  onNext: () => void;
}) {
  const { data: assetList, loading } = useApi(() => assets.list(), []);

  return (
    <div className="step-panel active">
      <div className="panel">
        <div className="panel-header">
          <i className="fa fa-building" /> Seleziona l'edificio da configurare
        </div>
        <div className="panel-body">
          <div className="form-grid" style={{ marginBottom: 16 }}>
            <div className="form-group">
              <label>Nome sessione</label>
              <input
                type="text"
                className="form-control"
                placeholder="es. Configurazione BEMS Sede Roma — 2026"
                value={sessionName}
                onChange={e => setSessionName(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Integratore / Tecnico</label>
              <input
                type="text"
                className="form-control"
                placeholder="Nome tecnico o azienda"
                value={integrator}
                onChange={e => setIntegrator(e.target.value)}
              />
            </div>
          </div>
          <hr className="divider" />
          <div className="section-title">Edifici disponibili</div>

          {loading ? (
            <div className="empty-state">
              <span className="spinner" />
              <br />Caricamento edifici...
            </div>
          ) : (
            <div className="building-grid">
              {(assetList ?? []).map((a: Asset) => (
                <div
                  key={a.id}
                  className={`building-card${selectedAssetId === a.id ? ' selected' : ''}`}
                  onClick={() => setSelectedAssetId(a.id)}
                >
                  <div className="building-card-icon">
                    <i className="fa fa-building" />
                  </div>
                  <div className="building-card-body">
                    <div className="building-card-name">{a.nome}</div>
                    <div className="building-card-meta">{a.tipo} — {a.citta}</div>
                  </div>
                  {selectedAssetId === a.id && (
                    <i className="fa fa-circle-check" style={{ color: 'var(--accent-green)', marginLeft: 'auto' }} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="step-nav">
        <span className="step-nav-info">
          {selectedAssetId ? 'Edificio selezionato — pronto per continuare' : 'Seleziona un edificio per continuare'}
        </span>
        <button
          className="btn btn-primary"
          disabled={!selectedAssetId}
          onClick={onNext}
        >
          Avanti: Zone &amp; Planimetria <i className="fa fa-arrow-right" />
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Zone & Planimetria ────────────────────────────────────────
function Step2({
  assetId,
  selectedZones, setSelectedZones,
  onBack, onNext,
}: {
  assetId: number;
  selectedZones: SelectedZone[];
  setSelectedZones: (z: SelectedZone[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { data: floors, loading: floorsLoading } = useApi(
    () => bems.floors(assetId),
    [assetId]
  );
  const [activeFloor, setActiveFloor] = useState<string | null>(null);
  const { data: zones, loading: zonesLoading } = useApi(
    () => assetId ? bems.zones(assetId) : Promise.resolve([]),
    [assetId]
  );
  const svgRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [svgLoading, setSvgLoading] = useState(false);

  // Seleziona primo piano
  useEffect(() => {
    if (floors && floors.length > 0 && !activeFloor) {
      setActiveFloor(floors[0].floor_id);
    }
  }, [floors]);

  // Carica SVG del piano attivo
  useEffect(() => {
    if (!floors || !activeFloor) return;
    const floor = (floors as Floor[]).find(f => f.floor_id === activeFloor);
    if (!floor?.svg_file) { setSvgContent(null); return; }
    setSvgLoading(true);
    fetch(`/static/${floor.svg_file}`)
      .then(r => r.text())
      .then(svg => { setSvgContent(svg); setSvgLoading(false); })
      .catch(() => { setSvgContent(null); setSvgLoading(false); });
  }, [activeFloor, floors]);

  function toggleZone(zone: { id: string; nome: string; tipo: string }) {
    const exists = selectedZones.find(z => z.id === zone.id);
    if (exists) {
      setSelectedZones(selectedZones.filter(z => z.id !== zone.id));
    } else {
      setSelectedZones([...selectedZones, zone]);
    }
  }

  function selectAll() {
    if (!zones) return;
    setSelectedZones((zones as Array<{ zone_id: string; nome: string; tipo: string }>).map(z => ({
      id: z.zone_id, nome: z.nome, tipo: z.tipo,
    })));
  }

  function deselectAll() {
    setSelectedZones([]);
  }

  return (
    <div className="step-panel active">
      <div className="panel">
        <div className="panel-header">
          <i className="fa fa-map" /> Seleziona le zone dalla planimetria BIM
          <div style={{ flex: 1 }} />
          {/* Floor tabs */}
          <div className="floor-tabs">
            {(floors as Floor[] ?? []).map(f => (
              <button
                key={f.floor_id}
                className={`floor-tab${activeFloor === f.floor_id ? ' active' : ''}`}
                onClick={() => setActiveFloor(f.floor_id)}
              >
                {f.nome}
              </button>
            ))}
          </div>
          <span className="text-sm text-muted" style={{ marginLeft: 12 }}>
            {selectedZones.length} zone selezionate
          </span>
        </div>
        <div className="panel-body" style={{ padding: 0 }}>
          <div style={{ display: 'flex', height: 520 }}>
            {/* SVG container */}
            <div style={{
              flex: 1, minWidth: 0, background: '#060d1a',
              borderRight: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              position: 'relative', overflow: 'hidden',
            }}>
              {svgLoading && (
                <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
                  <span className="spinner" /><br />Caricamento planimetria...
                </div>
              )}
              {!svgLoading && !svgContent && (
                <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
                  <i className="fa fa-map" style={{ fontSize: 32, marginBottom: 8, display: 'block' }} />
                  Nessuna planimetria disponibile per questo piano
                </div>
              )}
              {svgContent && (
                <div
                  ref={svgRef}
                  style={{ width: '100%', height: '100%', position: 'relative' }}
                  dangerouslySetInnerHTML={{ __html: svgContent }}
                />
              )}
            </div>
            {/* Zone sidebar */}
            <div style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                  Zone selezionate
                </div>
                <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginBottom: 4 }} onClick={selectAll}>
                  <i className="fa fa-circle-check" /> Seleziona tutte
                </button>
                <button className="btn btn-secondary btn-sm" style={{ width: '100%' }} onClick={deselectAll}>
                  <i className="fa fa-square" /> Deseleziona tutte
                </button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
                {zonesLoading ? (
                  <div className="empty-state"><span className="spinner" /></div>
                ) : (zones as Array<{ zone_id: string; nome: string; tipo: string }> ?? []).map(z => {
                  const sel = selectedZones.some(s => s.id === z.zone_id);
                  return (
                    <div
                      key={z.zone_id}
                      className={`zone-item${sel ? ' selected' : ''}`}
                      onClick={() => toggleZone({ id: z.zone_id, nome: z.nome, tipo: z.tipo })}
                    >
                      <i className={`fa ${sel ? 'fa-circle-check' : 'fa-circle'}`} style={{ color: sel ? 'var(--accent-green)' : 'var(--text-muted)', marginRight: 6 }} />
                      <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{z.nome}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>{z.tipo}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="step-nav">
        <button className="btn btn-secondary" onClick={onBack}>
          <i className="fa fa-arrow-left" /> Indietro
        </button>
        <button className="btn btn-primary" disabled={selectedZones.length === 0} onClick={onNext}>
          Avanti: Sensori &amp; MQTT <i className="fa fa-arrow-right" />
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Sensori & MQTT ────────────────────────────────────────────
function Step3({
  assetId,
  selectedZones,
  sensors, setSensors,
  mqttBroker, setMqttBroker,
  mqttPort, setMqttPort,
  onBack, onNext,
}: {
  assetId: number;
  selectedZones: SelectedZone[];
  sensors: SensorConfig[];
  setSensors: (s: SensorConfig[]) => void;
  mqttBroker: string; setMqttBroker: (v: string) => void;
  mqttPort: number; setMqttPort: (v: number) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const SENSOR_TYPES = [
    { value: 'iaq',         label: 'IAQ (Temp/CO₂/Umidità)' },
    { value: 'occupancy',   label: 'Occupancy' },
    { value: 'power_meter', label: 'Contatore Energia' },
    { value: 'hvac',        label: 'Controller HVAC' },
    { value: 'multi',       label: 'Multifunzione' },
    { value: 'meter',       label: 'Meters (Contatori)' },
  ];

  return (
    <div className="step-panel active">
      {/* Sensori esistenti */}
      <div className="panel">
        <div className="panel-header">
          <i className="fa fa-database" /> Sensori esistenti — Importati dall'anagrafica
        </div>
        <div className="panel-body">
          <p className="text-sm text-muted" style={{ marginBottom: 12 }}>
            I seguenti sensori/impianti sono già censiti nel sistema GAM per questo edificio.
            Verifica e modifica la configurazione MQTT per ciascuno.
          </p>
          {sensors.length === 0 ? (
            <div className="empty-state">
              <i className="fa fa-database" style={{ fontSize: 24, marginBottom: 8 }} />
              <p>Nessun sensore censito per questo edificio</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Tipo</th>
                    <th>Zona</th>
                    <th>MQTT Topic</th>
                  </tr>
                </thead>
                <tbody>
                  {sensors.map(s => (
                    <tr key={s.id}>
                      <td>{s.nome}</td>
                      <td><span className="status-badge info">{s.tipo}</span></td>
                      <td>{selectedZones.find(z => z.id === s.zone_id_sensor)?.nome ?? '—'}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{s.mqtt_topic}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Aggiungi nuovi sensori */}
      <div className="panel">
        <div className="panel-header">
          <i className="fa fa-plus" /> Aggiungi nuovi sensori — Catalogo
        </div>
        <div className="panel-body">
          <p className="text-sm text-muted" style={{ marginBottom: 12 }}>
            Seleziona i sensori dal catalogo e assegnali alle zone monitorate.
          </p>
          <div className="form-grid" style={{ marginBottom: 14 }}>
            <div className="form-group">
              <label>Zona di destinazione</label>
              <select className="form-control">
                <option value="">— Seleziona zona —</option>
                {selectedZones.map(z => (
                  <option key={z.id} value={z.id}>{z.nome}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Tipo sensore</label>
              <select className="form-control">
                <option value="">Tutti i tipi</option>
                {SENSOR_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="empty-state" style={{ padding: '20px 0' }}>
            <i className="fa fa-microchip" style={{ fontSize: 24, marginBottom: 8 }} />
            <p>Catalogo sensori — funzionalità in sviluppo</p>
          </div>
        </div>
      </div>

      {/* Configurazione MQTT globale */}
      <div className="panel">
        <div className="panel-header">
          <i className="fa fa-wifi" /> Configurazione Broker MQTT Globale
        </div>
        <div className="panel-body">
          <p className="text-sm text-muted" style={{ marginBottom: 12 }}>
            Questi parametri vengono applicati come default a tutti i sensori.
          </p>
          <div className="form-grid-3">
            <div className="form-group">
              <label>Broker MQTT</label>
              <input
                type="text"
                className="form-control"
                placeholder="mqtt.example.com"
                value={mqttBroker}
                onChange={e => setMqttBroker(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Porta</label>
              <input
                type="number"
                className="form-control"
                value={mqttPort}
                onChange={e => setMqttPort(Number(e.target.value))}
              />
            </div>
            <div className="form-group">
              <label>Protocollo</label>
              <select className="form-control">
                <option value="mqtt">MQTT (1883)</option>
                <option value="mqtts">MQTTS (8883)</option>
                <option value="ws">WebSocket (8083)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="step-nav">
        <button className="btn btn-secondary" onClick={onBack}>
          <i className="fa fa-arrow-left" /> Indietro
        </button>
        <button className="btn btn-primary" onClick={onNext}>
          Avanti: Export Documento <i className="fa fa-arrow-right" />
        </button>
      </div>
    </div>
  );
}

// ── Step 4: Export Documento ──────────────────────────────────────────
function Step4({
  sessionName, integrator,
  selectedAsset, selectedZones, sensors,
  mqttBroker, mqttPort,
  onBack,
}: {
  sessionName: string; integrator: string;
  selectedAsset: Asset | null;
  selectedZones: SelectedZone[];
  sensors: SensorConfig[];
  mqttBroker: string; mqttPort: number;
  onBack: () => void;
}) {
  const [exporting, setExporting] = useState(false);

  function handleExport() {
    setExporting(true);
    // Simula generazione documento
    setTimeout(() => {
      const doc = {
        sessione: sessionName,
        integratore: integrator,
        edificio: selectedAsset?.nome,
        zone: selectedZones,
        sensori: sensors.length,
        mqtt: { broker: mqttBroker, porta: mqttPort },
        generato: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bems-config-${selectedAsset?.nome?.replace(/\s+/g, '-') ?? 'edificio'}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setExporting(false);
    }, 1200);
  }

  return (
    <div className="step-panel active">
      <div className="panel">
        <div className="panel-header">
          <i className="fa fa-file-export" /> Riepilogo Configurazione
        </div>
        <div className="panel-body">
          <div className="info-grid" style={{ marginBottom: 20 }}>
            <div className="info-item">
              <span className="info-label">Sessione</span>
              <span className="info-value">{sessionName || '—'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Integratore</span>
              <span className="info-value">{integrator || '—'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Edificio</span>
              <span className="info-value">{selectedAsset?.nome ?? '—'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Zone selezionate</span>
              <span className="info-value">{selectedZones.length}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Sensori configurati</span>
              <span className="info-value">{sensors.length}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Broker MQTT</span>
              <span className="info-value" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                {mqttBroker || '—'}:{mqttPort}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? (
                <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Generazione...</>
              ) : (
                <><i className="fa fa-file-arrow-down" /> Esporta Documento JSON</>
              )}
            </button>
            <button className="btn btn-secondary">
              <i className="fa fa-file-pdf" /> Esporta PDF (coming soon)
            </button>
          </div>
        </div>
      </div>

      <div className="step-nav">
        <button className="btn btn-secondary" onClick={onBack}>
          <i className="fa fa-arrow-left" /> Indietro
        </button>
        <span className="step-nav-info">
          <i className="fa fa-circle-check" style={{ color: 'var(--accent-green)', marginRight: 4 }} />
          Configurazione completata
        </span>
      </div>
    </div>
  );
}

// ── Componente principale ─────────────────────────────────────────────
export interface BemsStudioWizardProps {
  activeStep: number;
  onStepChange: (step: number) => void;
  onStepComplete: (step: number) => void;
}

export default function BemsStudioWizard({
  activeStep,
  onStepChange,
  onStepComplete,
}: BemsStudioWizardProps) {
  // Stato wizard
  const [sessionName, setSessionName] = useState('Configurazione BEMS — Sede Centrale Roma');
  const [integrator, setIntegrator] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);
  const [selectedZones, setSelectedZones] = useState<SelectedZone[]>([]);
  const [sensors, setSensors] = useState<SensorConfig[]>([]);
  const [mqttBroker, setMqttBroker] = useState('mqtt.example.com');
  const [mqttPort, setMqttPort] = useState(1883);

  const { data: assetList } = useApi(() => assets.list(), []);
  const selectedAsset = (assetList ?? []).find((a: Asset) => a.id === selectedAssetId) ?? null;

  function goNext(from: number) {
    onStepComplete(from);
    onStepChange(from + 1);
  }

  return (
    <>
      {activeStep === 1 && (
        <Step1
          sessionName={sessionName}
          setSessionName={setSessionName}
          integrator={integrator}
          setIntegrator={setIntegrator}
          selectedAssetId={selectedAssetId}
          setSelectedAssetId={setSelectedAssetId}
          onNext={() => goNext(1)}
        />
      )}
      {activeStep === 2 && selectedAssetId && (
        <Step2
          assetId={selectedAssetId}
          selectedZones={selectedZones}
          setSelectedZones={setSelectedZones}
          onBack={() => onStepChange(1)}
          onNext={() => goNext(2)}
        />
      )}
      {activeStep === 3 && selectedAssetId && (
        <Step3
          assetId={selectedAssetId}
          selectedZones={selectedZones}
          sensors={sensors}
          setSensors={setSensors}
          mqttBroker={mqttBroker}
          setMqttBroker={setMqttBroker}
          mqttPort={mqttPort}
          setMqttPort={setMqttPort}
          onBack={() => onStepChange(2)}
          onNext={() => goNext(3)}
        />
      )}
      {activeStep === 4 && (
        <Step4
          sessionName={sessionName}
          integrator={integrator}
          selectedAsset={selectedAsset}
          selectedZones={selectedZones}
          sensors={sensors}
          mqttBroker={mqttBroker}
          mqttPort={mqttPort}
          onBack={() => onStepChange(3)}
        />
      )}
    </>
  );
}
