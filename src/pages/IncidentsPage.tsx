import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db, Incident, Building } from '@/lib/db';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { severityColor, formatDateTime, timeAgo } from '@/lib/eventHelpers';
import { Flame, CheckCircle, XCircle, Clock, Filter, X } from 'lucide-react';

export function IncidentsPage() {
  const { profile } = useAuth();
  const isPlatformAdmin = profile?.role === 'platform_admin';
  const canAck = isPlatformAdmin || profile?.role === 'tenant_admin' || profile?.role === 'operator';

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Incident | null>(null);
  const [filterStatus, setFilterStatus] = useState('');

  async function load() {
    setLoading(true);
    let q = db.from('incidents').select('*').order('opened_at', { ascending: false });
    if (!isPlatformAdmin && profile?.tenant_id) q = q.eq('tenant_id', profile.tenant_id);
    if (filterStatus) q = q.eq('status', filterStatus);
    const { data } = await q;
    setIncidents((data ?? []) as Incident[]);

    const bq = db.from('buildings').select('*').order('name');
    if (!isPlatformAdmin && profile?.tenant_id) bq.eq('tenant_id', profile.tenant_id);
    const { data: bData } = await bq;
    setBuildings((bData ?? []) as Building[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [profile, filterStatus]);

  const acknowledge = useCallback(async (inc: Incident) => {
    if (!profile) return;
    const now = new Date().toISOString();
    const responseSec = Math.floor((Date.now() - new Date(inc.opened_at).getTime()) / 1000);
    await db.from('incidents').update({
      status: 'acknowledged', acknowledged_by: profile.id, acknowledged_at: now, response_time_sec: responseSec,
    }).eq('id', inc.id);
    setIncidents((prev) => prev.map((i) => i.id === inc.id ? { ...i, status: 'acknowledged', acknowledged_by: profile.id, acknowledged_at: now, response_time_sec: responseSec } : i));
  }, [profile]);

  const resolve = useCallback(async (inc: Incident) => {
    await db.from('incidents').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', inc.id);
    setIncidents((prev) => prev.map((i) => i.id === inc.id ? { ...i, status: 'resolved', resolved_at: new Date().toISOString() } : i));
  }, []);

  const buildingName = (id: string | null) => buildings.find((b) => b.id === id)?.name ?? '—';

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      open: 'bg-red-100 text-red-700 border border-red-200',
      acknowledged: 'bg-amber-100 text-amber-700 border border-amber-200',
      resolved: 'bg-green-100 text-green-700 border border-green-200',
      closed: 'bg-slate-100 text-slate-500 border border-slate-200',
    };
    const labels: Record<string, string> = { open: 'Aberto', acknowledged: 'Reconhecido', resolved: 'Resolvido', closed: 'Fechado' };
    return <span className={`badge ${map[s]}`}>{labels[s]}</span>;
  };

  return (
    <>
      <PageHeader title="Incidentes" subtitle="Incidentes que requerem reconhecimento e acompanhamento" />

      <div className="flex gap-2 mb-4">
        {['', 'open', 'acknowledged', 'resolved'].map((s) => (
          <button key={s} className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${filterStatus === s ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
            onClick={() => setFilterStatus(s)}>
            {s === '' ? 'Todos' : s === 'open' ? 'Abertos' : s === 'acknowledged' ? 'Reconhecidos' : 'Resolvidos'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">Carregando...</div>
      ) : incidents.length === 0 ? (
        <div className="card p-12 text-center">
          <CheckCircle className="w-12 h-12 text-green-300 mx-auto mb-3" />
          <p className="text-slate-500">Nenhum incidente registrado.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {incidents.map((inc) => (
            <div key={inc.id} className={`card p-5 ${inc.severity === 'critical' && inc.status === 'open' ? 'pulse-critical' : ''}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 cursor-pointer flex-1 min-w-0" onClick={() => setDetail(inc)}>
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${inc.severity === 'critical' ? 'bg-red-50' : inc.severity === 'warning' ? 'bg-amber-50' : 'bg-blue-50'}`}>
                    <Flame className={`w-5 h-5 ${inc.severity === 'critical' ? 'text-red-600' : inc.severity === 'warning' ? 'text-amber-600' : 'text-blue-600'}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900">{inc.title}</div>
                    <div className="text-sm text-slate-500 mt-0.5">{inc.description}</div>
                    <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-400">
                      <span>Edifício: {buildingName(inc.building_id)}</span>
                      <span>Aberto: {timeAgo(inc.opened_at)}</span>
                      {inc.response_time_sec !== null && <span>Resposta: {Math.floor(inc.response_time_sec / 60)}min {inc.response_time_sec % 60}s</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {statusBadge(inc.status)}
                </div>
              </div>
              {canAck && inc.status === 'open' && (
                <div className="flex gap-2 mt-4 pt-4 border-t border-slate-100">
                  <button className="btn-primary text-sm" onClick={() => acknowledge(inc)}><CheckCircle className="w-4 h-4" /> Reconhecer</button>
                </div>
              )}
              {canAck && inc.status === 'acknowledged' && (
                <div className="flex gap-2 mt-4 pt-4 border-t border-slate-100">
                  <button className="btn-secondary text-sm" onClick={() => resolve(inc)}><XCircle className="w-4 h-4" /> Resolver</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Detalhes do Incidente" size="lg">
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className={`badge ${severityColor(detail.severity)}`}>Severidade: {detail.severity}</span>
              {statusBadge(detail.status)}
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 text-lg">{detail.title}</h3>
              <p className="text-slate-600 mt-1">{detail.description}</p>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><div className="text-xs text-slate-400">Edifício</div><div className="text-slate-700">{buildingName(detail.building_id)}</div></div>
              <div><div className="text-xs text-slate-400">Aberto em</div><div className="text-slate-700">{formatDateTime(detail.opened_at)}</div></div>
              {detail.acknowledged_at && <div><div className="text-xs text-slate-400">Reconhecido em</div><div className="text-slate-700">{formatDateTime(detail.acknowledged_at)}</div></div>}
              {detail.resolved_at && <div><div className="text-xs text-slate-400">Resolvido em</div><div className="text-slate-700">{formatDateTime(detail.resolved_at)}</div></div>}
              {detail.response_time_sec !== null && <div><div className="text-xs text-slate-400">Tempo de resposta</div><div className="text-slate-700">{Math.floor(detail.response_time_sec / 60)}min {detail.response_time_sec % 60}s</div></div>}
            </div>
            {canAck && detail.status === 'open' && (
              <button className="btn-primary w-full" onClick={() => { acknowledge(detail); setDetail({ ...detail, status: 'acknowledged' }); }}><CheckCircle className="w-4 h-4" /> Reconhecer incidente</button>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
