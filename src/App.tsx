import { useState } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { Layout } from '@/components/Layout';
import { AuthPage } from '@/pages/AuthPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { MonitorPage } from '@/pages/MonitorPage';
import { TenantsPage } from '@/pages/TenantsPage';
import { BuildingsPage } from '@/pages/BuildingsPage';
import { MapPage } from '@/pages/MapPage';
import { PanelsPage } from '@/pages/PanelsPage';
// PAGINAS OCULTAS a pedido: Gateways e Canais/Entradas fora do menu — descomentar
// junto com as rotas abaixo e os itens de menu em Layout.tsx para reativar.
// import { GatewaysPage } from '@/pages/GatewaysPage';
// import { InputsPage } from '@/pages/InputsPage';
import { EventsPage } from '@/pages/EventsPage';
// PAGINA OCULTA: IncidentsPage fica desativada — nada no sistema cria documentos
// na colecao "incidents", entao a tela so mostrava "Nenhum incidente registrado".
// Para reativar: descomentar import + rota abaixo, o item de menu em Layout.tsx
// e implementar a criacao automatica (ex.: simulador/receptor.py).
// import { IncidentsPage } from '@/pages/IncidentsPage';
import { AuditPage } from '@/pages/AuditPage';
// PAGINA OCULTA: Notificacoes fora do menu — as inscrições salvas nao disparam
// nada (sem envio de push/e-mail no sistema). Descomentar junto com a rota
// abaixo e o item de menu em Layout.tsx para reativar.
// import { NotificationsPage } from '@/pages/NotificationsPage';
import { HealthPage } from '@/pages/HealthPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { Flame } from 'lucide-react';

function AppContent() {
  const { session, profile, loading } = useAuth();
  const [page, setPage] = useState('dashboard');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F7FB]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center animate-pulse">
            <Flame className="w-7 h-7 text-white" />
          </div>
          <p className="text-slate-400 text-sm">Carregando FireGuard Monitor...</p>
        </div>
      </div>
    );
  }

  if (!session) return <AuthPage />;

  // If signed in but profile not yet loaded (edge case after signup)
  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F7FB]">
        <div className="text-center">
          <p className="text-slate-500 text-sm mb-2">Configurando seu perfil...</p>
          <p className="text-slate-400 text-xs">Se persistir, recarregue a página.</p>
        </div>
      </div>
    );
  }

  const pages: Record<string, React.ReactNode> = {
    dashboard: <DashboardPage />,
    monitor: <MonitorPage />,
    tenants: <TenantsPage />,
    buildings: <BuildingsPage />,
    map: <MapPage />,
    panels: <PanelsPage />,
    // gateways: <GatewaysPage />, // PAGINA OCULTA — ver nota no import de GatewaysPage
    // inputs: <InputsPage />,     // PAGINA OCULTA — ver nota no import de InputsPage
    events: <EventsPage />,
    // incidents: <IncidentsPage />, // PAGINA OCULTA — ver nota no import de IncidentsPage
    audit: <AuditPage />,
    // notifications: <NotificationsPage />, // PAGINA OCULTA — ver nota no import de NotificationsPage
    health: <HealthPage />,
    settings: <SettingsPage />,
  };

  return (
    <Layout currentPage={page} onPageChange={setPage}>
      {pages[page] ?? pages.dashboard}
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
