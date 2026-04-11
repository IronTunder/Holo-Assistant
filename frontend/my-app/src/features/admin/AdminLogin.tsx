// frontend/my-app/src/features/admin/AdminLogin.tsx

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/shared/auth/AuthContext';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Card, CardContent } from '@/shared/ui/card';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { AlertCircle, ArrowLeft, Lock, ShieldCheck, Users, Wrench } from 'lucide-react';
import { toast } from 'sonner';

export const AdminLogin = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { adminLogin } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    if (!username || !password) {
      setError('Inserisci username e password');
      setIsLoading(false);
      return;
    }

    const result = await adminLogin(username, password);

    if (result.success) {
      toast.success('Login admin effettuato con successo');
      navigate('/admin', { replace: true });
    } else {
      setError(result.error || 'Errore durante il login');
      toast.error(result.error || 'Credenziali non valide');
    }

    setIsLoading(false);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-4 text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-10%] top-[-12%] h-72 w-72 rounded-full bg-cyan-500/18 blur-3xl" />
        <div className="absolute bottom-[-18%] right-[-8%] h-80 w-80 rounded-full bg-blue-500/16 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_38%),linear-gradient(180deg,transparent,rgba(15,23,42,0.35))]" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-6xl items-center justify-center">
        <div className="grid w-full items-stretch gap-6 lg:grid-cols-[minmax(320px,0.95fr)_minmax(420px,1.05fr)]">
          <section className="hidden flex-col justify-between rounded-[28px] border border-white/10 bg-white/6 p-8 backdrop-blur-md lg:flex">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100">
                <ShieldCheck className="h-4 w-4" />
                Accesso amministrativo
              </div>
              <h1 className="mt-6 max-w-md text-4xl font-semibold tracking-tight text-white">
                Controllo operativo in un’unica console.
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-7 text-slate-300">
                Accedi al pannello Holo-Assistant per gestire utenti, reparti, macchinari, knowledge base e richieste
                aperte mantenendo la stessa esperienza visiva del resto del sistema.
              </p>
            </div>

            <div className="grid gap-3">
              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-200">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">Gestione utenti e ruoli</p>
                    <p className="text-sm text-slate-400">Permessi, reparti e profili allineati in tempo reale.</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-400/10 text-blue-200">
                    <Wrench className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">Monitoraggio operativo</p>
                    <p className="text-sm text-slate-400">Visione immediata di macchine, segnalazioni e stato impianto.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <Card className="overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/78 shadow-2xl shadow-slate-950/40 backdrop-blur-md">
            <CardContent className="p-0">
              <div className="border-b border-white/10 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800 px-6 py-6 sm:px-8">
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-[24px] border border-cyan-400/20 bg-cyan-400/12 text-cyan-100">
                  <Lock className="h-8 w-8" />
                </div>
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Console amministrativa</p>
                <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">Accedi al pannello admin</h2>
                <p className="mt-3 max-w-md text-sm leading-6 text-slate-400">
                  Usa le credenziali abilitate al backoffice per entrare nella dashboard operativa.
                </p>
              </div>

              <div className="space-y-6 px-6 py-6 sm:px-8 sm:py-8">
                {error && (
                  <Alert className="border-red-400/30 bg-red-500/10 text-red-100">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <label htmlFor="username" className="text-sm font-medium text-slate-200">
                      Username
                    </label>
                    <Input
                      id="username"
                      type="text"
                      placeholder="Inserisci username admin"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={isLoading}
                      className="h-12 border-white/10 bg-white/8 text-white placeholder:text-slate-500 focus-visible:border-cyan-400 focus-visible:ring-cyan-400/40"
                    />
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="password" className="text-sm font-medium text-slate-200">
                      Password
                    </label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Inserisci password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={isLoading}
                      className="h-12 border-white/10 bg-white/8 text-white placeholder:text-slate-500 focus-visible:border-cyan-400 focus-visible:ring-cyan-400/40"
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="h-12 w-full bg-cyan-500 font-semibold text-slate-950 hover:bg-cyan-400"
                  >
                    {isLoading ? 'Accesso in corso...' : 'Accedi alla dashboard'}
                  </Button>
                </form>

                <div className="rounded-2xl border border-white/10 bg-white/6 px-4 py-4 text-sm text-slate-300">
                  L’accesso admin è riservato ai ruoli con permesso backoffice. Se devi usare la postazione macchina,
                  torna all’interfaccia operatore.
                </div>

                <div className="border-t border-white/10 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 w-full border-white/12 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                    onClick={() => navigate('/', { replace: true })}
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Torna alla pagina operatore
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};
