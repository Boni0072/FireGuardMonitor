import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db, Panel, Building, Gateway, EventRow } from '@/lib/db';
import { useUnifiedEvents } from '@/hooks/useUnifiedEvents';
import { updateDoc, doc, deleteDoc, type UpdateData, type DocumentData } from 'firebase/firestore';
import { firestore } from '@/lib/firebase';
import { PageHeader } from '@/components/PageHeader';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { Plus, Search, CircuitBoard, Edit2, Trash2, Cpu, Wifi, ToggleRight } from 'lucide-react';
import { derivePanelConnectionStatus, PANEL_CONNECTION_META, PanelConnectionStatus } from '@/lib/eventHelpers';

const MANUFACTURERS = ['Intelbras', 'Segurimax', 'Siemens', 'Bosch', 'NOTIFIER'];

function filterEventsForTenant(events: EventRow[], tenantId: string | null | undefined): EventRow[] {
  if (!tenantId) return events;
  return events.filter((e) => e.tenant_id == null || e.tenant_id === '' || e.tenant_id === tenantId);
}

function computeConnectionStatusMap(
  panels: Panel[],
  gateways: Gateway[],
  events: EventRow[],
  tenantId: string | null | undefined,
): [Record<string, PanelConnectionStatus>, Record<string, string | null>] {
  const filtered = filterEventsForTenant(events, tenantId);
  const map: Record<string, PanelConnectionStatus> = {};
  const descricaoMap: Record<string, string | null> = {};
  for (const panel of panels) {
    const gateway = gateways.find((g) => g.panel_id === panel.id) ?? null;
    const panelEvents = filtered.filter((e) =>
      e.panel_id === panel.id ||
      (e.panel_id == null && (
        (e.conta != null && String(e.conta) === String(panel.asset_code ?? '')) ||
        (e.origem_ip != null && String(panel.ip_data ?? '').includes(String(e.origem_ip)))
      ))
    );
    map[panel.id] = derivePanelConnectionStatus(gateway, panelEvents);
    // Descricao: prioriza o evento que motiva o status (alarme ativo > falha ativa),
    // para o texto combinar com o status exibido. Sem problema ativo, fica null e
    // o badge exibe o label do status (ex: "Operacional").
    const activeAlarms = panelEvents.filter((e) => e.event_type === 'alarm' && e.state === 'active' && !e.acknowledged);
    const faults = panelEvents.filter((e) => ['fault', 'comm_loss', 'gateway_fault'].includes(e.event_type) && e.state !== 'normal');
    const source = activeAlarms[0] ?? faults[0] ?? null;
    descricaoMap[panel.id] = source?.descricao ?? null;
  }
  return [map, descricaoMap];
}

export function PanelsPage() {
  const { profile } = useAuth();
  const isPlatformAdmin = profile?.role === 'platform_admin';
  const canEdit = true;
  const canCreate = true;

  const [panels, setPanels] = useState<Panel[]>([]);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [connStatus, setConnStatus] = useState<Record<string, PanelConnectionStatus>>({});
  const [panelDescricao, setPanelDescricao] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Panel | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Panel | null>(null);
  const [ipError, setIpError] = useState<string | null>(null);

  // Fonte unica de eventos (colecoes `events` + `eventos` legado).
  const { events: unifiedEvents, mergeEvent } = useUnifiedEvents(500);

  const [form, setForm] = useState({
    building_id: '', manufacturer: 'Intelbras', model: '', asset_code: '',
    install_location: '', zone_count: 1, has_api: false, has_ethernet: false, has_ip: false, has_relay_output: false,
    interface_type: '', auxiliary_output_type: '', ip_data: '', sensor_ip: '', installer: '', notes: '', status: 'active',
  });

  async function load() {
    setLoading(true);
    const q = db.from('panels').select('*').order('created_at', { ascending: false });
    if (!isPlatformAdmin && profile?.tenant_id) q.eq('tenant_id', profile.tenant_id);
    const { data } = await q;
    const panelList = (data ?? []) as Panel[];
    setPanels(panelList);

    const bq = db.from('buildings').select('*').order('name');
    if (!isPlatformAdmin && profile?.tenant_id) bq.eq('tenant_id', profile.tenant_id);
    const { data: bData } = await bq;
    setBuildings((bData ?? []) as Building[]);

    // Conexao dos paineis: gateway + eventos unificados (events + eventos legados).
    const gq = db.from('gateways').select('*');
    if (!isPlatformAdmin && profile?.tenant_id) gq.eq('tenant_id', profile.tenant_id);
    const { data: gData } = await gq;
    setGateways((gData ?? []) as Gateway[]);

    setLoading(false);
  }

  useEffect(() => { load(); }, [profile]);

  // Realtime: atualiza o status de conexao de cada central conforme novos eventos
  // (colecoes `events` e legada `eventos`). O dedupe por external_event_id evita
  // duplicar quando o receptor grava nos dois lugares.
  useEffect(() => {
    if (!profile) return;
    const myTenant = profile.tenant_id;
    const admin = isPlatformAdmin;
    let alive = true;

    const applyEvent = (newEvent: EventRow) => {
      if (!alive) return;
      if (!admin && myTenant && newEvent.tenant_id != null && newEvent.tenant_id !== '' && newEvent.tenant_id !== myTenant) return;
      // Atualiza a fonte unica compartilhada (dedupe por external_event_id).
      mergeEvent(newEvent);
    };

    const channel = db
      .channel('panels-realtime')
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

  // Recalcula o status de conexao e a descricao do evento mais recente para cada
  // central, sempre que eventos, paineis ou gateways forem atualizados.
  useEffect(() => {
    if (!profile) return;
    const filtered = filterEventsForTenant(unifiedEvents, profile.tenant_id);
    const [statusMap, descricaoMap] = computeConnectionStatusMap(panels, gateways, filtered, profile.tenant_id);
    setConnStatus(statusMap);
    setPanelDescricao(descricaoMap);
  }, [unifiedEvents, panels, gateways, profile?.id, profile?.tenant_id, isPlatformAdmin]);

  function openCreate() {
    setEditing(null);
    setForm({
      building_id: '', manufacturer: 'Intelbras', model: '', asset_code: '',
      install_location: '', zone_count: 1, has_api: false, has_ethernet: false, has_ip: false, has_relay_output: false,
      interface_type: '', auxiliary_output_type: '', ip_data: '', sensor_ip: '', installer: '', notes: '', status: 'active',
    });
    setIpError(null);
    setModalOpen(true);
  }

  function openEdit(p: Panel) {
    setEditing(p);
    setForm({
      building_id: p.building_id, manufacturer: p.manufacturer, model: p.model, asset_code: p.asset_code ?? '',
      install_location: p.install_location ?? '', zone_count: p.zone_count, has_api: p.has_api,
      has_ethernet: p.has_ethernet, has_ip: p.has_ip, has_relay_output: p.has_relay_output,
      interface_type: p.interface_type ?? '', auxiliary_output_type: p.auxiliary_output_type ?? '', ip_data: p.ip_data ?? '',
      sensor_ip: p.sensor_ip ?? '',
      installer: p.installer ?? '', notes: p.notes ?? '', status: p.status,
    });
    setModalOpen(true);
  }

  async function save() {
    const ip = form.sensor_ip.trim();
    if (ip && !/^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(:\d{1,5})?$/.test(ip)) {
      setIpError('IP inválido. Use o formato 192.168.1.100 ou 192.168.1.100:5020.');
      return;
    }
    setIpError(null);
    if (!form.building_id || !form.model) return;
    const building = buildings.find((b) => b.id === form.building_id);
    if (!building) return;
    const payload = {
      ...form, tenant_id: building.tenant_id,
      installed_at: editing?.installed_at ?? null,
      sensor_ip: form.sensor_ip.trim() || null,
    };
    console.log('[PANELS] save() called', { editing, payload });
    try {
      if (editing) {
        console.log('[PANELS] updating panel id:', editing.id);
        await updateDoc(
          doc(firestore, 'panels', editing.id),
          payload as unknown as UpdateData<DocumentData>,
        );
      } else {
        await db.from('panels').insert(payload);
      }
      setModalOpen(false);
      load();
    } catch (err) {
      console.error('[PANELS] Erro ao salvar central:', err);
      const msg = err instanceof Error ? err.message : String(err);
      alert('Erro ao salvar central: ' + msg);
    }
  }

  async function remove(p: Panel) {
    console.log('[PANELS] remove() called', { id: p.id });
    try {
      await deleteDoc(doc(firestore, 'panels', p.id));
      setConfirmDelete(null);
      load();
    } catch (err) {
      console.error('[PANELS] Erro ao excluir central:', err);
      const msg = err instanceof Error ? err.message : String(err);
      alert('Erro ao excluir central: ' + msg);
    }
  }

  const filtered = panels.filter((p) => {
    const s = search.toLowerCase();
    return p.manufacturer.toLowerCase().includes(s) || p.model.toLowerCase().includes(s) || (p.asset_code ?? '').toLowerCase().includes(s);
  });

  const buildingName = (id: string) => buildings.find((b) => b.id === id)?.name ?? '—';

  return (
    <>
      <PageHeader
        title="Centrais de Incêndio"
        subtitle="Cadastro de centrais e suas interfaces disponíveis"
        actions={canCreate && <button className="btn-primary" onClick={openCreate}><Plus className="w-4 h-4" /> Nova Central</button>}
      />

      <div className="card mb-4 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input className="input pl-10" placeholder="Buscar por fabricante, modelo ou código..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <CircuitBoard className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">Nenhuma central cadastrada. Clique abaixo para cadastrar a primeira.</p>
          {canCreate && <button className="btn-primary mt-4" onClick={openCreate}><Plus className="w-4 h-4" /> Cadastrar central</button>}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Fabricante / Modelo</th>
                  <th className="px-4 py-3 text-left font-medium">Edifício</th>
                  <th className="px-4 py-3 text-left font-medium">Zonas</th>
                  <th className="px-4 py-3 text-left font-medium">Interfaces</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Conexão</th>
                  {canEdit && <th className="px-4 py-3 text-right font-medium">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{p.manufacturer} {p.model}</div>
                      <div className="text-xs text-slate-400">{p.asset_code || 'Sem código'}</div>
                      {p.sensor_ip && <div className="text-xs text-slate-500" title="IP para cadastrar no sensor (destino dos dados)">Sensor: {p.sensor_ip}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{buildingName(p.building_id)}</td>
                    <td className="px-4 py-3 text-slate-600">{p.zone_count}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        {p.has_api && <span title="API" className="badge bg-blue-50 text-blue-600 border border-blue-100"><Cpu className="w-3 h-3" />API</span>}
                        {p.has_ethernet && <span title="Ethernet" className="badge bg-green-50 text-green-600 border border-green-100"><Wifi className="w-3 h-3" />Eth</span>}
                        {p.has_relay_output && <span title="Relé" className="badge bg-amber-50 text-amber-600 border border-amber-100"><ToggleRight className="w-3 h-3" />Relé</span>}
                        {!p.has_api && !p.has_ethernet && !p.has_relay_output && <span className="text-xs text-slate-400">Nenhuma registrada</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${p.status === 'active' ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                        {p.status === 'active' ? 'Ativa' : p.status === 'maintenance' ? 'Manutenção' : 'Inativa'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const st = connStatus[p.id] ?? 'unknown';
                        const meta = PANEL_CONNECTION_META[st];
                        return (
                          <div className="space-y-0.5">
                            <span className={`badge ${meta.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} /> {panelDescricao[p.id] ?? meta.label}
                            </span>
                          </div>
                        );
                      })()}
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button className="p-1.5 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600" onClick={() => openEdit(p)} title="Editar central"><Edit2 className="w-4 h-4" /><span className="hidden sm:inline ml-1 text-xs font-medium text-slate-600">Editar</span></button>
                          <button className="p-1.5 rounded text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => setConfirmDelete(p)}><Trash2 className="w-4 h-4" /></button>
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

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar Central' : 'Nova Central'}
        size="lg"
        footer={<><button className="btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar</button></>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2"><label className="label">Edifício *</label>
            <select className="input" value={form.building_id} onChange={(e) => setForm({ ...form, building_id: e.target.value })}>
              <option value="">Selecione...</option>
              {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div><label className="label">Fabricante *</label>
            <select className="input" value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}>
              {MANUFACTURERS.map((m) => <option key={m} value={m}>{m}</option>)}
              <option value="outro">Outro</option>
            </select>
          </div>
          <div><label className="label">Modelo *</label><input className="input" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></div>
          <div><label className="label">Código patrimonial (conta Contact ID)</label><input className="input" value={form.asset_code} onChange={(e) => setForm({ ...form, asset_code: e.target.value })} placeholder="ex: 1234 — igual à conta do simulador" />
            <p className="text-xs text-slate-400 mt-1">Conta de 4 dígitos usada pelo simulador (--conta). O receptor vincula por este código ou pelo IP.</p>
          </div>
          <div><label className="label">Local de instalação</label><input className="input" value={form.install_location} onChange={(e) => setForm({ ...form, install_location: e.target.value })} /></div>
          <div><label className="label">Quantidade de zonas</label><input type="number" min={1} className="input" value={form.zone_count} onChange={(e) => setForm({ ...form, zone_count: parseInt(e.target.value) || 1 })} /></div>
          <div><label className="label">Responsável pela instalação</label><input className="input" value={form.installer} onChange={(e) => setForm({ ...form, installer: e.target.value })} /></div>
          <div className="sm:col-span-2">
            <label className="label">IP do sensor (destino dos dados)</label>
            <input
              className="input"
              value={form.sensor_ip}
              onChange={(e) => setForm({ ...form, sensor_ip: e.target.value })}
              placeholder="ex: 192.168.1.100 ou 192.168.1.100:5020"
            />
            <p className="text-xs text-slate-400 mt-1">
              IP/porta do receptor FireGuard para cadastrar no sensor/gateway desta central, para que ele envie os dados/sinais.
              Opcional. Diferente de &quot;Dados da interface IP&quot; abaixo (IP de origem, usado pelo receptor para vincular os eventos).
            </p>
            {ipError && <p className="text-xs text-red-600 mt-1">{ipError}</p>}
          </div>
          <div className="sm:col-span-2">
            <label className="label">Interfaces disponíveis</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.has_api} onChange={(e) => setForm({ ...form, has_api: e.target.checked })} /> API</label>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.has_ethernet} onChange={(e) => setForm({ ...form, has_ethernet: e.target.checked })} /> Ethernet</label>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.has_ip} onChange={(e) => setForm({ ...form, has_ip: e.target.checked })} /> IP</label>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.has_relay_output} onChange={(e) => setForm({ ...form, has_relay_output: e.target.checked })} /> Saída de Relé</label>
            </div>
            {form.has_ip && (
              <div className="mt-3">
                <label className="label">Dados da interface IP</label>
                <textarea className="input" rows={2} value={form.ip_data} onChange={(e) => setForm({ ...form, ip_data: e.target.value })} placeholder="ex: 192.168.1.50:5000 ou usuário:senha@ip:porta" />
                <p className="text-xs text-slate-400 mt-1">Informe o IP/porta da interface IP e o código da conta Contact ID (ex: conta 1234). O receptor usa o IP de origem e o asset_code para vincular os eventos a esta central.</p>
              </div>
            )}
            <p className="text-xs text-slate-400 mt-1">A disponibilidade de cada interface deve ser registrada e validada individualmente.</p>
          </div>
          <div><label className="label">Tipo de interface</label><input className="input" value={form.interface_type} onChange={(e) => setForm({ ...form, interface_type: e.target.value })} placeholder="ex: relay, ethernet+relay" /></div>
          <div><label className="label">Tipo de saída auxiliar</label><input className="input" value={form.auxiliary_output_type} onChange={(e) => setForm({ ...form, auxiliary_output_type: e.target.value })} placeholder="ex: dry_contact, ip" /></div>
          <div><label className="label">Status</label><select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="active">Ativa</option><option value="maintenance">Manutenção</option><option value="inactive">Inativa</option></select></div>
          {editing && (
            <div>
              <label className="label">Conexão</label>
              {(() => {
                const st = connStatus[editing.id] ?? 'unknown';
                const meta = PANEL_CONNECTION_META[st];
                const eventoNome = panelDescricao[editing.id] ?? null;
                return (
                  <span className={`badge ${meta.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} /> {eventoNome ?? meta.label}
                  </span>
                );
              })()}
              <p className="text-xs text-slate-400 mt-1">Status em tempo real, derivado do gateway e dos eventos recentes — não editável.</p>
            </div>
          )}
          <div className="sm:col-span-2"><label className="label">Observações técnicas</label><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        title="Excluir central"
        message={`Confirma a exclusão de "${confirmDelete?.manufacturer} ${confirmDelete?.model}"?`}
        confirmLabel="Excluir"
        danger
      />
    </>
  );
}

