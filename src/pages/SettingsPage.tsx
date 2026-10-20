import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Shield, Database, Radio, Bell, Info } from 'lucide-react';

export function SettingsPage() {
  const { profile } = useAuth();
  const isPlatformAdmin = profile?.role === 'platform_admin';

  const sections = [
    { icon: Shield, title: 'Segurança e Conformidade', items: [
      'A plataforma é complementar e não substitui a central certificada.',
      'Não controla circuitos de detecção, sirenes ou detectores.',
      'Usar somente interfaces auxiliares compatíveis e autorizadas pelo fabricante.',
      'Isolar eletricamente as entradas quando aplicável ao projeto.',
      'HTTPS/TLS, autenticação individual e privilégios mínimos.',
      'Prever validação por profissional habilitado antes de implantação operacional.',
    ]},
    { icon: Radio, title: 'Monitoramento de Gateways', items: [
      'Heartbeat a cada 30 segundos (configurável por instalação).',
      'Limite offline inicial: 90 segundos (ajustável).',
      'Estados: online, degradado, offline, recuperado.',
      'Estados desconhecidos e falhas devem ser diferenciados de ausência de incêndio.',
    ]},
    { icon: Bell, title: 'Notificações', items: [
      'Push depende de permissões, navegador, SO, conectividade e serviço.',
      'Diferenciar: solicitada, envio confirmado, entrega conhecida, reconhecimento humano.',
      'Escalonamento para responsáveis adicionais após prazo configurável.',
    ]},
  ];

  return (
    <>
      <PageHeader title="Configurações da Plataforma" subtitle="Parâmetros, conformidade e informações do sistema" />

      {isPlatformAdmin && (
        <div className="card p-5 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center"><Database className="w-5 h-5 text-blue-600" /></div>
            <div><div className="font-semibold text-slate-900">Sistema</div><div className="text-sm text-slate-500">FireGuard Monitor — plataforma de monitoramento complementar</div></div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div><div className="text-xs text-slate-400">Versão</div><div className="text-slate-700">1.0.0</div></div>
            <div><div className="text-xs text-slate-400">Backend</div><div className="text-slate-700">Firebase (Firestore + Auth)</div></div>
            <div><div className="text-xs text-slate-400">API de eventos</div><div className="text-slate-700">Cloud Firestore / realtime</div></div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <div key={section.title} className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Icon className="w-5 h-5 text-slate-600" />
                <h3 className="font-semibold text-slate-900">{section.title}</h3>
              </div>
              <ul className="space-y-2.5">
                {section.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-1.5 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="card p-5 mt-6">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-slate-600">
            A plataforma é complementar de monitoramento. Não declarar conformidade ou certificação sem evidência e avaliação apropriada.
            Documentar limites de monitoramento e estados desconhecidos. Implementar testes de falha de internet, energia e gateway.
          </p>
        </div>
      </div>
    </>
  );
}
