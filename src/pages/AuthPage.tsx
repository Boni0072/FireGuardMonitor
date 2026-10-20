import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Flame, Mail, Lock, User as UserIcon, ArrowRight } from 'lucide-react';

export function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = mode === 'signin'
      ? await signIn(email, password)
      : await signUp(email, password, fullName);
    setLoading(false);
    if (result.error) setError(result.error);
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div className="hidden lg:flex lg:flex-1 bg-[#101828] relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: 'radial-gradient(circle at 20% 30%, #2563eb 0%, transparent 40%), radial-gradient(circle at 80% 70%, #dc2626 0%, transparent 40%)',
        }} />
        <div className="relative flex flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
              <Flame className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="font-bold text-lg leading-tight">FireGuard</div>
              <div className="text-slate-400 text-sm leading-tight">Monitor</div>
            </div>
          </div>

          <div className="space-y-6">
            <h1 className="text-4xl font-bold leading-tight">
              Monitoramento remoto<br />complementar de centrais<br />de alarme de incêndio.
            </h1>
            <p className="text-slate-300 text-lg max-w-md">
              Plataforma multiempresa para receber eventos, identificar edifícios e zonas,
              e notificar responsáveis instantaneamente — mesmo com o painel fechado.
            </p>
            <div className="flex gap-6 pt-4">
              <div>
                <div className="text-3xl font-bold text-blue-400">24/7</div>
                <div className="text-sm text-slate-400">Monitoramento</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-green-400">Tempo real</div>
                <div className="text-sm text-slate-400">Eventos e alertas</div>
              </div>
            </div>
          </div>

          <p className="text-slate-500 text-xs max-w-md">
            Plataforma complementar de monitoramento. Não substitui a central certificada nem controla circuitos de detecção.
          </p>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-[#F5F7FB]">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
              <Flame className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="font-bold text-lg text-slate-900">FireGuard Monitor</div>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-slate-900 mb-2">
            {mode === 'signin' ? 'Acessar plataforma' : 'Criar conta'}
          </h2>
          <p className="text-slate-500 text-sm mb-8">
            {mode === 'signin' ? 'Entre com suas credenciais para acessar o centro de operações.' : 'Registre-se para começar a monitorar seus edifícios.'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="label">Nome completo</label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input className="input pl-10" type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Seu nome" required />
                </div>
              </div>
            )}
            <div>
              <label className="label">E-mail</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input className="input pl-10" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com" required />
              </div>
            </div>
            <div>
              <label className="label">Senha</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input className="input pl-10" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} />
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Aguarde...' : (
                <>
                  {mode === 'signin' ? 'Entrar' : 'Criar conta'}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-slate-500">
            {mode === 'signin' ? (
              <>Não tem conta? <button onClick={() => { setMode('signup'); setError(null); }} className="text-blue-600 font-medium hover:underline">Criar conta</button></>
            ) : (
              <>Já tem conta? <button onClick={() => { setMode('signin'); setError(null); }} className="text-blue-600 font-medium hover:underline">Entrar</button></>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
