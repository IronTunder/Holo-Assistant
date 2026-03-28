import { useState, useEffect } from 'react';
import { UserCircle, ChevronDown, Key } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import badgeIcon from '@/app/components/images/icon.png';
import { CredentialsLogin } from './CredentialsLogin';
import { ScrollArea } from '@/shared/ui/scroll-area';

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
      <div className="h-full min-h-0">
        <motion.div
          initial={{ scale: 0.97, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.35 }}
          className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(320px,0.9fr)_minmax(380px,1.1fr)]"
        >
          <section className="flex min-h-0 flex-col justify-center rounded-[28px] border border-white/10 bg-slate-950/20 p-5 text-center backdrop-blur-sm sm:p-6">
            <div className="flex flex-1 flex-col items-center justify-center">
              <div className="relative inline-block">
                <div className={`flex h-36 w-36 items-center justify-center rounded-[32px] border-4 border-white/20 bg-gradient-to-br from-blue-500/20 to-cyan-500/10 backdrop-blur-sm sm:h-44 sm:w-44 ${scanning ? 'animate-pulse' : ''}`}>
                  <img
                    src={badgeIcon}
                    alt="Badge Reader"
                    className="h-24 w-24 object-contain sm:h-32 sm:w-32"
                  />
                </div>

                {scanning && (
                  <motion.div
                    className="absolute inset-0 rounded-[32px] border-4 border-blue-400"
                    animate={{
                      scale: [1, 1.06, 1],
                      opacity: [1, 0, 1],
                    }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                    }}
                  />
                )}
              </div>

              <h2 className="mt-5 text-2xl font-semibold text-white sm:text-3xl">Benvenuto in DITTO</h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-slate-300 sm:text-base">
                {scanning
                  ? 'Lettura badge in corso...'
                  : 'Seleziona la postazione e accedi senza far scorrere la schermata.'}
              </p>

              <div className="mt-4 w-full max-w-md rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Postazione selezionata</p>
                <p className="mt-2 text-lg font-semibold text-white">{selectedMachine?.nome || 'Nessuna postazione selezionata'}</p>
                <p className="mt-1 text-sm text-slate-400">
                  {selectedMachine ? `${selectedMachine.reparto} - ${selectedMachine.id_postazione}` : 'Scegli una macchina dal pannello laterale.'}
                </p>
              </div>
            </div>
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/25 backdrop-blur-sm">
            <div className="shrink-0 border-b border-white/10 px-4 py-4 sm:px-5">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Accesso operatore</p>
              <h3 className="mt-1 text-lg font-semibold text-white">Seleziona il macchinario e il metodo di accesso</h3>
            </div>

            <ScrollArea className="min-h-0 flex-1 px-4 py-4 sm:px-5">
              <div className="space-y-4">
                {loading ? (
                  <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-slate-300">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"></div>
                    <span>Caricamento macchinari...</span>
                  </div>
                ) : error ? (
                  <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-4 text-sm text-red-200">
                    {error}
                  </div>
                ) : machines.length === 0 ? (
                  <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-4 text-sm text-amber-100">
                    Nessun macchinario disponibile al momento.
                  </div>
                ) : (
                  <div className="relative">
                    <button
                      onClick={() => setShowMachineSelector(!showMachineSelector)}
                      className="flex w-full items-center justify-between rounded-2xl border border-white/15 bg-white/10 px-4 py-4 text-left transition-colors hover:bg-white/15"
                    >
                      <div className="min-w-0">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Macchinario selezionato</div>
                        <div className="truncate text-lg font-semibold text-white">{selectedMachine?.nome || 'Seleziona...'}</div>
                        <div className="truncate text-xs text-slate-400">{selectedMachine?.reparto} - {selectedMachine?.id_postazione}</div>
                      </div>
                      <ChevronDown className={`h-5 w-5 shrink-0 transition-transform ${showMachineSelector ? 'rotate-180' : ''}`} />
                    </button>

                    {showMachineSelector && (
                      <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-white/20 bg-slate-900/95 shadow-2xl"
                      >
                        <ScrollArea className="max-h-64">
                          <div className="p-2">
                            {machines.map((machine) => (
                              <button
                                key={machine.id}
                                onClick={() => {
                                  setSelectedMachine(machine);
                                  setShowMachineSelector(false);
                                }}
                                className={`w-full rounded-xl px-4 py-3 text-left transition-colors hover:bg-white/10 ${
                                  selectedMachine?.id === machine.id ? 'bg-blue-500/20' : ''
                                }`}
                              >
                                <div className="font-semibold text-white">{machine.nome}</div>
                                <div className="text-xs text-slate-400">{machine.reparto} - {machine.id_postazione}</div>
                              </button>
                            ))}
                          </div>
                        </ScrollArea>
                      </motion.div>
                    )}
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    onClick={simulateBadgeScan}
                    disabled={scanning || !selectedMachine || machines.length === 0}
                    className="flex items-center justify-center gap-3 rounded-2xl bg-blue-500 px-5 py-4 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-600"
                  >
                    <UserCircle className="h-5 w-5" />
                    {scanning ? 'Scansione in corso...' : 'Simula scansione badge'}
                  </button>

                  <button
                    onClick={() => setShowCredentialsLogin(true)}
                    disabled={!selectedMachine || machines.length === 0}
                    className="flex items-center justify-center gap-3 rounded-2xl bg-cyan-500 px-5 py-4 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
                  >
                    <Key className="h-5 w-5" />
                    Accedi con credenziali
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Sicurezza</p>
                    <p className="mt-2 text-sm font-semibold text-white">Accesso protetto</p>
                    <p className="mt-1 text-xs text-slate-400">Ogni accesso e associato a operatore e macchina.</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Tracciabilita</p>
                    <p className="mt-2 text-sm font-semibold text-white">Sessione registrata</p>
                    <p className="mt-1 text-xs text-slate-400">Il supporto segue sempre la postazione selezionata.</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Supporto</p>
                    <p className="mt-2 text-sm font-semibold text-white">Risposte mirate</p>
                    <p className="mt-1 text-xs text-slate-400">La conoscenza e filtrata sul contesto macchina corrente.</p>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </section>
        </motion.div>
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
