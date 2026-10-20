// ---------------------------------------------------------------------------
// Reconciliacao de eventos por central
// ---------------------------------------------------------------------------
//
// O Contact ID chega como eventos independentes: o disparo (qualificador 1) e a
// restauracao (qualificador 3) sao gravados como documentos separados. Sem
// reconciliar, o disparo ficaria "ativo" para sempre e a central nunca voltaria
// ao verde. Aqui cruzamos os eventos para saber o que realmente esta valendo.
//
// Regra de reconexao: "Online" (602) como evento MAIS RECENTE encerra os
// alarmes/falhas anteriores — ao voltar a comunicacao, o proprio painel
// re-envia o que continuar ativo. Sem isso, um alarme antigo sem
// restauracao deixaria o card em vermelho para sempre, divergindo da
// ultima atividade exibida no painel (ex.: Online 11:07 -> card Operacional).

import { resolveEventTone, type ContactIdTone } from '@/lib/contactIdRules';

export interface PanelEvent {
  id?: string;
  event_type?: string | null;
  state?: string | null;
  severity?: string | null;
  received_at?: string | null;
  occurred_at?: string | null;
  acknowledged?: boolean | null;
  qualificador?: string | null;
  codigo_contato?: string | null;
  codigo?: string | null;
  zona?: string | null;
  descricao?: string | null;
  [k: string]: unknown;
}

const RESTORE_QUALIFIER = '3';
const ONLINE_CODE = '602';

function ts(evt: PanelEvent): number {
  const raw = evt.received_at ?? evt.occurred_at ?? '';
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function codeOf(evt: PanelEvent): string {
  return String(evt.codigo_contato ?? evt.codigo ?? '').trim();
}

function zoneOf(evt: PanelEvent): string {
  return String(evt.zona ?? '').trim();
}

/**
 * Um evento de restauracao (qualificador 3) cancela o disparo correspondente
 * (mesmo codigo e mesma zona) que veio antes.
 */
export function isCancelledByRestore(trigger: PanelEvent, restores: PanelEvent[]): boolean {
  if (String(trigger.qualificador ?? '') === RESTORE_QUALIFIER) return false;
  const code = codeOf(trigger);
  if (!code) return false;
  const tts = ts(trigger);
  return restores.some((r) => {
    if (String(r.qualificador ?? '') !== RESTORE_QUALIFIER) return false;
    if (codeOf(r) !== code) return false;
    const zone = zoneOf(trigger);
    if (zone && zoneOf(r) && zone !== zoneOf(r)) return false;
    return ts(r) >= tts;
  });
}

/** Evento de "Online" (602) — indica que a central voltou a reportar. */
export function isOnlineEvent(evt: PanelEvent): boolean {
  return codeOf(evt) === ONLINE_CODE;
}

export interface PanelState {
  /** Tom dominante do estado atual da central. */
  tone: ContactIdTone;
  /** Rotulo curto do estado atual. */
  label: string;
  /** Existe alarme ativo (nao cancelado por restauracao)? */
  hasActiveAlarm: boolean;
  /** Existe falha ativa (nao cancelada por restauracao)? */
  hasActiveFault: boolean;
  /** Houve comunicacao "Online" (codigo 602) registrada? */
  hasOnline: boolean;
  /** Contagem de alarmes ativos reconciliados. */
  activeAlarmCount: number;
  /** Contagem de falhas ativas reconciliadas. */
  faultCount: number;
  /** Evento que motiva o estado atual (o mais relevante). */
  statusEvent: PanelEvent | null;
  /** Eventos que de fato estao ativos (para exibicao). */
  activeEvents: PanelEvent[];
}

const ALARM_TYPES = ['alarm'];
const FAULT_TYPES = ['fault', 'comm_loss', 'gateway_fault'];

/**
 * Reconcilia a lista de eventos de uma central e devolve o estado real.
 * Prioridade: alarme ativo > falha ativa > online > desconhecido.
 */
export function reconcilePanelState(events: PanelEvent[]): PanelState {
  const ordered = [...events].sort((a, b) => ts(b) - ts(a));
  // Reconexao: se o evento mais recente da central e "Online" (602), a
  // comunicacao acabou de voltar. Painel de alarme re-envia as condicoes
  // ainda ativas quando reconecta; logo, alarmes e falhas anteriores ao
  // 602 sao encerrados e apenas eventos de data igual/posterior continuam
  // valendo. Assim o card acompanha a ultima atividade do painel em vez
  // de ficar "presa" num alarme antigo sem restauracao.
  const newest = ordered[0] ?? null;
  const considered = newest && isOnlineEvent(newest)
    ? ordered.filter((e) => ts(e) >= ts(newest))
    : ordered;
  const restores = considered.filter((r) => String(r.qualificador ?? '') === RESTORE_QUALIFIER);
  const onlineEvents = considered.filter(isOnlineEvent);

  const isActive = (e: PanelEvent): boolean => {
    if (e.state === 'normal') return false;
    // Um disparo e cancelado por uma restauracao posterior do mesmo codigo/zona,
    // mesmo que o documento original continue com state "active" no banco.
    if (isCancelledByRestore(e, restores)) return false;
    return true;
  };

  const alarmEvents = considered.filter((e) => ALARM_TYPES.includes(String(e.event_type ?? '')) && isActive(e));
  const faultEvents = considered.filter((e) => FAULT_TYPES.includes(String(e.event_type ?? '')) && isActive(e));

  if (alarmEvents.length > 0) {
    const ev = alarmEvents[0];
    return {
      tone: 'critical',
      label: 'COM ALARME',
      hasActiveAlarm: true,
      hasActiveFault: faultEvents.length > 0,
      hasOnline: onlineEvents.length > 0,
      activeAlarmCount: alarmEvents.length,
      faultCount: faultEvents.length,
      statusEvent: ev,
      activeEvents: [...alarmEvents, ...faultEvents],
    };
  }

  if (faultEvents.length > 0) {
    const ev = faultEvents[0];
    return {
      tone: 'warning',
      label: 'EM FALHA',
      hasActiveAlarm: false,
      hasActiveFault: true,
      hasOnline: onlineEvents.length > 0,
      activeAlarmCount: 0,
      faultCount: faultEvents.length,
      statusEvent: ev,
      activeEvents: faultEvents,
    };
  }

  // Sem alarme nem falha: online se houve comunicacao recente.
  const online = onlineEvents[0] ?? null;
  if (online) {
    return {
      tone: 'ok',
      label: 'OPERACIONAL',
      hasActiveAlarm: false,
      hasActiveFault: false,
      hasOnline: true,
      activeAlarmCount: 0,
      faultCount: 0,
      statusEvent: online,
      activeEvents: [],
    };
  }

  const last = ordered[0] ?? null;
  const fallbackTone = last ? resolveEventTone(last).tone : 'info';
  return {
    tone: fallbackTone,
    label: 'OPERACIONAL',
    hasActiveAlarm: false,
    hasActiveFault: false,
    hasOnline: false,
    activeAlarmCount: 0,
    faultCount: 0,
    statusEvent: last,
    activeEvents: [],
  };
}
