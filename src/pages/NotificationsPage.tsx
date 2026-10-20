import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db, NotificationSubscription, Building } from '@/lib/db';
import { PageHeader } from '@/components/PageHeader';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { Bell, Plus, Edit2, Trash2, BellRing } from 'lucide-react';
import { formatDateTime } from '@/lib/eventHelpers';

const ALL_EVENT_TYPES = ['alarm', 'fault', 'supervisory', 'comm_loss', 'gateway_fault'];
const ALL_CHANNELS = ['push', 'email'];

export function NotificationsPage() {
  const { profile } = useAuth();
  const isPlatformAdmin = profile?.role === 'platform_admin';

  const [subs, setSubs] = useState<NotificationSubscription[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<NotificationSubscription | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<NotificationSubscription | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>('default');

  const [form, setForm] = useState({
    building_id: '', event_types: ['alarm', 'fault', 'comm_loss'] as string[],
    channels: ['push', 'email'] as string[], escalation_minutes: 15, active: true,
  });

  async function load() {
    setLoading(true);
    let q = db.from('notification_subscriptions').select('*').order('created_at', { ascending: false });
    if (!isPlatformAdmin) q = q.eq('user_id', profile?.id);
    const { data } = await q;
    setSubs((data ?? []) as NotificationSubscription[]);

    const bq = db.from('buildings').select('*').order('name');
    if (!isPlatformAdmin && profile?.tenant_id) bq.eq('tenant_id', profile.tenant_id);
    const { data: bData } = await bq;
    setBuildings((bData ?? []) as Building[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    if ('Notification' in window) setPermission(Notification.permission);
  }, [profile, isPlatformAdmin]);

  async function requestPermission() {
    if (!('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
  }

  function openCreate() {
    setEditing(null);
    setForm({ building_id: '', event_types: ['alarm', 'fault', 'comm_loss'], channels: ['push', 'email'], escalation_minutes: 15, active: true });
    setModalOpen(true);
  }

  function openEdit(s: NotificationSubscription) {
    setEditing(s);
    setForm({ building_id: s.building_id ?? '', event_types: s.event_types, channels: s.channels, escalation_minutes: s.escalation_minutes, active: s.active });
    setModalOpen(true);
  }

  async function save() {
    if (!profile) return;
    const payload = {
      tenant_id: profile.tenant_id, user_id: profile.id,
      building_id: form.building_id || null,
      event_types: form.event_types, channels: form.channels,
      escalation_minutes: form.escalation_minutes, active: form.active,
    };
    if (editing) {
      await db.from('notification_subscriptions').update(payload).eq('id', editing.id);
    } else {
      await db.from('notification_subscriptions').insert(payload);
    }
    setModalOpen(false);
    load();
  }

  async function remove(s: NotificationSubscription) {
    await db.from('notification_subscriptions').delete().eq('id', s.id);
    setConfirmDelete(null);
    load();
  }

  const toggleArray = (arr: string[], val: string) => arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];

  const buildingName = (id: string | null) => id ? buildings.find((b) => b.id === id)?.name ?? '—' : 'Todos os edifícios';

  return (
    <>
      <PageHeader
        title="Notificações"
        subtitle="Configuração de alertas e notificações push"
        actions={<button className="btn-primary" onClick={openCreate}><Plus className="w-4 h-4" /> Nova Inscrição</button>}
      />

      <div className="card p-5 mb-4">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
            <BellRing className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1">
            <div className="font-medium text-slate-900">Permissão de notificações do navegador</div>
            <p className="text-sm text-slate-500 mt-1">
              Push depende de permissões, navegador, sistema operacional, conectividade e disponibilidade do serviço.
              {permission === 'granted' ? ' Permissão concedida.' : permission === 'denied' ? ' Permissão negada — altere nas configurações do navegador.' : ' Permissão não solicitada.'}
            </p>
          </div>
          {permission !== 'granted' && (
            <button className="btn-secondary text-sm" onClick={requestPermission} disabled={permission === 'denied'}>
              {permission === 'denied' ? 'Bloqueado' : 'Permitir'}
            </button>
          )}
          {permission === 'granted' && <span className="badge bg-green-100 text-green-700 border border-green-200">Ativo</span>}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">Carregando...</div>
      ) : subs.length === 0 ? (
        <div className="card p-12 text-center">
          <Bell className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">Nenhuma inscrição de notificação configurada.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {subs.map((s) => (
            <div key={s.id} className="card p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${s.active ? 'bg-green-50' : 'bg-slate-100'}`}>
                    <Bell className={`w-5 h-5 ${s.active ? 'text-green-600' : 'text-slate-400'}`} />
                  </div>
                  <div>
                    <div className="font-medium text-slate-900">{buildingName(s.building_id)}</div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {s.event_types.map((et) => <span key={et} className="badge bg-blue-50 text-blue-600 border border-blue-100">{et}</span>)}
                    </div>
                    <div className="flex gap-3 mt-2 text-xs text-slate-400">
                      <span>Canais: {s.channels.join(', ')}</span>
                      <span>Escalonamento: {s.escalation_minutes}min</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge ${s.active ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>{s.active ? 'Ativa' : 'Inativa'}</span>
                  <button className="p-1.5 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600" onClick={() => openEdit(s)}><Edit2 className="w-4 h-4" /></button>
                  <button className="p-1.5 rounded text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => setConfirmDelete(s)}><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card p-4 mt-4">
        <p className="text-xs text-slate-400">
          O sistema diferencia notificação solicitada, envio confirmado pelo provedor, entrega conhecida e reconhecimento humano.
          Não afirmamos que um alerta foi visto sem confirmação. Escalonamento para responsáveis adicionais ocorre após prazo configurável.
        </p>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar Inscrição' : 'Nova Inscrição de Notificação'}
        footer={<><button className="btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar</button></>}
      >
        <div className="space-y-4">
          <div><label className="label">Edifício</label>
            <select className="input" value={form.building_id} onChange={(e) => setForm({ ...form, building_id: e.target.value })}>
              <option value="">Todos os edifícios</option>
              {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div><label className="label">Tipos de evento</label>
            <div className="flex flex-wrap gap-2">
              {ALL_EVENT_TYPES.map((et) => (
                <button key={et} type="button" onClick={() => setForm({ ...form, event_types: toggleArray(form.event_types, et) })}
                  className={`badge cursor-pointer ${form.event_types.includes(et) ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 border border-slate-200'}`}>{et}</button>
              ))}
            </div>
          </div>
          <div><label className="label">Canais</label>
            <div className="flex gap-2">
              {ALL_CHANNELS.map((ch) => (
                <button key={ch} type="button" onClick={() => setForm({ ...form, channels: toggleArray(form.channels, ch) })}
                  className={`badge cursor-pointer ${form.channels.includes(ch) ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 border border-slate-200'}`}>{ch}</button>
              ))}
            </div>
          </div>
          <div><label className="label">Escalonamento após (minutos)</label><input type="number" min={1} className="input" value={form.escalation_minutes} onChange={(e) => setForm({ ...form, escalation_minutes: parseInt(e.target.value) || 15 })} /></div>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Inscrição ativa</label>
        </div>
      </Modal>

      <ConfirmDialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={() => confirmDelete && remove(confirmDelete)} title="Excluir inscrição" message="Confirma a exclusão desta inscrição de notificação?" confirmLabel="Excluir" danger />
    </>
  );
}
