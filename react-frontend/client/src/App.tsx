/**
 * App.tsx — Entry point React GAM Platform
 * Routing con Wouter + protezione auth + layout sidebar
 */
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Redirect, useLocation } from 'wouter';
import ErrorBoundary from './components/ErrorBoundary';
import { ThemeProvider } from './contexts/ThemeContext';
import { AppLayout } from './components/layout/AppLayout';
import { isAuthenticated } from './lib/api';

// Pagine
import Login from './pages/Login';
import AssetManagement from './pages/AssetManagement';
import AssetEfficiency from './pages/AssetEfficiency';
import BemsStudio from './pages/BemsStudio';
import AlarmsPage from './pages/AlarmsPage';
import WorkOrdersPage from './pages/WorkOrdersPage';
import DeadlinesPage from './pages/DeadlinesPage';
import DocumentsPage from './pages/DocumentsPage';
import PlaceholderPage from './pages/PlaceholderPage';
import NotFound from './pages/NotFound';

// ── Guard autenticazione ─────────────────────────────────────────────
function AuthGuard({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  if (!isAuthenticated()) {
    return <Redirect to="/login" />;
  }
  return <>{children}</>;
}

// ── Router ───────────────────────────────────────────────────────────
function Router() {
  return (
    <Switch>
      {/* Login (no layout) */}
      <Route path="/login" component={Login} />

      {/* Redirect root → mappa */}
      <Route path="/">
        {() => <Redirect to="/map" />}
      </Route>

      {/* Pagine protette con layout */}
      <Route path="/map">
        {() => (
          <AuthGuard>
            <AppLayout>
              <AssetManagement />
            </AppLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/assets">
        {() => (
          <AuthGuard>
            <AppLayout>
              <PlaceholderPage
                title="Anagrafica Asset"
                description="Lista completa degli asset con filtri avanzati e gestione CRUD."
                legacyUrl="/static/assets.html"
              />
            </AppLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/alarms">
        {() => (
          <AuthGuard>
            <AppLayout>
              <AlarmsPage />
            </AppLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/workorders">
        {() => (
          <AuthGuard>
            <AppLayout>
              <WorkOrdersPage />
            </AppLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/deadlines">
        {() => (
          <AuthGuard>
            <AppLayout>
              <DeadlinesPage />
            </AppLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/documents">
        {() => (
          <AuthGuard>
            <AppLayout>
              <DocumentsPage />
            </AppLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/efficiency">
        {() => (
          <AuthGuard>
            <AppLayout>
              <AssetEfficiency />
            </AppLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/occupancy">
        {() => (
          <AuthGuard>
            <AppLayout>
              <PlaceholderPage
                title="Occupancy"
                description="Analisi occupancy e IAQ per asset e zone."
                legacyUrl="/static/occupancy.html"
              />
            </AppLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/energy">
        {() => (
          <AuthGuard>
            <AppLayout>
              <PlaceholderPage
                title="Energy Summary"
                description="Riepilogo consumi energetici per asset e portfolio."
                legacyUrl="/static/energy-summary.html"
              />
            </AppLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/invoices">
        {() => (
          <AuthGuard>
            <AppLayout>
              <PlaceholderPage
                title="Tariffe & Bollette"
                description="Gestione bollette energetiche e tariffe."
                legacyUrl="/static/efficiency-invoices.html"
              />
            </AppLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/bems">
        {() => (
          <AuthGuard>
            <AppLayout>
              <BemsStudio />
            </AppLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/bems-studio">
        {() => (
          <AuthGuard>
            <AppLayout>
              <BemsStudio />
            </AppLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/bim">
        {() => (
          <AuthGuard>
            <AppLayout>
              <PlaceholderPage
                title="Gestione BIM"
                description="Upload e gestione modelli BIM e planimetrie SVG."
                legacyUrl="/static/bim-manager.html"
              />
            </AppLayout>
          </AuthGuard>
        )}
      </Route>

      <Route path="/settings">
        {() => (
          <AuthGuard>
            <AppLayout>
              <PlaceholderPage
                title="Impostazioni"
                description="Configurazione soglie, utenti e preferenze."
                legacyUrl="/static/settings.html"
              />
            </AppLayout>
          </AuthGuard>
        )}
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
