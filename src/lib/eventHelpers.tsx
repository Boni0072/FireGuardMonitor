import { AlertTriangle, Flame, Wifi, WifiOff, Activity, ShieldCheck, RotateCcw, BellRing, CircuitBoard } from 'lucide-react';
import {
  resolveEventTone,
  resolveEventLabel,
  TONE_BADGE_LIGHT,
  TONE_BADGE_DARK,
  tonePulseClass,
  type EventLike,
} from '@/lib/contactIdRules';

export type EventType = 'alarm' | 'fault' | 'supervisory' | 'alarm_restore' | 'fault_restore' | 'comm_loss' | 'comm_restore' | 'gateway_fault' | 'heartbeat';

export const EVENT_LABELS: Record<EventType, string> = {
  alarm: 'Alarme de Incêndio',
  fault: 'Falha da Central',
  supervisory: 'Supervisão',
  alarm_restore: 'Restauração de Alarme',
  fault_restore: 'Restauração de Falha',
  comm_loss: 'Perda de Comunicação',
  comm_restore: 'Retorno de Comunicação',
  gateway_fault: 'Falha do Gateway',
  heartbeat: 'Heartbeat',
};

export const EVENT_ICONS: Record<EventType, typeof Flame> = {
  alarm: Flame,
  fault: AlertTriangle,
  supervisory: ShieldCheck,
  alarm_restore: RotateCcw,
  fault_restore: RotateCcw,
  comm_loss: WifiOff,
  comm_restore: Wifi,
  gateway_fault: CircuitBoard,
  heartbeat: Activity,
};

export function severityColor(sev: string): string {
  switch (sev) {
    case 'critical': return 'bg-red-100 text-red-700 border border-red-200';
    case 'warning': return 'bg-amber-100 text-amber-700 border border-amber-200';
    case 'normal': return 'bg-green-100 text-green-700 border border-green-200';
    default: return 'bg-slate-100 text-slate-600 border border-slate-200';
  }
}

/**
 * Cor do badge de um evento.
 * Aceita apenas o event_type (fallback legado) ou o evento completo, quando a
 * regra de cores por codigo Contact ID (qualificador + codigo) tem prioridade.
 */
export function eventTypeColor(typeOrEvent: string | EventLike): string {
  if (typeof typeOrEvent !== 'string') {
    const { tone } = resolveEventTone(typeOrEvent);
    return TONE_BADGE_LIGHT[tone];
  }
  switch (typeOrEvent) {
    case 'alarm': return 'bg-red-100 text-red-700 border border-red-200';
    case 'fault':
    case 'gateway_fault': return 'bg-amber-100 text-amber-700 border border-amber-200';
    case 'comm_loss': return 'bg-orange-100 text-orange-700 border border-orange-200';
    case 'alarm_restore':
    case 'fault_restore':
    case 'comm_restore': return 'bg-green-100 text-green-700 border border-green-200';
    case 'supervisory': return 'bg-blue-100 text-blue-700 border border-blue-200';
    default: return 'bg-slate-100 text-slate-600 border border-slate-200';
  }
}

/** Rotulo do badge respeitando a regra de Contact ID quando disponivel. */
export function eventLabelFor(evt: EventLike, fallback: string): string {
  return resolveEventLabel(evt, fallback);
}

/** Classe de pulsacao do evento (vazio = nao pulsa). */
export function eventPulseClass(evt: EventLike): string {
  const { tone, pulse } = resolveEventTone(evt);
  return tonePulseClass(tone, pulse);
}

/** Classes de badge no tema escuro do Monitor, conforme a regra de cores. */
export function eventBadgeDark(evt: EventLike): string {
  const { tone } = resolveEventTone(evt);
  return TONE_BADGE_DARK[tone];
}


export function gatewayStatusColor(status: string): string {
  switch (status) {
    case 'online': return 'bg-green-100 text-green-700 border border-green-200';
    case 'degraded': return 'bg-amber-100 text-amber-700 border border-amber-200';
    case 'offline': return 'bg-red-100 text-red-700 border border-red-200';
    case 'disabled': return 'bg-slate-100 text-slate-500 border border-slate-200';
    default: return 'bg-slate-100 text-slate-500 border border-slate-200';
  }
}

// ---------------------------------------------------------------------------
// Real-time connection status of a fire panel (central)
// Derived from its gateway status + recent events (last 24h), never editable.
// Precedence: active alarm > fault > gateway state > unknown.
// ---------------------------------------------------------------------------

export type PanelConnectionStatus = 'alarm' | 'fault' | 'online' | 'offline' | 'unknown';

export function derivePanelConnectionStatus(
  gateway: { status: string } | null | undefined,
  events: Array<{ event_type: string; state: string; acknowledged?: boolean | null }>,
): PanelConnectionStatus {
  const alarms = events.filter((e) => e.event_type === 'alarm' && e.state === 'active' && !e.acknowledged);
  const faults = events.filter((e) => ['fault', 'comm_loss', 'gateway_fault'].includes(e.event_type) && e.state !== 'normal');
  if (alarms.length > 0) return 'alarm';
  if (faults.length > 0) return 'fault';
  if (!gateway) return 'unknown';
  if (gateway.status === 'online') return 'online';
  if (gateway.status === 'offline') return 'offline';
  if (gateway.status === 'degraded') return 'fault';
  return 'unknown';
}

export const PANEL_CONNECTION_META: Record<PanelConnectionStatus, { label: string; badge: string; dot: string }> = {
  alarm: { label: 'Alarme ativo', badge: 'bg-red-100 text-red-700 border border-red-200', dot: 'bg-red-500' },
  fault: { label: 'Em falha', badge: 'bg-amber-100 text-amber-700 border border-amber-200', dot: 'bg-amber-500' },
  offline: { label: 'Sem comunicação', badge: 'bg-orange-100 text-orange-700 border border-orange-200', dot: 'bg-orange-500' },
  online: { label: 'Operacional', badge: 'bg-green-100 text-green-700 border border-green-200', dot: 'bg-green-500' },
  unknown: { label: 'Desconhecido', badge: 'bg-slate-100 text-slate-600 border border-slate-200', dot: 'bg-slate-400' },
};

export function gatewayStatusLabel(status: string): string {
  switch (status) {
    case 'online': return 'Online';
    case 'degraded': return 'Degradado';
    case 'offline': return 'Offline';
    case 'disabled': return 'Desativado';
    default: return status;
  }
}

/**
 * Extrai um rotulo curto e legivel da descricao do protocolo Contact ID.
 * O receptor grava no formato "Rotulo - Detalhe" (ex.: "Falta de energia AC - Falta de energia AC"),
 * entao ficamos apenas com o rotulo principal para evitar texto duplicado no badge.
 */
export function eventBadgeLabel(descricao?: string | null): string | null {
  const raw = (descricao ?? '').trim();
  if (!raw) return null;
  const principal = raw.split(' - ')[0].trim();
  const label = principal || raw;
  return label.length > 0 ? label : null;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s atrás`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}min atrás`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h atrás`;
  const days = Math.floor(hr / 24);
  return `${days}d atrás`;
}

export function severityIcon(sev: string) {
  switch (sev) {
    case 'critical': return Flame;
    case 'warning': return AlertTriangle;
    case 'normal': return ShieldCheck;
    default: return Activity;
  }
}

export { BellRing };
