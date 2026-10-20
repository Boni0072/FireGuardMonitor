import { useState, ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { UserRole } from '@/lib/db';
import {
  LayoutDashboard, Building2, CircuitBoard,
  // Radio, Cable: reabilitar junto com os itens "Gateways" e "Canais e Entradas" (nota no NAV_ITEMS).
  // Bell: reabilitar junto com o item "Notificações" (nota no NAV_ITEMS).
  Activity, /* Bell, */ HeartPulse, Settings, Users, LogOut, Menu, X,
  Flame, Shield, ChevronDown, Wifi, Monitor, ChevronsLeft, ChevronsRight, MapPin,
} from 'lucide-react';

interface NavItem {
  label: string;
  icon: typeof LayoutDashboard;
  page: string;
  roles: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, page: 'dashboard', roles: ['platform_admin', 'tenant_admin', 'operator', 'viewer'] },
  { label: 'Painel de Monitoramento', icon: Monitor, page: 'monitor', roles: ['platform_admin', 'tenant_admin', 'operator', 'viewer'] },
  { label: 'Empresas e Usuários', icon: Users, page: 'tenants', roles: ['platform_admin', 'tenant_admin'] },
  { label: 'Edifícios', icon: Building2, page: 'buildings', roles: ['platform_admin', 'tenant_admin', 'operator', 'viewer'] },
  { label: 'Mapa de Edifícios', icon: MapPin, page: 'map', roles: ['platform_admin', 'tenant_admin', 'operator', 'viewer'] },
  { label: 'Centrais', icon: CircuitBoard, page: 'panels', roles: ['platform_admin', 'tenant_admin', 'operator', 'viewer'] },
  // PAGINAS OCULTAS a pedido: "Gateways" e "Canais e Entradas" fora do menu.
  // Sao funcionais — para reativar: descomentar estas 2 linhas, os imports de
  // GatewaysPage/InputsPage e as rotas em App.tsx, e os icones Radio/Cable acima.
  // { label: 'Gateways', icon: Radio, page: 'gateways', roles: ['platform_admin', 'tenant_admin', 'operator', 'viewer'] },
  // { label: 'Canais e Entradas', icon: Cable, page: 'inputs', roles: ['platform_admin', 'tenant_admin', 'operator', 'viewer'] },
  { label: 'Eventos em Tempo Real', icon: Activity, page: 'events', roles: ['platform_admin', 'tenant_admin', 'operator', 'viewer'] },
  // PAGINA OCULTA: "Incidentes" nao recebe dados de ninguem (nem backend nem UI a
  // cria), entao sempre abria vazia — escondida do menu ate ser implementada a
  // criacao automatica. Para reativar: descomentar esta linha, o import de
  // IncidentsPage e a rota em App.tsx (e o icone Flame acima).
  // { label: 'Incidentes', icon: Flame, page: 'incidents', roles: ['platform_admin', 'tenant_admin', 'operator', 'viewer'] },
  { label: 'Histórico e Auditoria', icon: Shield, page: 'audit', roles: ['platform_admin', 'tenant_admin'] },
  // PAGINA OCULTA: "Notificacoes" cadastra inscricoes (notification_subscriptions),
  // mas NADA no sistema as consome — nao ha envio de push/e-mail nem leitura das
  // inscricoes fora desta tela; escondida para nao gerar falsa confiança de que
  // alertas serao entregues. Para reativar: descomentar esta linha, o import de
  // NotificationsPage e a rota em App.tsx (e o icone Bell acima) — idealmente
  // apos implementar o envio (FCM + Cloud Function lendo as inscrições).
  // { label: 'Notificações', icon: Bell, page: 'notifications', roles: ['platform_admin', 'tenant_admin', 'operator', 'viewer'] },
  { label: 'Saúde da Comunicação', icon: HeartPulse, page: 'health', roles: ['platform_admin', 'tenant_admin', 'operator', 'viewer'] },
  { label: 'Configurações', icon: Settings, page: 'settings', roles: ['platform_admin', 'tenant_admin'] },
];

interface LayoutProps {
  currentPage: string;
  onPageChange: (page: string) => void;
  children: ReactNode;
}

export function Layout({ currentPage, onPageChange, children }: LayoutProps) {
  const { profile, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const role = profile?.role ?? 'viewer';
  const navItems = NAV_ITEMS.filter((item) => item.roles.includes(role));

  const roleLabel: Record<UserRole, string> = {
    platform_admin: 'Administrador da Plataforma',
    tenant_admin: 'Administrador do Cliente',
    operator: 'Operador',
    viewer: 'Visualizador',
  };

  return (
    <div className="min-h-screen bg-[#F5F7FB] flex">
      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-64 ${
          collapsed ? 'lg:w-20' : 'lg:w-64'
        } bg-[#101828] text-slate-300 flex flex-col transition-[transform,width] duration-300 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div
          className={`relative flex items-center gap-3 px-5 h-16 border-b border-white/10 shrink-0 ${
            collapsed ? 'lg:justify-center lg:px-0' : ''
          }`}
        >
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
            <Flame className="w-5 h-5 text-white" />
          </div>
          <div className={`${collapsed ? 'lg:hidden' : ''}`}>
            <div className="text-white font-bold text-sm leading-tight">FireGuard</div>
            <div className="text-slate-400 text-xs leading-tight">Monitor</div>
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            className={`hidden lg:flex absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 items-center justify-center rounded-full bg-[#1E293B] border border-white/10 text-slate-400 hover:text-white hover:bg-blue-600 transition-colors ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            {collapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
          </button>
        </div>

        <nav className={`flex-1 overflow-y-auto py-4 space-y-0.5 ${collapsed ? 'px-3 lg:px-2' : 'px-3'}`}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentPage === item.page;
            return (
              <button
                key={item.page}
                onClick={() => { onPageChange(item.page); setSidebarOpen(false); }}
                title={collapsed ? item.label : undefined}
                className={`w-full flex items-center gap-3 rounded-lg text-sm font-medium transition-colors ${
                  collapsed ? 'px-3 py-2.5 lg:justify-center lg:px-0' : 'px-3 py-2.5'
                } ${
                  active ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span className={`truncate ${collapsed ? 'lg:hidden' : ''}`}>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className={`border-t border-white/10 py-4 shrink-0 ${collapsed ? 'px-3 lg:px-2' : 'px-3'}`}>
          <div className={`rounded-lg bg-white/5 ${collapsed ? 'px-3 py-2 lg:px-0' : 'px-3 py-2'}`}>
            <div
              className={`flex items-center gap-2 text-xs text-slate-400 ${
                collapsed ? 'lg:justify-center' : ''
              }`}
              title={collapsed ? 'Plataforma conectada' : undefined}
            >
              <Wifi className="w-3.5 h-3.5 text-green-400 shrink-0" />
              <span className={collapsed ? 'lg:hidden' : ''}>Plataforma conectada</span>
            </div>
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-6 shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100">
              <Menu className="w-5 h-5" />
            </button>
            <div className="hidden sm:flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm text-slate-600 font-medium">Operação ativa</span>
            </div>
          </div>

          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-semibold shrink-0">
                {(profile?.full_name || profile?.email || '?').charAt(0).toUpperCase()}
              </div>
              <div className="hidden sm:block text-left">
                <div className="text-sm font-medium text-slate-800 leading-tight">{profile?.full_name || 'Usuário'}</div>
                <div className="text-xs text-slate-500 leading-tight">{roleLabel[role]}</div>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-400" />
            </button>

            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-slate-200 z-20 animate-slide-in overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <div className="text-sm font-medium text-slate-800 truncate">{profile?.full_name || 'Usuário'}</div>
                    <div className="text-xs text-slate-500 truncate">{profile?.email}</div>
                  </div>
                  <button
                    onClick={() => { signOut(); setUserMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-4 py-3 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Encerrar sessão
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="w-full px-4 lg:px-6 py-6">{children}</div>
        </main>
      </div>

      {/* Close button for mobile sidebar */}
      {sidebarOpen && (
        <button onClick={() => setSidebarOpen(false)} className="fixed top-4 left-60 z-50 lg:hidden p-1.5 rounded-lg bg-white/10 text-white">
          <X className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}
