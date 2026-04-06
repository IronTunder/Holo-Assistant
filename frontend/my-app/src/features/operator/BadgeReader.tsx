import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { UserCircle, ChevronDown, Key, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import badgeIcon from '@/app/components/images/icon.png';
import { CredentialsLogin } from './CredentialsLogin';
import { ScrollArea } from '@/shared/ui/scroll-area';
import { API_ENDPOINTS } from '@/shared/api/config';

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

type MachineSelectorRect = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

export function BadgeReader({ onBadgeDetected, onCredentialsLogin }: BadgeReaderProps) {
  const [scanning, setScanning] = useState(false);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [showMachineSelector, setShowMachineSelector] = useState(false);
  const [showCredentialsLogin, setShowCredentialsLogin] = useState(false);
  const [machineSearch, setMachineSearch] = useState('');
  const [machineSelectorRect, setMachineSelectorRect] = useState<MachineSelectorRect | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const machineSelectorButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    fetchMachines();
  }, []);

  const updateMachineSelectorRect = () => {
    const button = machineSelectorButtonRef.current;
    if (!button) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const viewportPadding = 12;
    const preferredMaxHeight = 320;
    const minUsableHeight = 180;
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const openAbove = availableBelow < minUsableHeight && availableAbove > availableBelow;
    const maxHeight = Math.max(
      minUsableHeight,
      Math.min(preferredMaxHeight, openAbove ? availableAbove : availableBelow)
    );

    setMachineSelectorRect({
      left: Math.max(viewportPadding, rect.left),
      top: openAbove ? Math.max(viewportPadding, rect.top - maxHeight - 8) : rect.bottom + 8,
      width: Math.min(rect.width, window.innerWidth - viewportPadding * 2),
      maxHeight,
    });
  };

  useEffect(() => {
    if (!showMachineSelector) {
      setMachineSelectorRect(null);
      return;
    }

    updateMachineSelectorRect();
    window.addEventListener('resize', updateMachineSelectorRect);
    window.addEventListener('scroll', updateMachineSelectorRect, true);

    return () => {
      window.removeEventListener('resize', updateMachineSelectorRect);
      window.removeEventListener('scroll', updateMachineSelectorRect, true);
    };
  }, [showMachineSelector]);

  const fetchMachines = async () => {
    try {
      setLoading(true);
      const response = await fetch(API_ENDPOINTS.GET_AVAILABLE_MACHINES);
      if (!response.ok) throw new Error('Errore nel caricamento dei macchinari');
      const data = await response.json();
      setMachines(data);
      setSelectedMachine(null);
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

  const filteredMachines = useMemo(() => {
    const normalizedSearch = machineSearch.trim().toLowerCase();
    if (!normalizedSearch) {
      return machines;
    }

    return machines.filter((machine) => {
      const haystack = `${machine.nome} ${machine.reparto} ${machine.id_postazione}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [machineSearch, machines]);

  const toggleMachineSelector = () => {
    const nextValue = !showMachineSelector;
    setShowMachineSelector(nextValue);
    if (nextValue) {
      window.requestAnimationFrame(updateMachineSelectorRect);
    }
  };

  return (
    <>
      <div className="h-full min-h-0">
        <motion.div
          initial={{ scale: 0.97, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.35 }}
          className="grid h-full gap-4 md:min-h-0 md:grid-cols-[minmax(280px,0.95fr)_minmax(360px,1.05fr)]"
        >
          <section className="flex min-h-[280px] flex-col rounded-[24px] border border-white/10 bg-slate-950/20 p-4 text-center backdrop-blur-sm sm:min-h-[340px] sm:p-6 md:min-h-0">
            <div className="flex flex-1 flex-col items-center justify-center">
              <div className="relative inline-block">
                <div className={`flex h-36 w-36 items-center justify-center rounded-[24px] border-4 border-white/20 bg-gradient-to-br from-blue-500/20 to-cyan-500/10 backdrop-blur-sm sm:h-44 sm:w-44 ${scanning ? 'animate-pulse' : ''}`}>
                  <img
                    src={badgeIcon}
                    alt="Badge Reader"
                    className="h-24 w-24 object-contain sm:h-32 sm:w-32"
                  />
                </div>

                {scanning && (
                  <motion.div
                    className="absolute inset-0 rounded-[24px] border-4 border-blue-400"
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

          <section className="flex min-h-[420px] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/25 backdrop-blur-sm md:min-h-0">
            <div className="shrink-0 border-b border-white/10 px-4 py-4 sm:px-5">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Accesso operatore</p>
              <h3 className="mt-1 text-lg font-semibold text-white">Seleziona il macchinario e il metodo di accesso</h3>
              <p className="mt-1 text-sm text-slate-400">
                Scegli la postazione corrente e accedi con badge o credenziali per iniziare la sessione.
              </p>
            </div>

            <ScrollArea className="flex-1 px-4 py-4 sm:px-5 md:min-h-0 md:pr-3">
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
                      ref={machineSelectorButtonRef}
                      onClick={toggleMachineSelector}
                      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/10 px-4 py-4 text-left transition-colors hover:bg-white/15"
                    >
                      <div className="min-w-0">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Macchinario selezionato</div>
                        <div className="truncate text-lg font-semibold text-white">{selectedMachine?.nome || 'Seleziona...'}</div>
                        <div className="truncate text-xs text-slate-400">{selectedMachine?.reparto} - {selectedMachine?.id_postazione}</div>
                      </div>
                      <ChevronDown className={`h-5 w-5 shrink-0 transition-transform ${showMachineSelector ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    onClick={simulateBadgeScan}
                    disabled={scanning || !selectedMachine || machines.length === 0}
                    className="flex min-h-12 items-center justify-center gap-3 rounded-2xl bg-blue-500 px-5 py-4 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-600"
                  >
                    <UserCircle className="h-5 w-5" />
                    {scanning ? 'Scansione in corso...' : 'Simula scansione badge'}
                  </button>

                  <button
                    onClick={() => setShowCredentialsLogin(true)}
                    disabled={!selectedMachine || machines.length === 0}
                    className="flex min-h-12 items-center justify-center gap-3 rounded-2xl bg-cyan-500 px-5 py-4 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
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

      {showMachineSelector && machineSelectorRect && createPortal(
        <div
          className="fixed z-[9999] overflow-hidden rounded-2xl border border-white/20 bg-slate-900 shadow-2xl"
          style={{
            left: machineSelectorRect.left,
            top: machineSelectorRect.top,
            width: machineSelectorRect.width,
          }}
        >
          <div className="border-b border-white/10 p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={machineSearch}
                onChange={(event) => setMachineSearch(event.target.value)}
                placeholder="Cerca macchina, reparto o postazione..."
                className="w-full rounded-xl border border-white/15 bg-white/10 py-3 pl-9 pr-3 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                autoFocus
              />
            </div>
          </div>

          <div
            className="overflow-y-auto overscroll-contain p-2"
            style={{ maxHeight: machineSelectorRect.maxHeight }}
          >
            {filteredMachines.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                Nessun macchinario trovato.
              </div>
            ) : (
              filteredMachines.map((machine) => (
                <button
                  key={machine.id}
                  onClick={() => {
                    setSelectedMachine(machine);
                    setShowMachineSelector(false);
                    setMachineSearch('');
                  }}
                  className={`w-full rounded-xl px-4 py-3 text-left transition-colors hover:bg-white/10 ${
                    selectedMachine?.id === machine.id ? 'bg-blue-500/20' : ''
                  }`}
                >
                  <div className="font-semibold text-white">{machine.nome}</div>
                  <div className="text-xs text-slate-400">{machine.reparto} - {machine.id_postazione}</div>
                </button>
              ))
            )}
          </div>
        </div>,
        document.body
      )}

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
