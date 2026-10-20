import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db, GatewayInput, Gateway, Panel } from '@/lib/db';
import { PageHeader } from '@/components/PageHeader';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { EVENT_LABELS, eventTypeColor, formatDateTime, timeAgo } from '@/lib/eventHelpers';
import { Plus, Cable, Edit2, Trash2, Search } from 'lucide-react';
import { EventType } from '@/lib/eventHelpers';

const EVENT_TYPES: EventType[] = ['alarm', 'fault', 'supervisory', 'alarm_restore', 'fault_restore', 'comm_loss', 'comm_restore', 'gateway_fault'];

export function InputsPage() {
  const { profile } = useAuth();
  const isPlatformAdmin = profile?.role === 'platform_admin';
  const canEdit = isPlatformAdmin || profile?.role === 'tenant_admin' || profile?.role === 'operator';

  const [inputs, setInputs] = useState<GatewayInput[]>([]);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterGateway, setFilterGateway] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<GatewayInput | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<GatewayInput | null>(null);

  const [form, setForm] = useState({
    gateway_id: '', panel_id: '', input_number: 1, name: '', event_type: 'alarm' as EventType,
  });

  async function load() {
    setLoading(true);
    const iq = db.from('gateway_inputs').select('*').order('input_number');
    if (!isPlatformAdmin && profile?.tenant_id) iq.eq('tenant_id', profile.tenant_id);
    const { data } = await iq;
    setInputs((data ?? []) as GatewayInput[]);

    const gq = db.from('gateways').select('*').order('name');
    if (!isPlatformAdmin && profile?.tenant_id) gq.eq('tenant_id', profile.tenant_id);
    const { data: gData } = await gq;
    setGateways((gData ?? []) as Gateway[]);

    const pq = db.from('panels').select('*').order('manufacturer');
    if (!isPlatformAdmin && profile?.tenant_id) pq.eq('tenant_id', profile.tenant_id);
    const { data: pData } = await pq;
    setPanels((pData ?? []) as Panel[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [profile]);

  function openCreate() {
    setEditing(null);
    setForm({ gateway_id: '', panel_id: '', input_number: 1, name: '', event_type: 'alarm' });
    setModalOpen(true);
  }

  function openEdit(i: GatewayInput) {
    setEditing(i);
    setForm({ gateway_id: i.gateway_id, panel_id: i.panel_id ?? '', input_number: i.input_number, name: i.name, event_type: i.event_type as EventType });
    setModalOpen(true);
  }

  async function save() {
    if (!form.gateway_id || !form.name) return;
    const gw = gateways.find((g) => g.id === form.gateway_id);
    if (!gw) return;
    const payload = {
      ...form, tenant_id: gw.tenant_id, panel_id: form.panel_id || null,
    };
    if (editing) {
      await db.from('gateway_inputs').update(payload).eq('id', editing.id);
    } else {
      await db.from('gateway_inputs').insert({ ...payload, current_state: 'unknown' });
    }
    setModalOpen(false);
    load();
  }

  async function remove(i: GatewayInput) {
    await db.from('gateway_inputs').delete().eq('id', i.id);
    setConfirmDelete(null);
    load();
  }

  const gatewayName = (id: string) => gateways.find((g) => g.id === id)?.name ?? '—';

  const filtered = inputs.filter((i) => {
    const s = search.toLowerCase();
    const matchSearch = i.name.toLowerCase().includes(s) || gatewayName(i.gateway_id).toLowerCase().includes(s);
    const matchGw = !filterGateway || i.gateway_id === filterGateway;
    return matchSearch && matchGw;
  });

  const stateColor = (s: string) => {
    switch (s) {
      case 'active': return 'bg-red-100 text-red-700 border border-red-200';
      case 'normal': return 'bg-green-100 text-green-700 border border-green-200';
      case 'fault': return 'bg-amber-100 text-amber-700 border border-amber-200';
      default: return 'bg-slate-100 text-slate-500 border border-slate-200';
    }
  };

  const stateLabel = (s: string) => {
    switch (s) { case 'active': return 'Ativo'; case 'normal': return 'Normal'; case 'fault': return 'Falha'; default: return 'Desconhecido'; }
  };

  return (
    <>
      <PageHeader
        title="Canais e Entradas"
        subtitle="Entradas digitais isoladas dos gateways"
        actions={canEdit && <button className="btn-primary" onClick={openCreate}><Plus className="w-4 h-4" /> Nova Entrada</button>}
      />

      <div className="card mb-4 p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input className="input pl-10" placeholder="Buscar por nome ou gateway..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input sm:w-56" value={filterGateway} onChange={(e) => setFilterGateway(e.target.value)}>
          <option value="">Todos os gateways</option>
          {gateways.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <Cable className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">Nenhuma entrada cadastrada.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Entrada</th>
                  <th className="px-4 py-3 text-left font-medium">Gateway</th>
                  <th className="px-4 py-3 text-left font-medium">Tipo de Evento</th>
                  <th className="px-4 py-3 text-left font-medium">Estado Atual</th>
                  <th className="px-4 py-3 text-left font-medium">Última alteração</th>
                  {canEdit && <th className="px-4 py-3 text-right font-medium">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((i) => (
                  <tr key={i.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">#{i.input_number} — {i.name}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{gatewayName(i.gateway_id)}</td>
                    <td className="px-4 py-3"><span className={`badge ${eventTypeColor(i.event_type)}`}>{EVENT_LABELS[i.event_type as keyof typeof EVENT_LABELS]}</span></td>
                    <td className="px-4 py-3"><span className={`badge ${stateColor(i.current_state)}`}>{stateLabel(i.current_state)}</span></td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      <div>{formatDateTime(i.last_change_at)}</div>
                      <div className="text-slate-400">{timeAgo(i.last_change_at)}</div>
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button className="p-1.5 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600" onClick={() => openEdit(i)}><Edit2 className="w-4 h-4" /></button>
                          <button className="p-1.5 rounded text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => setConfirmDelete(i)}><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-slate-400 mt-4 max-w-3xl">
        Não interpretar automaticamente uma entrada desenergizada como ausência de incêndio. Estados desconhecidos, falhas e perda de comunicação devem ser diferenciados.
      </p>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar Entrada' : 'Nova Entrada'}
        footer={<><button className="btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar</button></>}
      >
        <div className="space-y-4">
          <div><label className="label">Gateway *</label>
            <select className="input" value={form.gateway_id} onChange={(e) => setForm({ ...form, gateway_id: e.target.value })}>
              <option value="">Selecione...</option>
              {gateways.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div><label className="label">Central associada</label>
            <select className="input" value={form.panel_id} onChange={(e) => setForm({ ...form, panel_id: e.target.value })}>
              <option value="">Nenhuma</option>
              {panels.map((p) => <option key={p.id} value={p.id}>{p.manufacturer} {p.model}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Número da entrada</label><input type="number" min={1} className="input" value={form.input_number} onChange={(e) => setForm({ ...form, input_number: parseInt(e.target.value) || 1 })} /></div>
            <div><label className="label">Tipo de evento</label>
              <select className="input" value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value as EventType })}>
                {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_LABELS[t]}</option>)}
              </select>
            </div>
          </div>
          <div><label className="label">Nome da entrada *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ex: Zona 1 - Alarme Geral" /></div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        title="Excluir entrada"
        message={`Confirma a exclusão da entrada "${confirmDelete?.name}"?`}
        confirmLabel="Excluir"
        danger
      />
    </>
  );
}
