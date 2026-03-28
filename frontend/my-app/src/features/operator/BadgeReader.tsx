import { useState, useEffect } from 'react';
import { UserCircle, ChevronDown, Key } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import badgeIcon from '@/app/components/images/icon.png';
import { CredentialsLogin } from './CredentialsLogin';

interface Machine {
  id: number;
  nome: string;
  reparto: string;
  id_postazione: string;
  in_uso: boolean;
}

interface BadgeReaderProps {
  onBadgeDetected: (badgeId: string, machineId: number) => void;
  onCredentialsLogin: (username: string, password: string, machineId: number) => void;
}

export function BadgeReader({ onBadgeDetected, onCredentialsLogin }: BadgeReaderProps) {
  const [scanning, setScanning] = useState(false);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [showMachineSelector, setShowMachineSelector] = useState(false);
  const [showCredentialsLogin, setShowCredentialsLogin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Carica la lista dei macchinari disponibili
  useEffect(() => {
    fetchMachines();
  }, []);

  const fetchMachines = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${import.meta.env.VITE_API_URL}/machines/available`);
      if (!response.ok) throw new Error('Errore nel caricamento dei macchinari');
      const data = await response.json();
      setMachines(data);
      if (data.length > 0) {
        setSelectedMachine(data[0]);
      }
      setError(null);
    } catch (err) {
      setError('Impossibile caricare i macchinari disponibili');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const simulateBadgeScan = () => {
    if (!selectedMachine) {
      setError('Seleziona un macchinario prima di procedere');
      return;
    }
    
    setScanning(true);
    setTimeout(() => {
      const badgeId = `NFT-00${Math.floor(Math.random() * 4) + 1}`;
      onBadgeDetected(badgeId, selectedMachine.id);
      setScanning(false);
    }, 1500);
  };

  const handleCredentialsLogin = (username: string, password: string) => {
    if (!selectedMachine) {
      setError('Seleziona un macchinario prima di procedere');
      return;
    }
    onCredentialsLogin(username, password, selectedMachine.id);
    setShowCredentialsLogin(false);
  };

  return (
    <>
      <div className="relative z-10 flex items-center justify-center" style={{ minHeight: 'calc(100vh - 120px)' }}>
        <div className="text-center">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            {/* Badge reader icon */}
            <div className="relative inline-block mb-8">
              <div className={`w-48 h-48 rounded-3xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border-4 border-white/20 backdrop-blur-sm flex items-center justify-center ${scanning ? 'animate-pulse' : ''}`}>
                <img 
                  src={badgeIcon} 
                  alt="Badge Reader" 
                  className="w-40 h-40 object-contain" 
                />
              </div>
              
              {scanning && (
                <motion.div
                  className="absolute inset-0 rounded-3xl border-4 border-blue-400"
                  animate={{
                    scale: [1, 1.1, 1],
                    opacity: [1, 0, 1],
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                  }}
                />
              )}
            </div>

            <h2 className="text-3xl mb-4">Benvenuto in DITTO</h2>
            <p className="text-gray-400 mb-6 max-w-md mx-auto">
              {scanning 
                ? 'Lettura badge in corso...' 
                : 'Seleziona il macchinario e avvicina il tuo badge RFID/NFC'
              }
            </p>

            {/* Machine Selector */}
            <div className="mb-8 max-w-md mx-auto">
              {loading ? (
                <div className="flex items-center justify-center gap-2 text-gray-400">
                  <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                  <span>Caricamento macchinari...</span>
                </div>
              ) : error ? (
                <div className="text-red-400 text-sm">{error}</div>
              ) : machines.length === 0 ? (
                <div className="text-yellow-400 text-sm">
                  ⚠️ Nessun macchinario disponibile al momento
                </div>
              ) : (
                <div className="relative">
                  <button
                    onClick={() => setShowMachineSelector(!showMachineSelector)}
                    className="w-full px-6 py-4 bg-white/10 border border-white/20 rounded-xl flex items-center justify-between hover:bg-white/15 transition-colors"
                  >
                    <div className="text-left">
                      <div className="text-xs text-gray-400">Macchinario selezionato</div>
                      <div className="text-lg font-semibold">{selectedMachine?.nome || 'Seleziona...'}</div>
                      <div className="text-xs text-gray-400">{selectedMachine?.reparto} - {selectedMachine?.id_postazione}</div>
                    </div>
                    <ChevronDown className={`w-5 h-5 transition-transform ${showMachineSelector ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {showMachineSelector && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="absolute top-full left-0 right-0 mt-2 bg-slate-800 border border-white/20 rounded-xl overflow-hidden z-20"
                    >
                      {machines.map((machine) => (
                        <button
                          key={machine.id}
                          onClick={() => {
                            setSelectedMachine(machine);
                            setShowMachineSelector(false);
                          }}
                          className={`w-full px-6 py-3 text-left hover:bg-white/10 transition-colors ${
                            selectedMachine?.id === machine.id ? 'bg-blue-500/20' : ''
                          }`}
                        >
                          <div className="font-semibold">{machine.nome}</div>
                          <div className="text-xs text-gray-400">{machine.reparto} - {machine.id_postazione}</div>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </div>
              )}
            </div>

            {/* Login Options */}
            <div className="flex gap-4 justify-center mb-8">
              <button
                onClick={simulateBadgeScan}
                disabled={scanning || !selectedMachine || machines.length === 0}
                className="px-8 py-4 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-xl transition-colors flex items-center gap-3"
              >
                <UserCircle className="h-6 w-6" />
                {scanning ? 'Scansione in corso...' : 'Simula Scansione Badge'}
              </button>
              
              <button
                onClick={() => setShowCredentialsLogin(true)}
                disabled={!selectedMachine || machines.length === 0}
                className="px-8 py-4 bg-purple-500 hover:bg-purple-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-xl transition-colors flex items-center gap-3"
              >
                <Key className="h-6 w-6" />
                Accedi con Credenziali
              </button>
            </div>

            {/* Info cards */}
            <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto">
              <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
                <div className="text-2xl mb-2">🔒</div>
                <p className="text-sm text-gray-400">Sicurezza</p>
                <p className="text-xs text-gray-500 mt-1">Accesso protetto</p>
              </div>
              <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
                <div className="text-2xl mb-2">📊</div>
                <p className="text-sm text-gray-400">Tracciabilità</p>
                <p className="text-xs text-gray-500 mt-1">Ogni azione registrata</p>
              </div>
              <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
                <div className="text-2xl mb-2">🎯</div>
                <p className="text-sm text-gray-400">Personalizzato</p>
                <p className="text-xs text-gray-500 mt-1">Risposte su misura</p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      <AnimatePresence>
        {showCredentialsLogin && (
          <CredentialsLogin
            onLogin={handleCredentialsLogin}
            onCancel={() => setShowCredentialsLogin(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
