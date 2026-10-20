import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db, Tenant, Profile, UserRole } from '@/lib/db';
import { PageHeader } from '@/components/PageHeader';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { Plus, Users, Edit2, Trash2, Building2, Shield } from 'lucide-react';
import { formatDateTime } from '@/lib/eventHelpers';

export function TenantsPage() {
  const { profile, refreshProfile } = useAuth();
  const isPlatformAdmin = profile?.role === 'platform_admin';

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'tenants' | 'users'>('tenants');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Tenant | null>(null);

  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);

  const [form, setForm] = useState({
    name: '', legal_name: '', document: '', plan: 'starter', status: 'active',
    contact_email: '', contact_phone: '', max_buildings: 10,
  });

  const [userForm, setUserForm] = useState({
    id: '', full_name: '', email: '', role: 'viewer' as UserRole, tenant_id: '', phone: '', status: 'active',
  });

  const [formError, setFormError] = useState<string | null>(null);
  const [userFormError, setUserFormError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data: tData } = await db.from('tenants').select('*').order('name');
    setTenants((tData ?? []) as Tenant[]);

    let pQuery = db.from('profiles').select('*').order('created_at', { ascending: false });
    if (!isPlatformAdmin && profile?.tenant_id) pQuery = pQuery.eq('tenant_id', profile.tenant_id);
    const { data: pData } = await pQuery;
    setProfiles((pData ?? []) as Profile[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [profile, isPlatformAdmin]);

  function openCreateTenant() {
    setEditing(null);
    setForm({ name: '', legal_name: '', document: '', plan: 'starter', status: 'active', contact_email: '', contact_phone: '', max_buildings: 10 });
    setFormError(null);
    setModalOpen(true);
  }

  function openEditTenant(t: Tenant) {
    setEditing(t);
    setForm({ name: t.name, legal_name: t.legal_name ?? '', document: t.document ?? '', plan: t.plan, status: t.status, contact_email: t.contact_email ?? '', contact_phone: t.contact_phone ?? '', max_buildings: t.max_buildings });
    setFormError(null);
    setModalOpen(true);
  }

  async function saveTenant() {
    setFormError(null);
    if (!form.name.trim()) {
      setFormError('Informe o nome da empresa.');
      return;
    }
    try {
      if (editing) {
        await db.from('tenants').update(form).eq('id', editing.id);
      } else {
        await db.from('tenants').insert(form);
      }
    } catch (err) {
      console.error('[TENANTS] Erro ao salvar empresa:', err);
      setFormError('Erro ao salvar empresa: ' + (err instanceof Error ? err.message : String(err)));
      return;
    }
    setModalOpen(false);
    load();
  }

  async function removeTenant(t: Tenant) {
    try {
      await db.from('tenants').delete().eq('id', t.id);
    } catch (err) {
      console.error('[TENANTS] Erro ao excluir empresa:', err);
      alert('Erro ao excluir empresa: ' + (err instanceof Error ? err.message : String(err)));
      return;
    }
    setConfirmDelete(null);
    load();
  }

  function openEditUser(p: Profile) {
    setEditingUser(p);
    setUserForm({ id: p.id, full_name: p.full_name, email: p.email, role: p.role, tenant_id: p.tenant_id ?? '', phone: p.phone ?? '', status: p.status });
    setUserFormError(null);
    setUserModalOpen(true);
  }

  async function saveUser() {
    setUserFormError(null);
    if (!editingUser) return;
    const updates = { full_name: userForm.full_name, role: userForm.role, phone: userForm.phone, status: userForm.status, tenant_id: userForm.tenant_id || null };
    try {
      await db.from('profiles').update(updates).eq('id', editingUser.id);
    } catch (err) {
      console.error('[TENANTS] Erro ao salvar usuário:', err);
      setUserFormError('Erro ao salvar usuário: ' + (err instanceof Error ? err.message : String(err)));
      return;
    }
    if (editingUser.id === profile?.id) await refreshProfile();
    setUserModalOpen(false);
    load();
  }

  const roleBadge = (r: UserRole) => {
    const map: Record<UserRole, string> = {
      platform_admin: 'bg-blue-100 text-blue-700 border border-blue-200',
      tenant_admin: 'bg-indigo-100 text-indigo-700 border border-indigo-200',
      operator: 'bg-green-100 text-green-700 border border-green-200',
      viewer: 'bg-slate-100 text-slate-600 border border-slate-200',
    };
    const labels: Record<UserRole, string> = { platform_admin: 'Admin Plataforma', tenant_admin: 'Admin Cliente', operator: 'Operador', viewer: 'Visualizador' };
    return <span className={`badge ${map[r]}`}>{labels[r]}</span>;
  };

  const tenantName = (id: string | null) => tenants.find((t) => t.id === id)?.name ?? '—';

  return (
    <>
      <PageHeader
        title="Empresas e Usuários"
        subtitle="Gestão de empresas clientes e usuários do sistema"
        actions={isPlatformAdmin && tab === 'tenants' && <button className="btn-primary" onClick={openCreateTenant}><Plus className="w-4 h-4" /> Nova Empresa</button>}
      />

      <div className="flex gap-1 mb-4 bg-white p-1 rounded-lg border border-slate-200 w-fit">
        <button className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'tenants' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`} onClick={() => setTab('tenants')}>Empresas</button>
        <button className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'users' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`} onClick={() => setTab('users')}>Usuários</button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">Carregando...</div>
      ) : tab === 'tenants' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tenants.map((t) => (
            <div key={t.id} className="card card-hover p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#101828] flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900">{t.name}</div>
                    <div className="text-xs text-slate-400">{t.document || 'Sem CNPJ'}</div>
                  </div>
                </div>
                <span className={`badge ${t.status === 'active' ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>{t.status === 'active' ? 'Ativa' : 'Inativa'}</span>
              </div>
              <div className="space-y-1.5 text-sm text-slate-600">
                <div className="flex justify-between"><span className="text-slate-400">Plano</span><span className="capitalize">{t.plan}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Máx. edifícios</span><span>{t.max_buildings}</span></div>
                {t.contact_email && <div className="flex justify-between"><span className="text-slate-400">Contato</span><span className="truncate ml-2">{t.contact_email}</span></div>}
              </div>
              {isPlatformAdmin && (
                <div className="flex gap-2 mt-4 pt-4 border-t border-slate-100">
                  <button className="btn-ghost text-sm flex-1" onClick={() => openEditTenant(t)}><Edit2 className="w-4 h-4" /> Editar</button>
                  <button className="btn-ghost text-sm text-red-600 hover:bg-red-50" onClick={() => setConfirmDelete(t)}><Trash2 className="w-4 h-4" /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Usuário</th>
                  <th className="px-4 py-3 text-left font-medium">Empresa</th>
                  <th className="px-4 py-3 text-left font-medium">Função</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Criado em</th>
                  <th className="px-4 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {profiles.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-semibold shrink-0">{(p.full_name || p.email).charAt(0).toUpperCase()}</div>
                        <div><div className="font-medium text-slate-800">{p.full_name || 'Sem nome'}</div><div className="text-xs text-slate-400">{p.email}</div></div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{tenantName(p.tenant_id)}</td>
                    <td className="px-4 py-3">{roleBadge(p.role)}</td>
                    <td className="px-4 py-3"><span className={`badge ${p.status === 'active' ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>{p.status === 'active' ? 'Ativo' : 'Inativo'}</span></td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(p.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <button className="p-1.5 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600" onClick={() => openEditUser(p)}><Edit2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {profiles.length === 0 && <div className="text-center py-12 text-slate-400"><Users className="w-10 h-10 mx-auto mb-2 text-slate-300" />Nenhum usuário encontrado.</div>}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar Empresa' : 'Nova Empresa'}
        size="lg"
        footer={<><button className="btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button><button className="btn-primary" onClick={saveTenant}>Salvar</button></>}
      >
        {formError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">
            {formError}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className="label">Nome *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label">Razão social</label><input className="input" value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} /></div>
          <div><label className="label">CNPJ / Documento</label><input className="input" value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} /></div>
          <div><label className="label">Plano</label><select className="input" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}><option value="starter">Starter</option><option value="professional">Professional</option><option value="enterprise">Enterprise</option></select></div>
          <div><label className="label">E-mail de contato</label><input className="input" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></div>
          <div><label className="label">Telefone de contato</label><input className="input" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} /></div>
          <div><label className="label">Máximo de edifícios</label><input type="number" min={1} className="input" value={form.max_buildings} onChange={(e) => setForm({ ...form, max_buildings: parseInt(e.target.value) || 10 })} /></div>
          <div><label className="label">Status</label><select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="active">Ativa</option><option value="inactive">Inativa</option></select></div>
        </div>
      </Modal>

      <Modal
        open={userModalOpen}
        onClose={() => setUserModalOpen(false)}
        title="Editar Usuário"
        footer={<><button className="btn-secondary" onClick={() => setUserModalOpen(false)}>Cancelar</button><button className="btn-primary" onClick={saveUser}>Salvar</button></>}
      >
        {userFormError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {userFormError}
          </div>
        )}
        <div className="space-y-4">
          <div><label className="label">Nome</label><input className="input" value={userForm.full_name} onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })} /></div>
          <div><label className="label">E-mail</label><input className="input bg-slate-50" value={userForm.email} disabled /></div>
          <div><label className="label">Telefone</label><input className="input" value={userForm.phone} onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })} /></div>
          {isPlatformAdmin && (
            <div><label className="label">Empresa</label>
              <select className="input" value={userForm.tenant_id} onChange={(e) => setUserForm({ ...userForm, tenant_id: e.target.value })}>
                <option value="">Sem empresa</option>
                {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Função</label>
              <select className="input" value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value as UserRole })}>
                <option value="platform_admin">Admin da Plataforma</option>
                <option value="tenant_admin">Admin do Cliente</option>
                <option value="operator">Operador</option>
                <option value="viewer">Visualizador</option>
              </select>
            </div>
            <div><label className="label">Status</label><select className="input" value={userForm.status} onChange={(e) => setUserForm({ ...userForm, status: e.target.value })}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400 pt-1"><Shield className="w-3.5 h-3.5" /> A criação de novos usuários é feita pela tela de cadastro. Aqui você edita funções e status.</div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && removeTenant(confirmDelete)}
        title="Excluir empresa"
        message={`Confirma a exclusão de "${confirmDelete?.name}"? Todos os edifícios, gateways e eventos serão removidos.`}
        confirmLabel="Excluir"
        danger
      />
    </>
  );
}
