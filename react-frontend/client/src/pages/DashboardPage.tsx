/**
 * DashboardPage — Landing dei 3 dimostratori
 * Struttura HTML identica al vanilla dashboard.html:
 *   - .body-dashboard (full-page dark)
 *   - .demo-header: logo + titolo + sottotitolo
 *   - .dashboard-main: .modules-grid con 3 .module-card
 *   - .demo-footer: pulsante logout
 */
import { Link } from 'wouter';
import { useAuth } from '@/hooks/useAuth';

const MODULES = [
  {
    href:  '/gam/map',
    icon:  'fa-map-marker',
    title: 'GIS Asset Manager',
    desc:  'Visualizza e gestisci gli asset aziendali su mappa interattiva con monitoraggio operativo in tempo reale, gestione allarmi e work order, planimetrie per piano e integrazione dati BIM.',
    badge: 'Disponibile',
    live:  true,
  },
  {
    href:  '/efficiency/map',
    icon:  'fa-bolt',
    title: 'Occupancy & Efficientamento',
    desc:  'Analisi dell\'occupazione degli edifici per ottimizzare l\'utilizzo degli spazi e ridurre i consumi energetici attraverso dati IoT real-time.',
    badge: 'Disponibile',
    live:  true,
  },
  {
    href:  '/bems/studio',
    icon:  'fa-cogs',
    title: 'BEMS Studio',
    desc:  'Configurazione guidata per integratori: selezione zone BIM, import anagrafica sensori, configurazione MQTT e generazione documento di progettazione.',
    badge: 'Disponibile',
    live:  true,
  },
];

export default function DashboardPage() {
  const { logout } = useAuth();

  return (
    <div className="body-dashboard">
      {/* Header */}
      <header className="demo-header">
        <img
          className="demo-logo"
          src="/manus-storage/logodark_99cb9ce0.png"
          alt="Metamorphosis"
        />
        <h1 className="demo-title">Metamorphosis Online Demo</h1>
        <p className="demo-subtitle">Seleziona il modulo da avviare</p>
      </header>

      {/* Griglia moduli */}
      <main className="dashboard-main">
        <div className="modules-grid">
          {MODULES.map(m => (
            <Link key={m.href} href={m.href}>
              <a className="module-card">
                <div className="module-icon">
                  <i className={`fa ${m.icon}`} />
                </div>
                <div className="module-body">
                  <p className="module-title">{m.title}</p>
                  <p className="module-desc">{m.desc}</p>
                </div>
                <span className={`module-badge${m.live ? ' live' : ''}`}>
                  {m.badge}
                </span>
              </a>
            </Link>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="demo-footer">
        <button onClick={logout}>
          <i className="fa fa-sign-out" />
          Esci
        </button>
      </footer>
    </div>
  );
}
