/**
 * useApi — hook generico per chiamate API con stato loading/error/data
 */
import { useState, useEffect, useCallback, useRef } from 'react';

interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Esegue una chiamata API all'mount e quando le dipendenze cambiano.
 * @param fetcher - funzione async che ritorna i dati
 * @param deps - dipendenze (come useEffect)
 * @param enabled - se false, non esegue la chiamata
 */
export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
  enabled = true,
) {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    loading: enabled,
    error: null,
  });

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const execute = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetcherRef.current();
      setState({ data, loading: false, error: null });
    } catch (err) {
      setState(s => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : 'Errore sconosciuto',
      }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    execute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);

  return { ...state, refetch: execute };
}

/**
 * useApiMutation — per operazioni POST/PUT/DELETE con stato loading/error
 */
export function useApiMutation<TArgs extends unknown[], TResult = unknown>(
  mutator: (...args: TArgs) => Promise<TResult>,
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(async (...args: TArgs): Promise<TResult> => {
    setLoading(true);
    setError(null);
    try {
      const result = await mutator(...args);
      setLoading(false);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Errore sconosciuto';
      setError(msg);
      setLoading(false);
      throw err;
    }
  }, [mutator]);

  return { mutate, loading, error };
}
