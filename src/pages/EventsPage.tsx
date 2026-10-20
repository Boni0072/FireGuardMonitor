import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db, EventRow, Building, Gateway, Panel, Profile, fetchAllEvents } from '@/lib/db';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { EVENT_LABELS, EVENT_ICONS, eventTypeColor, severityColor, eventLabelFor, formatDateTime, timeAgo } from '@/lib/eventHelpers';
import { Search, CheckCircle, Activity, Filter, X } from 'lucide-react';

export function EventsPage() {
  const { profile } = useAuth();
  const isPlatformAdmin = profile?.role === 'platform_admin';
  const canAck = isPlatformAdmin || profile?.role === 'tenant_admin' || profile?.role === 'operator';

  const [events, setEvents] = useState<EventRow[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<EventRow | null>(null);

  const [filters, setFilters] = useState({
    search: '', building_id: '', event_type: '', state: '', acknowledged: '',
  });

  async function load() {
    setLoading(true);
    // Evento atual: unifica `events` (nova) + `eventos` (legada), ordenado por received_at desc.
    // Inclui tenant null/vazio (sem empresa) e o tenant do usuario.
    let allLatest = ((await fetchAllEvents(200)) as EventRow[])
      .sort((a, b) => String(b.received_at ?? '').localeCompare(String(a.received_at ?? '')));
    if (!isPlatformAdmin && profile?.tenant_id) {
      allLatest = allLatest.filter((e) => e.tenant_id == null || e.tenant_id === '' || e.tenant_id === profile.tenant_id);
    }
    // Aplica os filtros de tela sobre a lista atual
    let list = allLatest;
    if (filters.building_id) list = list.filter((e) => e.building_id === filters.building_id);
    if (filters.event_type) list = list.filter((e) => e.event_type === filters.event_type);
    if (filters.state) list = list.filter((e) => e.state === filters.state);
    if (filters.acknowledged === 'yes') list = list.filter((e) => e.acknowledged);
    if (filters.acknowledged === 'no') list = list.filter((e) => !e.acknowledged);
    setEvents(list.slice(0, 200));

    const [bRes, gRes, pRes] = await Promise.all([
      db.from('buildings').select('*').order('name'),
      db.from('gateways').select('*').order('name'),
      db.from('panels').select('*').order('manufacturer'),
    ]);
    setBuildings((bRes.data ?? []) as Building[]);
    setGateways((gRes.data ?? []) as Gateway[]);
    setPanels((pRes.data ?? []) as Panel[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [profile, filters.building_id, filters.event_type, filters.state, filters.acknowledged]);

  // Realtime subscription (1 inscricao estavel; fica escutando `events` e a colecao
  // legada `eventos`. O dedupe por external_event_id garante que o mesmo evento, que
  // o receptor grava nas duas colecoes, nao seja aplicado duas vezes.
  useEffect(() => {
    if (!profile) return;
    const myTenant = profile.tenant_id;
    const admin = isPlatformAdmin;
    let alive = true;

    const applyEvent = (newEvent: EventRow) => {
      if (!alive) return;
      if (!admin && myTenant && newEvent.tenant_id != null && newEvent.tenant_id !== '' && newEvent.tenant_id !== myTenant) return;
      setEvents((prev) => {
        const same = prev.some((e) => (e.external_event_id ?? '') === (newEvent.external_event_id ?? '') && e.received_at === newEvent.received_at);
        if (same) return prev;
        const next = [newEvent, ...prev.filter((e) => e.id !== newEvent.id)];
        next.sort((a, b) => String(b.received_at ?? '').localeCompare(String(a.received_at ?? '')));
        return next.slice(0, 200);
      });
    };

    const channel = db
      .channel('events-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events' }, (payload) => {
        if (!alive) return;
        applyEvent(payload.new as EventRow);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events' }, (payload) => {
        if (!alive) return;
        applyEvent(payload.new as EventRow);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'eventos' }, (payload) => {
        if (!alive) return;
        applyEvent(payload.new as EventRow);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'eventos' }, (payload) => {
        if (!alive) return;
        applyEvent(payload.new as EventRow);
      })
      .subscribe();

    return () => { alive = false; db.removeChannel(channel); };
  }, [profile?.id, profile?.tenant_id, isPlatformAdmin]);

  const acknowledge = useCallback(async (evt: EventRow) => {
    if (!profile) return;
    await db
      .from('events')
      .update({ acknowledged: true, acknowledged_by: profile.id, acknowledged_at: new Date().toISOString() })
      .eq('id', evt.id);
    setEvents((prev) => prev.map((e) => (e.id === evt.id ? { ...e, acknowledged: true, acknowledged_by: profile.id, acknowledged_at: new Date().toISOString() } : e)));
  }, [profile]);

  const nameOf = (id: string | null, list: { id: string; name?: string | null; manufacturer?: string | null; model?: string | null }[]) => {
    if (!id) return '—';
    const item = list.find((x) => x.id === id);
    if (!item) return '—';
    const fallback = `${item.manufacturer ?? ''} ${item.model ?? ''}`.trim();
    return item.name || fallback || '—';
  };

  const filtered = events.filter((e) => {
    if (filters.building_id && e.building_id !== filters.building_id) return false;
    if (filters.event_type && e.event_type !== filters.event_type) return false;
    if (filters.state && e.state !== filters.state) return false;
    if (filters.acknowledged === 'yes' && !e.acknowledged) return false;
    if (filters.acknowledged === 'no' && e.acknowledged) return false;
    if (!filters.search) return true;
    const s = filters.search.toLowerCase();
    return (e.input_ref ?? '').toLowerCase().includes(s) || (e.external_event_id ?? '').toLowerCase().includes(s) || (e.origem_ip ?? '').toLowerCase().includes(s) || (e.conta ?? '').toLowerCase().includes(s) || nameOf(e.building_id, buildings).toLowerCase().includes(s);
  });

  const unlinked = events.filter((e) => !e.panel_id);

  const hasFilters = filters.search || filters.building_id || filters.event_type || filters.state || filters.acknowledged;

  return (
    <>
      <PageHeader title="Central de Eventos" subtitle="Eventos em tempo real com filtros e reconhecimento" />

      {/* Filters */}
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input className="input pl-10" placeholder="Buscar..." value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
          </div>
          <select className="input w-auto" value={filters.building_id} onChange={(e) => setFilters({ ...filters, building_id: e.target.value })}>
            <option value="">Todos os edifícios</option>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className="input w-auto" value={filters.event_type} onChange={(e) => setFilters({ ...filters, event_type: e.target.value })}>
            <option value="">Todos os tipos</option>
            {Object.entries(EVENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="input w-auto" value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })}>
            <option value="">Todos os estados</option>
            <option value="active">Ativo</option><option value="normal">Normal</option><option value="fault">Falha</option><option value="unknown">Desconhecido</option>
          </select>
          <select className="input w-auto" value={filters.acknowledged} onChange={(e) => setFilters({ ...filters, acknowledged: e.target.value })}>
            <option value="">Reconhecimento</option><option value="no">Pendente</option><option value="yes">Reconhecido</option>
          </select>
          {hasFilters && (
            <button className="btn-ghost text-sm" onClick={() => setFilters({ search: '', building_id: '', event_type: '', state: '', acknowledged: '' })}>
              <X className="w-4 h-4" /> Limpar
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
          <Activity className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-medium text-slate-700">{filtered.length} eventos</span>
          {unlinked.length > 0 && (
            <span className="ml-2 badge bg-orange-100 text-orange-700 border border-orange-200">
              {unlinked.length} sem vínculo (conta/IP não cadastrados na central)
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5 text-xs text-green-600">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Tempo real
          </span>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="text-center py-12 text-slate-400">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-400">Nenhum evento encontrado.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Data/Hora</th>
                  <th className="px-4 py-3 text-left font-medium">Edifício</th>
                  <th className="px-4 py-3 text-left font-medium">Gateway</th>
                  <th className="px-4 py-3 text-left font-medium">IP / Conta</th>
                  <th className="px-4 py-3 text-left font-medium">Tipo</th>
                  <th className="px-4 py-3 text-left font-medium">Estado</th>
                  <th className="px-4 py-3 text-left font-medium">Sev.</th>
                  <th className="px-4 py-3 text-left font-medium">Reconhecimento</th>
                  <th className="px-4 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((evt) => {
                  const Icon = EVENT_ICONS[evt.event_type as keyof typeof EVENT_ICONS] ?? Activity;
                  return (
                    <tr key={evt.id} className={`hover:bg-slate-50 transition-colors cursor-pointer ${evt.severity === 'critical' && !evt.acknowledged ? 'bg-red-50/50' : ''}`} onClick={() => setDetail(evt)}>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        <div>{formatDateTime(evt.occurred_at)}</div>
                        <div className="text-slate-400">{timeAgo(evt.received_at)}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{nameOf(evt.building_id, buildings)}</td>
                      <td className="px-4 py-3 text-slate-600">{nameOf(evt.gateway_id, gateways)}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {evt.origem_ip || evt.conta ? (
                          <div>{evt.origem_ip ?? '—'}{evt.conta ? ` · conta ${evt.conta}` : ''}</div>
                        ) : '—'}
                        {!evt.panel_id && <div className="text-orange-600">sem vínculo</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`badge ${eventTypeColor(evt)}`}>
                          <Icon className="w-3 h-3" /> {eventLabelFor(evt, EVENT_LABELS[evt.event_type as keyof typeof EVENT_LABELS] ?? evt.event_type)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 capitalize">{evt.state}</td>
                      <td className="px-4 py-3"><span className={`badge ${severityColor(evt.severity)}`}>{evt.severity}</span></td>
                      <td className="px-4 py-3">
                        {evt.acknowledged ? (
                          <span className="badge bg-green-100 text-green-700 border border-green-200"><CheckCircle className="w-3 h-3" /> Sim</span>
                        ) : (
                          <span className="badge bg-amber-100 text-amber-700 border border-amber-200">Pendente</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        {canAck && !evt.acknowledged && (
                          <button className="btn-secondary text-xs py-1.5" onClick={() => acknowledge(evt)}>Reconhecer</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-400 mt-4 max-w-3xl">
        O reconhecimento do evento não apaga o alarme nem altera o estado físico da central.
      </p>

      {/* Detail modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title="Detalhes do Evento" size="lg">
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className={`badge ${eventTypeColor(detail)}`}>{eventLabelFor(detail, EVENT_LABELS[detail.event_type as keyof typeof EVENT_LABELS])}</span>
              <span className={`badge ${severityColor(detail.severity)}`}>Severidade: {detail.severity}</span>
              <span className={`badge ${detail.acknowledged ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>
                {detail.acknowledged ? 'Reconhecido' : 'Pendente'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><div className="text-xs text-slate-400">Edifício</div><div className="text-slate-700">{nameOf(detail.building_id, buildings)}</div></div>
              <div><div className="text-xs text-slate-400">Gateway</div><div className="text-slate-700">{nameOf(detail.gateway_id, gateways)}</div></div>
              <div><div className="text-xs text-slate-400">Central</div><div className="text-slate-700">{nameOf(detail.panel_id, panels)}</div></div>
              <div><div className="text-xs text-slate-400">Entrada</div><div className="text-slate-700">{detail.input_ref || '—'}</div></div>
              <div><div className="text-xs text-slate-400">Horário de origem</div><div className="text-slate-700">{formatDateTime(detail.occurred_at)}</div></div>
              <div><div className="text-xs text-slate-400">Horário de recebimento</div><div className="text-slate-700">{formatDateTime(detail.received_at)}</div></div>
              <div><div className="text-xs text-slate-400">Sequência</div><div className="text-slate-700">{detail.sequence ?? '—'}</div></div>
              <div><div className="text-xs text-slate-400">ID externo</div><div className="text-slate-700">{detail.external_event_id || '—'}</div></div>
              <div><div className="text-xs text-slate-400">IP de origem</div><div className="text-slate-700">{detail.origem_ip || '—'}</div></div>
              <div><div className="text-xs text-slate-400">Conta Contact ID</div><div className="text-slate-700">{detail.conta || '—'}</div></div>
              <div><div className="text-xs text-slate-400">Descrição do protocolo</div><div className="text-slate-700">{detail.descricao || '—'}</div></div>
              <div><div className="text-xs text-slate-400">Bruto</div><div className="text-slate-700 font-mono text-xs">{detail.bruto || '—'}</div></div>
              {detail.acknowledged && (
                <>
                  <div><div className="text-xs text-slate-400">Reconhecido por</div><div className="text-slate-700">{detail.acknowledged_by ?? '—'}</div></div>
                  <div><div className="text-xs text-slate-400">Reconhecido em</div><div className="text-slate-700">{formatDateTime(detail.acknowledged_at)}</div></div>
                </>
              )}
            </div>
            {canAck && !detail.acknowledged && (
              <button className="btn-primary w-full" onClick={() => { acknowledge(detail); setDetail({ ...detail, acknowledged: true, acknowledged_by: profile?.id ?? null, acknowledged_at: new Date().toISOString() }); }}>
                <CheckCircle className="w-4 h-4" /> Reconhecer evento
              </button>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
