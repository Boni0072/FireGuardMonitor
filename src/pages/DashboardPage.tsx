import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db, Gateway, EventRow, Building } from '@/lib/db';
import { PageHeader } from '@/components/PageHeader';
import {
  Building2, Radio, Wifi, WifiOff, Flame, AlertTriangle,
  Activity, Clock, TrendingUp, ShieldCheck, Users,
} from 'lucide-react';
import { EVENT_LABELS, eventTypeColor, eventLabelFor, formatTime, timeAgo } from '@/lib/eventHelpers';

interface Stats {
  tenants: number;
  buildings: number;
  gateways: number;
  online: number;
  offline: number;
  activeAlarms: number;
  commFailures: number;
  events24h: number;
  avgAckSec: number | null;
}

export function DashboardPage() {
  const { profile } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentEvents, setRecentEvents] = useState<EventRow[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [eventsByDay, setEventsByDay] = useState<{ date: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const isPlatformAdmin = profile?.role === 'platform_admin';

  useEffect(() => {
    async function load() {
      setLoading(true);
      const tenantFilter: Record<string, string> = isPlatformAdmin || !profile?.tenant_id ? {} : { tenant_id: profile.tenant_id };

      const [tenantRes, bldRes, gwRes, evtRes] = await Promise.all([
        db.from('tenants').select('id', { count: 'exact', head: true }),
        db.from('buildings').select('id, name, tenant_id', { count: 'exact' }).match(tenantFilter),
        db.from('gateways').select('*').match(tenantFilter),
        db.from('events').select('*').order('received_at', { ascending: false }).limit(8),
      ]);

      const gateways = (gwRes.data ?? []) as Gateway[];
      const events24 = ((await db
        .from('events')
        .select('id, received_at, acknowledged, acknowledged_at, severity, event_type, state')
        .gte('received_at', new Date(Date.now() - 86400000).toISOString())
        .match(tenantFilter)
      ).data ?? []) as EventRow[];

      const buildingsData = (bldRes.data ?? []) as Building[];
      const buildingsFiltered = isPlatformAdmin ? buildingsData : buildingsData.filter((b) => b.tenant_id === profile?.tenant_id);

      setBuildings(buildingsFiltered);

      const online = gateways.filter((g) => g.status === 'online').length;
      const offline = gateways.filter((g) => g.status === 'offline').length;
      const activeAlarms = events24.filter((e) => e.event_type === 'alarm' && e.state === 'active').length;
      const commFailures = events24.filter((e) => e.event_type === 'comm_loss').length;

      const acked = events24.filter((e) => e.acknowledged && e.acknowledged_at);
      const ackTimes = acked.map((e) => {
        const diff = new Date(e.acknowledged_at!).getTime() - new Date(e.received_at).getTime();
        return Math.max(0, Math.floor(diff / 1000));
      }).filter((t) => t > 0);
      const avgAckSec = ackTimes.length > 0 ? Math.round(ackTimes.reduce((a, b) => a + b, 0) / ackTimes.length) : null;

      setStats({
        tenants: tenantRes.count ?? 0,
        buildings: buildingsFiltered.length,
        gateways: gateways.length,
        online,
        offline,
        activeAlarms,
        commFailures,
        events24h: events24.length,
        avgAckSec,
      });

      setRecentEvents((evtRes.data ?? []) as EventRow[]);

      // events by day for last 7 days
      const days: { date: string; count: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
        const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString();
        const count = events24.filter((e) => e.received_at >= dayStart && e.received_at < dayEnd).length;
        days.push({ date: d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' }), count });
      }
      setEventsByDay(days);
      setLoading(false);
    }
    load();
  }, [profile, isPlatformAdmin]);

  const maxDay = useMemo(() => Math.max(...eventsByDay.map((d) => d.count), 1), [eventsByDay]);

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Carregando indicadores...</div>;

  const cards = [
    ...(isPlatformAdmin ? [{ label: 'Empresas', value: stats?.tenants ?? 0, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' }] : []),
    { label: 'Edifícios', value: stats?.buildings ?? 0, icon: Building2, color: 'text-slate-700', bg: 'bg-slate-100' },
    { label: 'Gateways', value: stats?.gateways ?? 0, icon: Radio, color: 'text-slate-700', bg: 'bg-slate-100' },
    { label: 'Dispositivos Online', value: stats?.online ?? 0, icon: Wifi, color: 'text-green-600', bg: 'bg-green-50' },
    { label: 'Sem Comunicação', value: stats?.offline ?? 0, icon: WifiOff, color: 'text-red-600', bg: 'bg-red-50' },
    { label: 'Alarmes Ativos', value: stats?.activeAlarms ?? 0, icon: Flame, color: 'text-red-600', bg: 'bg-red-50', critical: true },
    { label: 'Falhas de Comunicação', value: stats?.commFailures ?? 0, icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'Eventos (24h)', value: stats?.events24h ?? 0, icon: Activity, color: 'text-blue-600', bg: 'bg-blue-50' },
  ];

  return (
    <>
      <PageHeader title="Dashboard Executivo" subtitle="Visão geral do monitoramento em tempo real" />

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className={`card card-hover p-5 ${c.critical && (c.value > 0) ? 'pulse-critical' : ''}`}>
              <div className="flex items-start justify-between mb-3">
                <div className={`w-10 h-10 rounded-lg ${c.bg} flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${c.color}`} />
                </div>
              </div>
              <div className="text-3xl font-bold text-slate-900">{c.value}</div>
              <div className="text-sm text-slate-500 mt-1">{c.label}</div>
            </div>
          );
        })}
      </div>

      {/* Avg ack time banner */}
      <div className="card p-5 mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
            <Clock className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <div className="text-sm text-slate-500">Tempo médio de reconhecimento</div>
            <div className="text-xl font-bold text-slate-900">
              {stats?.avgAckSec !== null && stats?.avgAckSec !== undefined
                ? `${Math.floor(stats.avgAckSec / 60)}min ${stats.avgAckSec % 60}s`
                : 'Sem dados'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <ShieldCheck className="w-4 h-4 text-green-600" />
          <span className="hidden sm:inline">Plataforma operacional</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Events by day chart */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            <h3 className="font-semibold text-slate-900">Eventos por dia (7 dias)</h3>
          </div>
          <div className="flex items-end justify-between gap-2 h-48 pt-4">
            {eventsByDay.map((d) => (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-2">
                <div className="text-xs text-slate-500 font-medium">{d.count}</div>
                <div
                  className="w-full rounded-t-md bg-blue-500 hover:bg-blue-600 transition-colors min-h-[2px]"
                  style={{ height: `${(d.count / maxDay) * 140}px` }}
                />
                <div className="text-xs text-slate-500 capitalize">{d.date}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Distribution by building */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="w-5 h-5 text-slate-600" />
            <h3 className="font-semibold text-slate-900">Edifícios monitorados</h3>
          </div>
          <div className="space-y-3">
            {buildings.slice(0, 5).map((b) => (
              <div key={b.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                  <span className="text-sm text-slate-700 truncate">{b.name}</span>
                </div>
                <span className="text-xs text-slate-400 shrink-0">{b.panel_count} centrais</span>
              </div>
            ))}
            {buildings.length === 0 && <p className="text-sm text-slate-400">Nenhum edifício cadastrado.</p>}
          </div>
        </div>
      </div>

      {/* Recent events */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          <Activity className="w-5 h-5 text-blue-600" />
          <h3 className="font-semibold text-slate-900">Eventos recentes</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {recentEvents.length === 0 && <div className="px-5 py-8 text-center text-sm text-slate-400">Nenhum evento recebido ainda.</div>}
          {recentEvents.map((evt) => (
            <div key={evt.id} className="px-5 py-3.5 flex items-center gap-4 hover:bg-slate-50 transition-colors">
              <div className={`badge ${eventTypeColor(evt)}`}>
                {eventLabelFor(evt, EVENT_LABELS[evt.event_type as keyof typeof EVENT_LABELS] ?? evt.event_type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-700 truncate">
                  Entrada: {evt.input_ref || '—'} · Severidade: {evt.severity}
                </div>
              </div>
              <div className="text-xs text-slate-400 shrink-0 hidden sm:block">{formatTime(evt.received_at)}</div>
              <div className="text-xs text-slate-400 shrink-0">{timeAgo(evt.received_at)}</div>
              {evt.acknowledged ? (
                <span className="badge bg-green-100 text-green-700 border border-green-200">Reconhecido</span>
              ) : (
                <span className="badge bg-slate-100 text-slate-500 border border-slate-200">Pendente</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
