import { useState } from 'react';
import { motion } from 'motion/react';
import { Lock, User, Shield } from 'lucide-react';
import { ScrollArea } from '@/shared/ui/scroll-area';

interface CredentialsLoginProps {
  onLogin: (username: string, password: string) => void;
  onCancel: () => void;
}

export function CredentialsLogin({ onLogin, onCancel }: CredentialsLoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username && password) {
      onLogin(username, password);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onCancel}
    >
      <div
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/95 shadow-2xl backdrop-blur-md sm:max-h-[calc(100dvh-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-white/10 px-5 py-5 text-center sm:px-6">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[24px] border border-blue-400/20 bg-blue-500/20">
            <Shield className="h-8 w-8 text-blue-400" />
          </div>
          <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Accesso operatore</p>
          <h3 className="mt-1 text-xl font-semibold text-white">Accesso con credenziali</h3>
          <p className="mt-2 text-sm text-slate-400">Inserisci le tue credenziali DITTO.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <ScrollArea className="min-h-0 flex-1 px-5 py-5 sm:px-6 sm:py-6">
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Username
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-white/10 py-3 pl-10 pr-4 text-white placeholder:text-slate-400 transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder="es. mario.rossi"
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-white/10 py-3 pl-10 pr-14 text-white placeholder:text-slate-400 transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder="Inserisci la password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-300 transition-colors hover:text-white"
                  >
                    {showPassword ? 'Nascondi' : 'Mostra'}
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-blue-400/30 bg-blue-500/10 p-3 text-xs text-slate-200">
                <p className="mb-1 font-semibold text-blue-300">Credenziali di test</p>
                <p>Username: Mario Rossi / Luigi Verdi / Anna Bianchi / Marco Neri</p>
                <p>Password: password123</p>
              </div>
            </div>
          </ScrollArea>

          <div className="shrink-0 border-t border-white/10 px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 rounded-xl border border-white/15 bg-white/10 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/15"
              >
                Annulla
              </button>
              <button
                type="submit"
                disabled={!username || !password}
                className="flex-1 rounded-xl bg-blue-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-600"
              >
                Accedi
              </button>
            </div>
          </div>
        </form>
      </div>
    </motion.div>
  );
}
