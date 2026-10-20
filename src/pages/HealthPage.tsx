import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db, Gateway, Building } from '@/lib/db';
import { PageHeader } from '@/components/PageHeader';
import { gatewayStatusColor, gatewayStatusLabel, timeAgo, formatDateTime } from '@/lib/eventHelpers';
import { HeartPulse, Wifi, WifiOff, AlertTriangle, Activity } from 'lucide-react';

export function HealthPage() {
  const { profile } = useAuth();
  const isPlatformAdmin = profile?.role === 'platform_admin';

  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const gq = db.from('gateways').select('*').order('name');
      if (!isPlatformAdmin && profile?.tenant_id) gq.eq('tenant_id', profile.tenant_id);
      const { data } = await gq;
      setGateways((data ?? []) as Gateway[]);

      const bq = db.from('buildings').select('*').order('name');
      if (!isPlatformAdmin && profile?.tenant_id) bq.eq('tenant_id', profile.tenant_id);
      const { data: bData } = await bq;
      setBuildings((bData ?? []) as Building[]);
      setLoading(false);
    }
    load();
  }, [profile, isPlatformAdmin]);

  const online = gateways.filter((g) => g.status === 'online').length;
  const degraded = gateways.filter((g) => g.status === 'degraded').length;
  const offline = gateways.filter((g) => g.status === 'offline').length;
  const total = gateways.length;
  const availability = total > 0 ? Math.round((online / total) * 100) : 0;

  const buildingName = (id: string) => buildings.find((b) => b.id === id)?.name ?? '—';

  return (
    <>
      <PageHeader title="Saúde da Comunicação" subtitle="Monitoramento de conectividade dos gateways" />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center"><Wifi className="w-5 h-5 text-green-600" /></div>
            <span className="text-sm text-slate-500">Online</span>
          </div>
          <div className="text-3xl font-bold text-slate-900">{online}</div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-amber-600" /></div>
            <span className="text-sm text-slate-500">Degradados</span>
          </div>
          <div className="text-3xl font-bold text-slate-900">{degraded}</div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center"><WifiOff className="w-5 h-5 text-red-600" /></div>
            <span className="text-sm text-slate-500">Offline</span>
          </div>
          <div className="text-3xl font-bold text-slate-900">{offline}</div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center"><Activity className="w-5 h-5 text-blue-600" /></div>
            <span className="text-sm text-slate-500">Disponibilidade</span>
          </div>
          <div className="text-3xl font-bold text-slate-900">{availability}%</div>
        </div>
      </div>

      {/* Availability bar */}
      <div className="card p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <HeartPulse className="w-5 h-5 text-blue-600" />
          <h3 className="font-semibold text-slate-900">Disponibilidade geral dos gateways</h3>
        </div>
        <div className="w-full h-6 rounded-full bg-slate-100 overflow-hidden flex">
          {online > 0 && <div className="bg-green-500" style={{ width: `${(online / total) * 100}%` }} title={`${online} online`} />}
          {degraded > 0 && <div className="bg-amber-500" style={{ width: `${(degraded / total) * 100}%` }} title={`${degraded} degradados`} />}
          {offline > 0 && <div className="bg-red-500" style={{ width: `${(offline / total) * 100}%` }} title={`${offline} offline`} />}
        </div>
        <div className="flex gap-4 mt-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" /> Online ({online})</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" /> Degradado ({degraded})</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" /> Offline ({offline})</span>
        </div>
      </div>

      {/* Detail table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="text-center py-12 text-slate-400">Carregando...</div>
          ) : gateways.length === 0 ? (
            <div className="text-center py-12 text-slate-400">Nenhum gateway cadastrado.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Gateway</th>
                  <th className="px-4 py-3 text-left font-medium">Edifício</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Último heartbeat</th>
                  <th className="px-4 py-3 text-left font-medium">Limite offline</th>
                  <th className="px-4 py-3 text-left font-medium">Início indisponibilidade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {gateways.map((g) => (
                  <tr key={g.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3"><div className="font-medium text-slate-800">{g.name}</div><div className="text-xs text-slate-400">{g.device_code}</div></td>
                    <td className="px-4 py-3 text-slate-600">{buildingName(g.building_id)}</td>
                    <td className="px-4 py-3"><span className={`badge ${gatewayStatusColor(g.status)}`}>{gatewayStatusLabel(g.status)}</span></td>
                    <td className="px-4 py-3 text-xs text-slate-500"><div>{formatDateTime(g.last_heartbeat_at)}</div><div className="text-slate-400">{timeAgo(g.last_heartbeat_at)}</div></td>
                    <td className="px-4 py-3 text-slate-600">{g.offline_threshold_sec}s</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{g.downtime_started_at ? formatDateTime(g.downtime_started_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-400 mt-4 max-w-3xl">
        Não classifique um edifício como seguro simplesmente porque o gateway está online. A plataforma indica que está recebendo dados, sem afirmar a ausência de incêndio.
        Online: heartbeat recente. Degradado: atraso acima do limite. Offline: ausência além do limite. Recuperado: novo heartbeat válido após período offline.
      </p>
    </>
  );
}
