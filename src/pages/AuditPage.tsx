import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db, AuditLog } from '@/lib/db';
import { PageHeader } from '@/components/PageHeader';
import { Shield, Search } from 'lucide-react';
import { formatDateTime } from '@/lib/eventHelpers';

export function AuditPage() {
  const { profile } = useAuth();
  const isPlatformAdmin = profile?.role === 'platform_admin';

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      let q = db.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200);
      if (!isPlatformAdmin && profile?.tenant_id) q = q.eq('tenant_id', profile.tenant_id);
      const { data } = await q;
      setLogs((data ?? []) as AuditLog[]);
      setLoading(false);
    }
    load();
  }, [profile, isPlatformAdmin]);

  const filtered = logs.filter((l) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return l.action.toLowerCase().includes(s) || (l.entity_type ?? '').toLowerCase().includes(s);
  });

  return (
    <>
      <PageHeader title="Histórico e Auditoria" subtitle="Registro de ações administrativas" />

      <div className="card mb-4 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input className="input pl-10" placeholder="Buscar por ação ou entidade..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="text-center py-12 text-slate-400">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <Shield className="w-10 h-10 mx-auto mb-2 text-slate-300" />
              <p className="text-slate-400">Nenhum registro de auditoria encontrado.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Data/Hora</th>
                  <th className="px-4 py-3 text-left font-medium">Ação</th>
                  <th className="px-4 py-3 text-left font-medium">Entidade</th>
                  <th className="px-4 py-3 text-left font-medium">Detalhes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(log.created_at)}</td>
                    <td className="px-4 py-3 font-medium text-slate-700">{log.action}</td>
                    <td className="px-4 py-3 text-slate-600">{log.entity_type ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {log.details ? <pre className="whitespace-pre-wrap font-mono text-xs max-w-md truncate">{JSON.stringify(log.details)}</pre> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
