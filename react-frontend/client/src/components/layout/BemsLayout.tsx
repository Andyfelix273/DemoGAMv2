/**
 * BemsLayout — Layout dimostratore BEMS Studio
 * Struttura HTML identica al vanilla bems-studio.html:
 *   - Nessuna sidebar
 *   - Header: logo BEMS Studio + badge "Modalità Integratore" + back link Dashboard
 *   - Stepper: 4 step (Edificio, Zone & Planimetria, Sensori & MQTT, Export)
 *   - Content: area scrollabile
 */
import { Link } from 'wouter';

interface BemsLayoutProps {
  children: React.ReactNode;
  /** Step attivo (1-4) */
  activeStep?: number;
  onStepChange?: (step: number) => void;
  /** Step completati */
  completedSteps?: number[];
}

const STEPS = [
  { num: 1, label: 'Edificio' },
  { num: 2, label: 'Zone & Planimetria' },
  { num: 3, label: 'Sensori & MQTT' },
  { num: 4, label: 'Export Documento' },
];

export function BemsLayout({
  children,
  activeStep = 1,
  onStepChange,
  completedSteps = [],
}: BemsLayoutProps) {
  return (
    <div className="bems-layout">
      {/* Header */}
      <div className="bems-header">
        <div>
          <div className="bems-header-logo">
            <i className="fa fa-cogs" style={{ marginRight: 6, color: '#8B5CF6' }} />
            BEMS Studio
          </div>
          <div className="bems-header-sub">Configurazione Integratori — GAM Platform</div>
        </div>
        <div className="bems-header-spacer" />
        <span className="bems-header-badge">
          <i className="fa fa-plug" style={{ marginRight: 4 }} />
          Modalità Integratore
        </span>
        <Link href="/">
          <a className="bems-back-link" style={{ marginLeft: 8 }}>
            <i className="fa fa-arrow-left" />
            Dashboard
          </a>
        </Link>
      </div>

      {/* Stepper */}
      <div className="stepper">
        {STEPS.map((s, idx) => {
          const isDone = completedSteps.includes(s.num);
          const isActive = activeStep === s.num;
          return (
            <div
              key={s.num}
              className={`step${isActive ? ' active' : ''}${isDone ? ' completed' : ''}`}
              onClick={() => onStepChange?.(s.num)}
            >
              <div className="step-num">
                {isDone ? <i className="fa fa-check" style={{ fontSize: 10 }} /> : s.num}
              </div>
              {s.label}
              {idx < STEPS.length - 1 && (
                <span className="step-arrow" style={{ marginLeft: 8 }}>
                  <i className="fa fa-chevron-right" />
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Content */}
      <div className="bems-body">
        {children}
      </div>
    </div>
  );
}
