/**
 * App.tsx — Entry point React GAM Platform
 * Routing con Wouter + protezione auth
 *
 * 3 dimostratori separati con layout distinti:
 *   /           → DashboardPage (landing)
 *   /gam/*      → GamLayout (sidebar GAM + topbar)
 *   /efficiency/*→ EfficiencyLayout (sidebar Efficiency + topbar)
 *   /bems/*     → BemsLayout (header + stepper, no sidebar)
 */
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Redirect, useLocation } from 'wouter';
import ErrorBoundary from './components/ErrorBoundary';
import { ThemeProvider } from './contexts/ThemeContext';
import { isAuthenticated } from './lib/api';

// Layout
import { GamLayout, GamPageLayout } from './components/layout/GamLayout';
import { EfficiencyLayout, EfficiencyPageLayout } from './components/layout/EfficiencyLayout';
import { BemsLayout } from './components/layout/BemsLayout';

// Pagine
import Login from './pages/Login';
import DashboardPage from './pages/DashboardPage';
import AssetManagement from './pages/AssetManagement';
import AssetEfficiency from './pages/AssetEfficiency';
import BemsStudio from './pages/BemsStudio';
import BemsStudioWizard from './pages/BemsStudioWizard';
import AlarmsPage from './pages/AlarmsPage';
import WorkOrdersPage from './pages/WorkOrdersPage';
import DeadlinesPage from './pages/DeadlinesPage';
import DocumentsPage from './pages/DocumentsPage';
import PlaceholderPage from './pages/PlaceholderPage';
import NotFound from './pages/NotFound';
import { useState } from 'react';

// ── Guard autenticazione ─────────────────────────────────────────────
function AuthGuard({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) return <Redirect to="/login" />;
  return <>{children}</>;
}

// ── Wrapper mappa GAM (passa filtri topbar ↔ mappa) ─────────────────
function GamMapPage() {
  const [activeTipo, setActiveTipo] = useState('tutti');
  const [searchValue, setSearchValue] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: number; nome: string; tipo: string; citta: string }>>([]);
  const [selectId, setSelectId] = useState<number | null>(null);

  return (
    <GamLayout
      showMapControls
      activeTipo={activeTipo}
      onTipoChange={setActiveTipo}
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      searchResults={searchResults}
      onSearchSelect={id => setSelectId(id)}
    >
      <AssetManagement
        activeTipo={activeTipo}
        onTipoChange={setActiveTipo}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        onSearchSelect={id => setSelectId(id)}
      />
    </GamLayout>
  );
}

// ── Wrapper mappa Efficiency ─────────────────────────────────────────
function EfficiencyMapPage() {
  const [activeTipo, setActiveTipo] = useState('tutti');
  const [searchValue, setSearchValue] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: number; nome: string; tipo: string; citta: string }>>([]);

  return (
    <EfficiencyLayout
      showMapControls
      activeTipo={activeTipo}
      onTipoChange={setActiveTipo}
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      searchResults={searchResults}
    >
      <AssetEfficiency />
    </EfficiencyLayout>
  );
}

// ── Wrapper BEMS Studio (wizard) ─────────────────────────────────────
function BemsStudioPage() {
  const [activeStep, setActiveStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);

  function handleStepChange(step: number) {
    setActiveStep(step);
  }

  function handleStepComplete(step: number) {
    setCompletedSteps(prev => prev.includes(step) ? prev : [...prev, step]);
  }

  return (
    <BemsLayout
      activeStep={activeStep}
      onStepChange={handleStepChange}
      completedSteps={completedSteps}
    >
      <div className="bems-content">
        <BemsStudioWizard
          activeStep={activeStep}
          onStepChange={handleStepChange}
          onStepComplete={handleStepComplete}
        />
      </div>
    </BemsLayout>
  );
}

// ── Router ───────────────────────────────────────────────────────────
function Router() {
  return (
    <Switch>
      {/* Login (no layout) */}
      <Route path="/login" component={Login} />

      {/* Root → Dashboard */}
      <Route path="/">
        {() => (
          <AuthGuard>
            <DashboardPage />
          </AuthGuard>
        )}
      </Route>

      {/* ── Dimostratore GAM ─────────────────────────────────────── */}
      <Route path="/gam/map">
        {() => <AuthGuard><GamMapPage /></AuthGuard>}
      </Route>

      <Route path="/gam/assets">
        {() => (
          <AuthGuard>
            <GamPageLayout>
              <PlaceholderPage
                title="Anagrafica Asset"
                description="Lista completa degli asset con filtri avanzati e gestione CRUD."
                legacyUrl="/static/assets.html"
              />
            </GamPageLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/gam/alarms">
        {() => (
          <AuthGuard>
            <GamPageLayout><AlarmsPage /></GamPageLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/gam/workorders">
        {() => (
          <AuthGuard>
            <GamPageLayout><WorkOrdersPage /></GamPageLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/gam/deadlines">
        {() => (
          <AuthGuard>
            <GamPageLayout><DeadlinesPage /></GamPageLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/gam/efficiency">
        {() => (
          <AuthGuard>
            <GamPageLayout>
              <PlaceholderPage
                title="Asset Efficiency"
                description="Analisi efficienza energetica per singolo asset."
                legacyUrl="/static/asset-efficiency.html"
              />
            </GamPageLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/gam/documents">
        {() => (
          <AuthGuard>
            <GamPageLayout><DocumentsPage /></GamPageLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/gam/bim">
        {() => (
          <AuthGuard>
            <GamPageLayout>
              <PlaceholderPage
                title="Gestione BIM"
                description="Upload e gestione modelli BIM e planimetrie SVG."
                legacyUrl="/static/bim-manager.html"
              />
            </GamPageLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/gam/settings">
        {() => (
          <AuthGuard>
            <GamPageLayout>
              <PlaceholderPage
                title="Impostazioni"
                description="Configurazione soglie, utenti e preferenze."
                legacyUrl="/static/settings.html"
              />
            </GamPageLayout>
          </AuthGuard>
        )}
      </Route>

      {/* Redirect legacy routes → nuovi namespace */}
      <Route path="/map">
        {() => <Redirect to="/gam/map" />}
      </Route>
      <Route path="/alarms">
        {() => <Redirect to="/gam/alarms" />}
      </Route>
      <Route path="/workorders">
        {() => <Redirect to="/gam/workorders" />}
      </Route>
      <Route path="/deadlines">
        {() => <Redirect to="/gam/deadlines" />}
      </Route>
      <Route path="/documents">
        {() => <Redirect to="/gam/documents" />}
      </Route>

      {/* ── Dimostratore Efficiency ───────────────────────────────── */}
      <Route path="/efficiency/map">
        {() => <AuthGuard><EfficiencyMapPage /></AuthGuard>}
      </Route>

      <Route path="/efficiency/assets">
        {() => (
          <AuthGuard>
            <EfficiencyPageLayout>
              <PlaceholderPage
                title="Anagrafica Asset Efficiency"
                description="Lista asset con KPI energetici."
                legacyUrl="/static/efficiency-assets.html"
              />
            </EfficiencyPageLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/efficiency/alarms">
        {() => (
          <AuthGuard>
            <EfficiencyPageLayout>
              <AlarmsPage />
            </EfficiencyPageLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/efficiency/anomaly">
        {() => (
          <AuthGuard>
            <EfficiencyPageLayout>
              <PlaceholderPage
                title="Anomaly Detection"
                description="Rilevamento anomalie energetiche con ML."
                legacyUrl="/static/anomaly-detection.html"
              />
            </EfficiencyPageLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/efficiency/energy">
        {() => (
          <AuthGuard>
            <EfficiencyPageLayout>
              <PlaceholderPage
                title="Energy Summary"
                description="Riepilogo consumi energetici per asset e portfolio."
                legacyUrl="/static/energy-summary.html"
              />
            </EfficiencyPageLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/efficiency/occupancy">
        {() => (
          <AuthGuard>
            <EfficiencyPageLayout>
              <PlaceholderPage
                title="Occupancy"
                description="Analisi occupancy e IAQ per asset e zone."
                legacyUrl="/static/occupancy.html"
              />
            </EfficiencyPageLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/efficiency/invoices">
        {() => (
          <AuthGuard>
            <EfficiencyPageLayout>
              <PlaceholderPage
                title="Tariffe & Bollette"
                description="Gestione bollette energetiche e tariffe."
                legacyUrl="/static/efficiency-invoices.html"
              />
            </EfficiencyPageLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/efficiency/settings">
        {() => (
          <AuthGuard>
            <EfficiencyPageLayout>
              <PlaceholderPage
                title="Impostazioni Efficiency"
                description="Configurazione soglie energetiche e preferenze."
                legacyUrl="/static/efficiency-settings.html"
              />
            </EfficiencyPageLayout>
          </AuthGuard>
        )}
      </Route>

      {/* Redirect legacy /efficiency → /efficiency/map */}
      <Route path="/efficiency">
        {() => <Redirect to="/efficiency/map" />}
      </Route>

      {/* ── Dimostratore BEMS ─────────────────────────────────────── */}
      <Route path="/bems/studio">
        {() => <AuthGuard><BemsStudioPage /></AuthGuard>}
      </Route>

      <Route path="/bems/floorplan">
        {() => (
          <AuthGuard>
            <BemsLayout activeStep={1}>
              <BemsStudio />
            </BemsLayout>
          </AuthGuard>
        )}
      </Route>

      {/* Redirect legacy /bems-studio → /bems/studio */}
      <Route path="/bems-studio">
        {() => <Redirect to="/bems/studio" />}
      </Route>
      <Route path="/bems">
        {() => <Redirect to="/bems/studio" />}
      </Route>

      {/* 404 */}
      <Route component={NotFound} />
    </Switch>
  );
}

// ── App ──────────────────────────────────────────────────────────────
function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
