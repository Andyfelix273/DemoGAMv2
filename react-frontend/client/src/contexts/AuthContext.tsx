/**
 * AuthContext — stato autenticazione globale GAM
 */
import React, { createContext, useContext } from 'react';
import { useAuth, type AuthState } from '@/hooks/useAuth';

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  can: (permission: string) => boolean;
  isAdmin: boolean;
  isEditor: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext deve essere usato dentro AuthProvider');
  return ctx;
}
