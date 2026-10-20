import { useEffect, useRef, useState } from 'react';
import { updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { firestore } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { db, Building, Tenant } from '@/lib/db';
import { PageHeader } from '@/components/PageHeader';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { Plus, Search, Building2, Edit2, Trash2, MapPin, ImagePlus } from 'lucide-react';

// Limite do documento Firestore (~1MiB): guarda folga para os demais campos
// do edificio. O base64 ocupa ~1,33x o binario, entao o corte e por tamanho
// do data URL (900k chars ≈ 675KB de binario).
const MAX_AVATAR_BASE64_CHARS = 900_000;

// Converte um arquivo de imagem em base64 (data URL) para salvar o avatar
// no documento do edificio no Firestore. Se passar do limite, reencodifica
// via canvas (max 512px, JPEG 0.85) para caber no limite de 1MiB.
function fileToAvatarBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      if (dataUrl.length <= MAX_AVATAR_BASE64_CHARS) {
        resolve(dataUrl);
        return;
      }
      const img = new Image();
      img.onload = () => {
        const maxSide = 512;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas indisponível neste navegador.'));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL('image/jpeg', 0.85);
        if (compressed.length > MAX_AVATAR_BASE64_CHARS) {
          reject(new Error('Imagem muito grande mesmo após a compressão. Escolha uma foto menor.'));
          return;
        }
        resolve(compressed);
      };
      img.onerror = () => reject(new Error('Arquivo de imagem inválido.'));
      img.src = dataUrl;
    };
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

export function BuildingsPage() {
  const { profile } = useAuth();
  const isPlatformAdmin = profile?.role === 'platform_admin';
  const canEdit = true;
  const canCreate = true;

  const [buildings, setBuildings] = useState<Building[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Building | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Building | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: '', internal_code: '', address: '', city: '', state: '',
    latitude: '', longitude: '',
    technical_contact: '', operational_contact: '', notes: '', status: 'active',
    tenant_id: profile?.tenant_id ?? '',
    avatar_url: '',
  });

  async function load() {
    setLoading(true);
    const query = db.from('buildings').select('*').order('created_at', { ascending: false });
    if (!isPlatformAdmin && profile?.tenant_id) query.eq('tenant_id', profile.tenant_id);
    const { data } = await query;
    setBuildings((data ?? []) as Building[]);
    if (isPlatformAdmin) {
      const { data: tData } = await db.from('tenants').select('*').order('name');
      setTenants((tData ?? []) as Tenant[]);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [profile]);

  function openCreate() {
    setEditing(null);
    setForm({
      name: '', internal_code: '', address: '', city: '', state: '',
      latitude: '', longitude: '',
      technical_contact: '', operational_contact: '', notes: '', status: 'active',
      tenant_id: profile?.tenant_id ?? '',
      avatar_url: '',
    });
    setModalOpen(true);
  }

  function openEdit(b: Building) {
    console.log('[BUILDINGS] openEdit called', { b });
    setEditing(b);
    setForm({
      name: b.name, internal_code: b.internal_code ?? '', address: b.address ?? '',
      city: b.city ?? '', state: b.state ?? '',
      latitude: b.latitude != null ? String(b.latitude) : '', longitude: b.longitude != null ? String(b.longitude) : '',
      technical_contact: b.technical_contact ?? '',
      operational_contact: b.operational_contact ?? '', notes: b.notes ?? '', status: b.status,
      tenant_id: b.tenant_id,
      avatar_url: b.avatar_url ?? '',
    });
    setModalOpen(true);
  }

  async function pickAvatar(file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Selecione um arquivo de imagem (PNG, JPG, WEBP...).');
      return;
    }
    try {
      const avatar = await fileToAvatarBase64(file);
      setForm((prev) => ({ ...prev, avatar_url: avatar }));
    } catch (err) {
      alert('Erro ao processar a imagem: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  }

  async function save() {
    if (!form.name) return;
    const latitude = form.latitude ? parseFloat(form.latitude) : null;
    const longitude = form.longitude ? parseFloat(form.longitude) : null;
    if (latitude !== null && (!Number.isFinite(latitude) || Math.abs(latitude) > 90)) {
      alert('Latitude inválida: deve estar entre -90 e 90.\nVerifique se o ponto decimal foi perdido (ex.: -23540831 → -23.540831).');
      return;
    }
    if (longitude !== null && (!Number.isFinite(longitude) || Math.abs(longitude) > 180)) {
      alert('Longitude inválida: deve estar entre -180 e 180.\nVerifique se o ponto decimal foi perdido (ex.: -46486573 → -46.486573).');
      return;
    }
    const payload: Record<string, string | number | null> = { ...form, latitude, longitude, panel_count: 0 };
    console.log('[BUILDINGS] save() called', { editing, payload });
    try {
      if (editing) {
        console.log('[BUILDINGS] updating building id:', editing.id);
        await updateDoc(doc(firestore, 'buildings', editing.id), payload);
      } else {
        await db.from('buildings').insert(payload);
      }
      setModalOpen(false);
      load();
    } catch (err) {
      console.error('[BUILDINGS] Erro ao salvar edifício:', err);
      alert('Erro ao salvar edifício: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function remove(b: Building) {
    console.log('[BUILDINGS] remove() called', { id: b.id });
    try {
      await deleteDoc(doc(firestore, 'buildings', b.id));
      setConfirmDelete(null);
      load();
    } catch (err) {
      console.error('[BUILDINGS] Erro ao excluir edifício:', err);
      alert('Erro ao excluir edifício: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  const filtered = buildings.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase()) ||
    (b.internal_code ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (b.city ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      active: 'bg-green-100 text-green-700 border border-green-200',
      inactive: 'bg-slate-100 text-slate-500 border border-slate-200',
      suspended: 'bg-red-100 text-red-700 border border-red-200',
    };
    return map[s] ?? map.active;
  };

  return (
    <>
      <PageHeader
        title="Edifícios"
        subtitle="Cadastro e gestão de edifícios monitorados"
        actions={canCreate && <button className="btn-primary" onClick={openCreate}><Plus className="w-4 h-4" /> Novo Edifício</button>}
      />

      <div className="card mb-4 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input className="input pl-10" placeholder="Buscar por nome, código ou cidade..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">Nenhum edifício cadastrado.</p>
          {canCreate && <button className="btn-primary mt-4" onClick={openCreate}><Plus className="w-4 h-4" /> Cadastrar primeiro edifício</button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((b) => (
            <div key={b.id} className="card card-hover p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center overflow-hidden shrink-0">
                    {b.avatar_url ? (
                      <img src={b.avatar_url} alt={b.name} className="w-full h-full object-cover" />
                    ) : (
                      <Building2 className="w-5 h-5 text-blue-600" />
                    )}
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900">{b.name}</div>
                    <div className="text-xs text-slate-400">{b.internal_code || 'Sem código'}</div>
                  </div>
                </div>
                <span className={`badge ${statusBadge(b.status)}`}>{b.status === 'active' ? 'Ativo' : b.status === 'suspended' ? 'Suspensó' : 'Inativo'}</span>
              </div>
              <div className="space-y-1.5 text-sm text-slate-600">
                {(b.address || b.city) && (
                  <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-slate-400" />{[b.address, b.city, b.state].filter(Boolean).join(', ')}</div>
                )}
                {b.technical_contact && <div className="text-slate-500">Resp. técnico: {b.technical_contact}</div>}
                <div className="text-slate-500">{b.panel_count} central(is)</div>
              </div>
              {canEdit && (
                <div className="flex gap-2 mt-4 pt-4 border-t border-slate-100">
                  <button className="btn-ghost text-sm flex-1" onClick={() => openEdit(b)}><Edit2 className="w-4 h-4" /> Editar</button>
                  <button className="btn-ghost text-sm text-red-600 hover:bg-red-50" onClick={() => setConfirmDelete(b)}><Trash2 className="w-4 h-4" /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar Edifício' : 'Novo Edifício'}
        size="lg"
        footer={<><button className="btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar</button></>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {isPlatformAdmin && (
            <div className="sm:col-span-2">
              <label className="label">Empresa</label>
              <select className="input" value={form.tenant_id} onChange={(e) => setForm({ ...form, tenant_id: e.target.value })}>
                <option value="">Selecione...</option>
                {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          <div className="sm:col-span-2">
            <label className="label">Foto do edifício (avatar)</label>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center overflow-hidden shrink-0">
                {form.avatar_url ? (
                  <img src={form.avatar_url} alt="Avatar do edifício" className="w-full h-full object-cover" />
                ) : (
                  <Building2 className="w-7 h-7 text-blue-600" />
                )}
              </div>
              <div className="flex flex-col items-start gap-2">
                <div className="flex gap-2">
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => pickAvatar(e.target.files?.[0])}
                  />
                  <button type="button" className="btn-secondary text-sm" onClick={() => avatarInputRef.current?.click()}>
                    <ImagePlus className="w-4 h-4" /> Escolher foto
                  </button>
                  {form.avatar_url && (
                    <button type="button" className="btn-ghost text-sm text-red-600 hover:bg-red-50" onClick={() => setForm({ ...form, avatar_url: '' })}>
                      Remover
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-400">PNG, JPG ou WEBP • a imagem é convertida em base64 e salva no Firestore (máx. ~650KB)</p>
              </div>
            </div>
          </div>
          <div><label className="label">Nome do edifício *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label">Código interno</label><input className="input" value={form.internal_code} onChange={(e) => setForm({ ...form, internal_code: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className="label">Endereço</label><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div><label className="label">Cidade</label><input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
          <div><label className="label">Estado</label><input className="input" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
          <div><label className="label">Latitude</label><input type="number" step="any" className="input" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} /></div>
          <div><label className="label">Longitude</label><input type="number" step="any" className="input" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} /></div>
          <div><label className="label">Responsável técnico</label><input className="input" value={form.technical_contact} onChange={(e) => setForm({ ...form, technical_contact: e.target.value })} /></div>
          <div><label className="label">Contato operacional</label><input className="input" value={form.operational_contact} onChange={(e) => setForm({ ...form, operational_contact: e.target.value })} /></div>
          <div><label className="label">Status</label><select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="active">Ativo</option><option value="inactive">Inativo</option><option value="suspended">Suspenso</option></select></div>
          <div className="sm:col-span-2"><label className="label">Observações</label><textarea className="input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        title="Excluir edifício"
        message={`Confirma a exclusão de "${confirmDelete?.name}"? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        danger
      />
    </>
  );
}
