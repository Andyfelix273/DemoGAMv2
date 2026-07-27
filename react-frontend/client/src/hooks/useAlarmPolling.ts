/**
 * useAlarmPolling — polling globale allarmi GAM
 * Rileva nuovi allarmi e aggiorna il badge nella topbar.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { alarms } from '@/lib/api';
import { ALARM_POLL_INTERVAL } from '@/lib/constants';
import type { Allarme } from '@/lib/types';

export interface AlarmState {
  totale: number;
  nuovi: Allarme[];
  lista: Allarme[];
}

export function useAlarmPolling(enabled = true) {
  const [state, setState] = useState<AlarmState>({ totale: 0, nuovi: [], lista: [] });
  const knownIdsRef = useRef<Set<number> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const lista = await alarms.list();
      // Il backend restituisce stato: 'alarm' | 'warning' | 'ack'
      const attivi = lista.filter(a => a.stato !== 'ack');
      const attiviIds = new Set(attivi.map(a => a.id));
      let nuovi: Allarme[] = [];
      if (knownIdsRef.current !== null) {
        nuovi = attivi.filter(a => !knownIdsRef.current!.has(a.id));
      }
      knownIdsRef.current = attiviIds;
      setState({ totale: attivi.length, nuovi, lista: attivi });
    } catch {
      // silenzioso
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    poll();
    timerRef.current = setInterval(poll, ALARM_POLL_INTERVAL);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [enabled, poll]);

  return state;
}
