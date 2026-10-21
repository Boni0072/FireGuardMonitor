import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  dedupeEventRows,
  fetchUnifiedEvents,
  isSameEventOccurrence,
  sortEventsNewestFirst,
  type EventRow,
} from '@/lib/db';

export interface UnifiedEventsState {
  events: EventRow[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** Insere/atualiza um evento vindo do realtime, mantendo dedupe e ordem. */
  mergeEvent: (evt: EventRow) => void;
}

/**
 * Carregador unico de "eventos recentes" para Dashboard, Mapa, Monitor e Painel.
 *
 * - Usa `fetchUnifiedEvents` (colecoes `events` + `eventos` legado), ja
 *   deduplicado, normalizado e ordenado do mais recente para o mais antigo.
 * - Aplica o filtro de tenant do usuario (mantem eventos sem tenant vinculado).
 * - Recarrega quando o perfil/tenant muda e expoe `reload` para atualizacao manual.
 */
export function useUnifiedEvents(limit = 500): UnifiedEventsState {
  const { profile } = useAuth();
  const isPlatformAdmin = profile?.role === 'platform_admin';
  const tenantId = profile?.tenant_id ?? null;

  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchUnifiedEvents(limit, { tenantId: isPlatformAdmin ? null : tenantId })
      .then((rows) => {
        if (!active) return;
        setEvents(rows);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        console.error('[useUnifiedEvents] falha ao carregar eventos', err);
        setError(err instanceof Error ? err.message : 'Falha ao carregar eventos');
        setLoading(false);
      });
    return () => { active = false; };
  }, [limit, tenantId, isPlatformAdmin, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  const mergeEvent = useCallback((evt: EventRow) => {
    setEvents((prev) => {
      // Mesma ocorrencia (mesmo Contact ID dentro da janela temporal)?
      const idx = prev.findIndex((e) => isSameEventOccurrence(e, evt));
      const next: EventRow[] = idx >= 0
        ? prev.map((e, i) => (i === idx ? { ...e, ...evt } : e))
        : // Ja existe um evento com o MESMO Contact ID, mas de outra ocorrencia
          // (ex.: heartbeat reenviado)? Entao e um evento NOVO: insere.
          [evt, ...prev];
      // Reaplica dedupe + ordenacao para nao duplicar nem desalinhar a lista.
      const deduped = dedupeEventRows(next);
      sortEventsNewestFirst(deduped);
      return deduped.slice(0, limit);
    });
  }, [limit]);

  return { events, loading, error, reload, mergeEvent };
}
