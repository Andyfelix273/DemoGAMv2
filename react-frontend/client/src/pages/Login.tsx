/**
 * Login — Pagina di autenticazione GAM Platform
 * Replica fedele del login.html vanilla:
 * - Background: bg_control_room.jpg a tutta pagina
 * - Logo Metamorphosis sopra, logo KeyBiz sotto
 * - Label "Utente" / "Password" (non uppercase)
 * - Hint credenziali demo in fondo
 */
import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';

// URL immagini dal webdev storage
const BG_URL       = '/manus-storage/bg_control_room_a1bf30ad.jpg';
const META_LOGO    = '/manus-storage/metamorphosis_logo_27c5fd28.png';
const KEYBIZ_LOGO  = '/manus-storage/keybiz_logo_73ad8f4a.png';

export default function Login() {
  const [, navigate] = useLocation();
  const { login, isLoggedIn, loading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoggedIn) navigate('/map');
  }, [isLoggedIn, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(username, password);
      navigate('/map');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Credenziali non valide');
    }
  }

  return (
    <div className="login-page" style={{ backgroundImage: `url(${BG_URL})` }}>
      {/* Overlay scuro semi-trasparente */}
      <div className="login-overlay" />

      <div className="login-card">
        {/* Logo Metamorphosis */}
        <img
          src={META_LOGO}
          alt="Metamorphosis"
          className="login-meta-logo"
        />
        {/* Logo KeyBiz */}
        <img
          src={KEYBIZ_LOGO}
          alt="KeyBiz"
          className="login-keybiz-logo"
        />

        <p className="login-subtitle">Accedi alla piattaforma</p>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label className="login-label" htmlFor="username">Utente</label>
            <input
              id="username"
              type="text"
              className="login-input"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div className="form-group">
            <label className="login-label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="login-input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div className="login-error">{error}</div>
          )}

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                Accesso in corso…
              </span>
            ) : 'Accedi'}
          </button>
        </form>

        <p className="login-hint">Demo: admin / demo2026</p>
      </div>
    </div>
  );
}
