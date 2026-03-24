import { useState } from 'react';
import { motion } from 'motion/react';
import { Lock, User, Shield } from 'lucide-react';

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
      className="fixed inset-0 flex items-center justify-center z-50 bg-black/50 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div 
        className="bg-slate-800/95 backdrop-blur-md rounded-2xl p-8 max-w-md w-full mx-4 border border-white/20 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-blue-400" />
          </div>
          <h3 className="text-2xl font-bold text-white">Accesso con Credenziali</h3>
          <p className="text-gray-400 text-sm mt-2">Inserisci le tue credenziali DITTO</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Username
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-slate-700/50 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors"
                placeholder="es. mario.rossi"
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-12 py-3 bg-slate-700/50 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              >
                {showPassword ? "👁️" : "👁️‍🗨️"}
              </button>
            </div>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-xs text-gray-300">
            <p className="font-semibold text-blue-400 mb-1">💡 Credenziali di test:</p>
            <p>Username: mario.rossi / luigi.verdi / anna.bianchi / marco.neri</p>
            <p>Password: password123</p>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-3 bg-gray-600/50 hover:bg-gray-600 rounded-lg transition-colors text-white font-medium"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={!username || !password}
              className="flex-1 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors text-white font-medium"
            >
              Accedi
            </button>
          </div>
        </form>
      </div>
    </motion.div>
  );
}