import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db, Gateway, Building, Panel } from '@/lib/db';
import { PageHeader } from '@/components/PageHeader';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { gatewayStatusColor, gatewayStatusLabel, timeAgo } from '@/lib/eventHelpers';
import { Plus, Search, Radio, Edit2, Trash2, Wifi, WifiOff, Activity } from 'lucide-react';

export function GatewaysPage() {
  const { profile } = useAuth();
  const isPlatformAdmin = profile?.role === 'platform_admin';
  const canEdit = isPlatformAdmin || profile?.role === 'tenant_admin';

  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Gateway | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Gateway | null>(null);

  const [form, setForm] = useState({
    building_id: '', panel_id: '', name: '', device_code: '', manufacturer: 'FireGuard',
    model: '', unique_identifier: '', connectivity_type: 'ethernet', firmware_version: '',
    config_version: '', input_count: 4, heartbeat_interval_sec: 30, offline_threshold_sec: 90,
  });

  async function load() {
    setLoading(true);
    const q = db.from('gateways').select('*').order('created_at', { ascending: false });
    if (!isPlatformAdmin && profile?.tenant_id) q.eq('tenant_id', profile.tenant_id);
    const { data } = await q;
    setGateways((data ?? []) as Gateway[]);

    const bq = db.from('buildings').select('*').order('name');
    if (!isPlatformAdmin && profile?.tenant_id) bq.eq('tenant_id', profile.tenant_id);
    const { data: bData } = await bq;
    setBuildings((bData ?? []) as Building[]);

    const pq = db.from('panels').select('*').order('manufacturer');
    if (!isPlatformAdmin && profile?.tenant_id) pq.eq('tenant_id', profile.tenant_id);
    const { data: pData } = await pq;
    setPanels((pData ?? []) as Panel[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [profile]);

  function openCreate() {
    setEditing(null);
    setForm({
      building_id: '', panel_id: '', name: '', device_code: '', manufacturer: 'FireGuard',
      model: '', unique_identifier: '', connectivity_type: 'ethernet', firmware_version: '',
      config_version: '', input_count: 4, heartbeat_interval_sec: 30, offline_threshold_sec: 90,
    });
    setModalOpen(true);
  }

  function openEdit(g: Gateway) {
    setEditing(g);
    setForm({
      building_id: g.building_id, panel_id: g.panel_id ?? '', name: g.name, device_code: g.device_code,
      manufacturer: g.manufacturer ?? 'FireGuard', model: g.model ?? '', unique_identifier: g.unique_identifier ?? '',
      connectivity_type: g.connectivity_type, firmware_version: g.firmware_version ?? '', config_version: g.config_version ?? '',
      input_count: g.input_count, heartbeat_interval_sec: g.heartbeat_interval_sec, offline_threshold_sec: g.offline_threshold_sec,
    });
    setModalOpen(true);
  }

  async function save() {
    if (!form.building_id || !form.name || !form.device_code) return;
    const building = buildings.find((b) => b.id === form.building_id);
    if (!building) return;
    const payload = {
      ...form, tenant_id: building.tenant_id,
      panel_id: form.panel_id || null,
    };
    if (editing) {
      await db.from('gateways').update(payload).eq('id', editing.id);
    } else {
      await db.from('gateways').insert({ ...payload, status: 'offline', provisioned: false });
    }
    setModalOpen(false);
    load();
  }

  async function remove(g: Gateway) {
    await db.from('gateways').delete().eq('id', g.id);
    setConfirmDelete(null);
    load();
  }

  const filtered = gateways.filter((g) => {
    const s = search.toLowerCase();
    return g.name.toLowerCase().includes(s) || g.device_code.toLowerCase().includes(s) || (g.unique_identifier ?? '').toLowerCase().includes(s);
  });

  const buildingName = (id: string) => buildings.find((b) => b.id === id)?.name ?? '—';

  return (
    <>
      <PageHeader
        title="Gateways"
        subtitle="Dispositivos de monitoramento conectados às centrais"
        actions={canEdit && <button className="btn-primary" onClick={openCreate}><Plus className="w-4 h-4" /> Novo Gateway</button>}
      />

      <div className="card mb-4 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input className="input pl-10" placeholder="Buscar por nome, código ou identificador..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <Radio className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">Nenhum gateway cadastrado.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((g) => (
            <div key={g.id} className="card card-hover p-5">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${g.status === 'online' ? 'bg-green-50' : g.status === 'offline' ? 'bg-red-50' : 'bg-amber-50'}`}>
                    {g.status === 'online' ? <Wifi className="w-5 h-5 text-green-600" /> : g.status === 'offline' ? <WifiOff className="w-5 h-5 text-red-600" /> : <Activity className="w-5 h-5 text-amber-600" />}
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900">{g.name}</div>
                    <div className="text-xs text-slate-400">{g.device_code} · {buildingName(g.building_id)}</div>
                  </div>
                </div>
                <span className={`badge ${gatewayStatusColor(g.status)}`}>{gatewayStatusLabel(g.status)}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-slate-400">Conectividade</div>
                  <div className="text-slate-700 capitalize">{g.connectivity_type}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Entradas</div>
                  <div className="text-slate-700">{g.input_count} canais</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Último heartbeat</div>
                  <div className="text-slate-700">{timeAgo(g.last_heartbeat_at)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Firmware</div>
                  <div className="text-slate-700">{g.firmware_version || '—'}</div>
                </div>
              </div>

              {canEdit && (
                <div className="flex gap-2 mt-4 pt-4 border-t border-slate-100">
                  <button className="btn-ghost text-sm flex-1" onClick={() => openEdit(g)}><Edit2 className="w-4 h-4" /> Editar</button>
                  <button className="btn-ghost text-sm text-red-600 hover:bg-red-50" onClick={() => setConfirmDelete(g)}><Trash2 className="w-4 h-4" /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar Gateway' : 'Novo Gateway'}
        size="lg"
        footer={<><button className="btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar</button></>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2"><label className="label">Edifício *</label>
            <select className="input" value={form.building_id} onChange={(e) => setForm({ ...form, building_id: e.target.value, panel_id: '' })}>
              <option value="">Selecione...</option>
              {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2"><label className="label">Central associada</label>
            <select className="input" value={form.panel_id} onChange={(e) => setForm({ ...form, panel_id: e.target.value })}>
              <option value="">Nenhuma</option>
              {panels.filter((p) => !form.building_id || p.building_id === form.building_id).map((p) => <option key={p.id} value={p.id}>{p.manufacturer} {p.model}</option>)}
            </select>
          </div>
          <div><label className="label">Nome *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label">Código do dispositivo *</label><input className="input" value={form.device_code} onChange={(e) => setForm({ ...form, device_code: e.target.value })} /></div>
          <div><label className="label">Fabricante</label><input className="input" value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} /></div>
          <div><label className="label">Modelo</label><input className="input" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></div>
          <div><label className="label">Identificador exclusivo</label><input className="input" value={form.unique_identifier} onChange={(e) => setForm({ ...form, unique_identifier: e.target.value })} /></div>
          <div><label className="label">Tipo de conectividade</label>
            <select className="input" value={form.connectivity_type} onChange={(e) => setForm({ ...form, connectivity_type: e.target.value })}>
              <option value="ethernet">Ethernet</option><option value="wifi">Wi-Fi</option><option value="cellular">Celular</option><option value="other">Outra</option>
            </select>
          </div>
          <div><label className="label">Versão do firmware</label><input className="input" value={form.firmware_version} onChange={(e) => setForm({ ...form, firmware_version: e.target.value })} /></div>
          <div><label className="label">Versão da configuração</label><input className="input" value={form.config_version} onChange={(e) => setForm({ ...form, config_version: e.target.value })} /></div>
          <div><label className="label">Número de entradas</label><input type="number" min={1} className="input" value={form.input_count} onChange={(e) => setForm({ ...form, input_count: parseInt(e.target.value) || 4 })} /></div>
          <div><label className="label">Intervalo heartbeat (s)</label><input type="number" min={10} className="input" value={form.heartbeat_interval_sec} onChange={(e) => setForm({ ...form, heartbeat_interval_sec: parseInt(e.target.value) || 30 })} /></div>
          <div><label className="label">Limite offline (s)</label><input type="number" min={30} className="input" value={form.offline_threshold_sec} onChange={(e) => setForm({ ...form, offline_threshold_sec: parseInt(e.target.value) || 90 })} /></div>
        </div>
        <p className="text-xs text-slate-400 mt-3">O provisionamento seguro de dispositivos usa autenticação individual e credenciais rotativas. Nunca utilize segredos compartilhados embutidos no frontend.</p>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        title="Excluir gateway"
        message={`Confirma a exclusão de "${confirmDelete?.name}"?`}
        confirmLabel="Excluir"
        danger
      />
    </>
  );
}
