import { useState } from 'react';
import { Mic, Radio } from 'lucide-react';
import { AvatarDisplay } from './AvatarDisplay';
import { BadgeReader } from './BadgeReader';

type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface User {
  id: number;
  nome: string;
  badge_id: string;
  livello_esperienza: string;
  reparto: string;
  turno: string;
}

interface Machine {
  id: number;
  nome: string;
  reparto: string;
  id_postazione: string;
  in_uso: boolean;
}

export function OperatorInterface() {
  const [avatarState, setAvatarState] = useState<AvatarState>('idle');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentMachine, setCurrentMachine] = useState<Machine | null>(null);
  const [transcript, setTranscript] = useState('');
  const [wakeWordActive, setWakeWordActive] = useState(true);
  const [showSubtitles, setShowSubtitles] = useState(false);
  const [loading, setLoading] = useState(false);

  const API_URL = import.meta.env.VITE_API_URL;

  const handleBadgeLogin = async (badgeId: string, machineId: number) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/auth/badge-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ badge_id: badgeId, machine_id: machineId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Errore durante il login');
      }

      const data = await response.json();
      setCurrentUser(data.user);
      setCurrentMachine(data.machine);
      setIsLoggedIn(true);
      
      // Salva il token
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('machine', JSON.stringify(data.machine));
      
    } catch (error) {
      console.error('Login error:', error);
      alert(error instanceof Error ? error.message : 'Errore durante il login');
    } finally {
      setLoading(false);
    }
  };

  const handleCredentialsLogin = async (username: string, password: string, machineId: number) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/auth/credentials-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password, machine_id: machineId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Credenziali non valide');
      }

      const data = await response.json();
      setCurrentUser(data.user);
      setCurrentMachine(data.machine);
      setIsLoggedIn(true);
      
      // Salva il token
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('machine', JSON.stringify(data.machine));
      
    } catch (error) {
      console.error('Login error:', error);
      alert(error instanceof Error ? error.message : 'Errore durante il login');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (currentUser && currentMachine) {
      try {
        await fetch(`${API_URL}/auth/logout?user_id=${currentUser.id}&machine_id=${currentMachine.id}`, {
          method: 'POST',
        });
      } catch (error) {
        console.error('Logout error:', error);
      }
    }
    
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    localStorage.removeItem('machine');
    setIsLoggedIn(false);
    setCurrentUser(null);
    setCurrentMachine(null);
    setAvatarState('idle');
  };

  // Simula il rilevamento del wake word
  const simulateWakeWord = () => {
    if (avatarState === 'idle' && isLoggedIn) {
      setAvatarState('listening');
      setShowSubtitles(true);
      setTranscript('In ascolto...');
      
      setTimeout(() => {
        setTranscript('Come cambio l\'olio?');
        setAvatarState('thinking');
        
        setTimeout(() => {
          setTranscript('Per cambiare l\'olio della Pressa A7: 1. Spegnere la macchina. 2. Attendere il raffreddamento. 3. Posizionare un contenitore sotto lo scarico...');
          setAvatarState('speaking');
          
          setTimeout(() => {
            setAvatarState('idle');
            setShowSubtitles(false);
            setTranscript('');
          }, 5000);
        }, 2000);
      }, 3000);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white relative overflow-hidden">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0" style={{
          backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
          backgroundSize: '40px 40px'
        }}></div>
      </div>

      {/* Header with machine info */}
      <div className="relative z-10 p-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="text-blue-400">DITTO</span> Assistente
          </h1>
          {currentMachine && (
            <p className="text-sm text-gray-400 mt-1">
              Postazione: {currentMachine.nome} - {currentMachine.id_postazione}
            </p>
          )}
        </div>
        
        <div className="flex items-center gap-4">
          {isLoggedIn && currentUser && (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm text-gray-400">Operatore</p>
                <p className="font-semibold">{currentUser.nome}</p>
                <p className="text-xs text-gray-500">{currentUser.livello_esperienza} - {currentUser.turno}</p>
              </div>
              <button
                onClick={handleLogout}
                className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 rounded-lg transition-colors"
              >
                Logout
              </button>
            </div>
          )}
          
          <div className="flex items-center gap-2">
            <Radio className={`h-5 w-5 ${wakeWordActive ? 'text-green-400 animate-pulse' : 'text-gray-500'}`} />
            <span className="text-sm text-gray-400">
              {wakeWordActive ? 'Wake word attivo' : 'Disattivato'}
            </span>
          </div>
        </div>
      </div>

      {/* Main content */}
      {!isLoggedIn ? (
        <BadgeReader 
          onBadgeDetected={handleBadgeLogin}
          onCredentialsLogin={handleCredentialsLogin}
        />
      ) : (
        <div className="relative z-10 flex flex-col items-center justify-center" style={{ minHeight: 'calc(100vh - 120px)' }}>
          {loading ? (
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-400">Accesso in corso...</p>
            </div>
          ) : (
            <>
              {/* Avatar Display */}
              <AvatarDisplay state={avatarState} />

              {/* Status indicator */}
              <div className="mt-8 text-center">
                <div className="inline-flex items-center gap-2 px-6 py-3 bg-white/10 backdrop-blur-md rounded-full border border-white/20">
                  {avatarState === 'idle' && (
                    <>
                      <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                      <span>In attesa - Di' "Ehi Ditto" per iniziare</span>
                    </>
                  )}
                  {avatarState === 'listening' && (
                    <>
                      <Mic className="h-5 w-5 text-blue-400 animate-pulse" />
                      <span>In ascolto...</span>
                    </>
                  )}
                  {avatarState === 'thinking' && (
                    <>
                      <div className="flex gap-1">
                        <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      </div>
                      <span>Elaborazione in corso...</span>
                    </>
                  )}
                  {avatarState === 'speaking' && (
                    <>
                      <div className="w-3 h-3 bg-purple-400 rounded-full animate-pulse"></div>
                      <span>Risposta in corso...</span>
                    </>
                  )}
                </div>
              </div>

              {/* Subtitles */}
              {showSubtitles && transcript && (
                <div className="mt-6 max-w-2xl mx-auto px-6">
                  <div className="bg-black/60 backdrop-blur-md px-8 py-4 rounded-xl border border-white/20">
                    <p className="text-center text-lg">{transcript}</p>
                  </div>
                </div>
              )}

              {/* Test interaction button */}
              <button
                onClick={simulateWakeWord}
                disabled={avatarState !== 'idle'}
                className="mt-8 px-6 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                🎤 Simula Interazione Test
              </button>

              {/* Quick actions */}
              <div className="mt-12 grid grid-cols-3 gap-4 max-w-2xl mx-auto px-6">
                <button className="p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors">
                  <span className="block text-sm text-gray-400 mb-1">Emergenza</span>
                  <span className="block font-semibold">🚨 Alert</span>
                </button>
                <button className="p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors">
                  <span className="block text-sm text-gray-400 mb-1">Manutenzione</span>
                  <span className="block font-semibold">🔧 Chiama</span>
                </button>
                <button className="p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors">
                  <span className="block text-sm text-gray-400 mb-1">Supporto</span>
                  <span className="block font-semibold">❓ Aiuto</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}