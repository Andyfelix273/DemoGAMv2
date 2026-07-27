/**
 * useAuth — hook per autenticazione e permessi GAM
 */
import { useState, useEffect, useCallback } from 'react';
import { auth, getAuthPayload, isAuthenticated, setToken, clearToken } from '@/lib/api';

export interface AuthState {
  isLoggedIn: boolean;
  user: { sub: string; nome: string; role: string; permissions: string[] } | null;
  loading: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    isLoggedIn: isAuthenticated(),
    user: getAuthPayload(),
    loading: false,
  });

  const login = useCallback(async (username: string, password: string) => {
    setState(s => ({ ...s, loading: true }));
    try {
      const { access_token } = await auth.login(username, password);
      setToken(access_token);
      setState({
        isLoggedIn: true,
        user: getAuthPayload(),
        loading: false,
      });
      return true;
    } catch (err) {
      setState(s => ({ ...s, loading: false }));
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setState({ isLoggedIn: false, user: null, loading: false });
    window.location.href = '/login';
  }, []);

  const can = useCallback((permission: string) => {
    if (!state.user) return false;
    if (state.user.role === 'admin') return true;
    return state.user.permissions?.includes(permission) ?? false;
  }, [state.user]);

  const isAdmin = state.user?.role === 'admin';
  const isEditor = state.user?.role === 'editor' || isAdmin;

  return { ...state, login, logout, can, isAdmin, isEditor };
}
