import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { UserCircle, ChevronDown, Search, Lock, User } from 'lucide-react';
import { motion } from 'motion/react';
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
  const badgeIcon = '/holo-mark.png';
  const [scanning, setScanning] = useState(false);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [showMachineSelector, setShowMachineSelector] = useState(false);
  const [machineSearch, setMachineSearch] = useState('');
  const [machineSelectorRect, setMachineSelectorRect] = useState<MachineSelectorRect | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const machineSelectorButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    void fetchMachines();
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

  const handleCredentialsSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedMachine) {
      setError('Seleziona un macchinario prima di procedere');
      return;
    }

    if (!username.trim() || !password) {
      setError('Inserisci username e password');
      return;
    }

    setError(null);
    onCredentialsLogin(username.trim(), password, selectedMachine.id);
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
          className="grid h-full min-h-0 gap-4 overflow-hidden grid-rows-[minmax(14rem,0.82fr)_minmax(0,1.18fr)] md:grid-cols-[minmax(280px,0.95fr)_minmax(360px,1.05fr)] md:grid-rows-1"
        >
          <section className="flex min-h-0 flex-col overflow-hidden p-4 text-center sm:p-6">
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
              <div
                className="flex w-full max-w-md flex-col items-center gap-[clamp(0.875rem,1.8vh,1.25rem)]"
                style={{ transform: 'scale(clamp(0.84, calc((100dvh - 8rem) / 42rem), 1))', transformOrigin: 'center center' }}
              >
              <div className="relative inline-block">
                <img
                  src={badgeIcon}
                  alt="Badge Reader"
                  className="h-[clamp(6rem,14vh,9.5rem)] w-[clamp(6rem,14vh,9.5rem)] object-contain"
                />
              </div>

              <div className="space-y-2">
                <h2 className="text-[clamp(1.5rem,3vw,1.875rem)] font-semibold text-white">Benvenuto in Holo-Assistant</h2>
                <p className="max-w-md text-sm leading-6 text-slate-300 sm:text-base">
                  {scanning
                    ? 'Lettura badge in corso...'
                    : 'Seleziona la postazione e accedi senza far scorrere la schermata.'}
                </p>
              </div>

              {machines.length > 0 ? (
                <button
                  ref={machineSelectorButtonRef}
                  onClick={toggleMachineSelector}
                  className="flex w-full rounded-2xl border border-white/15 bg-white/10 px-[clamp(1rem,2vw,1.25rem)] py-[clamp(0.9rem,2vh,1.25rem)] text-left transition-colors hover:bg-white/15"
                >
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Macchinario selezionato</div>
                      <div className="truncate text-base font-semibold text-white sm:text-lg">{selectedMachine?.nome || 'Seleziona...'}</div>
                      <div className="truncate text-xs text-slate-400">{selectedMachine?.reparto} - {selectedMachine?.id_postazione}</div>
                    </div>
                    <ChevronDown className={`h-5 w-5 shrink-0 transition-transform ${showMachineSelector ? 'rotate-180' : ''}`} />
                  </div>
                </button>
              ) : null}

              {loading ? (
                <div className="flex w-full max-w-md items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-slate-300">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"></div>
                  <span>Caricamento macchinari...</span>
                </div>
              ) : error ? (
                <div className="w-full max-w-md rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-4 text-sm text-red-200">
                  {error}
                </div>
              ) : null}
              </div>
            </div>
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/25 backdrop-blur-sm">
            <div className="shrink-0 border-b border-white/10 px-4 py-4 sm:px-5">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Accesso operatore</p>
              <h3 className="mt-1 text-lg font-semibold text-white">Accesso con credenziali</h3>
              <p className="mt-1 text-sm text-slate-400">
                Inserisci le credenziali dell'operatore per iniziare la sessione sulla postazione selezionata.
              </p>
            </div>

            <ScrollArea className="flex-1 min-h-0 px-4 py-4 sm:px-5 md:pr-3">
              <div className="space-y-4">
                {!loading && machines.length === 0 ? (
                  <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-4 text-sm text-amber-100">
                    Nessun macchinario disponibile al momento.
                  </div>
                ) : null}

                <form onSubmit={handleCredentialsSubmit} className="space-y-4">
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

                  <button
                    type="submit"
                    disabled={!selectedMachine || !username.trim() || !password || machines.length === 0}
                    className="w-full rounded-2xl bg-cyan-500 px-5 py-4 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
                  >
                    Accedi con credenziali
                  </button>
                </form>
              </div>
            </ScrollArea>

            <div className="shrink-0 border-t border-white/10 px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-3">
                <p className="text-center text-sm text-slate-400">
                  In alternativa puoi usare il badge dalla stessa postazione.
                </p>
                <button
                  onClick={simulateBadgeScan}
                  disabled={scanning || !selectedMachine || machines.length === 0}
                  className="flex min-h-12 items-center justify-center gap-3 rounded-2xl border border-white/15 bg-white/10 px-5 py-4 text-sm font-semibold text-white transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
                >
                  <UserCircle className="h-5 w-5" />
                  {scanning ? 'Scansione in corso...' : 'Simula scansione badge'}
                </button>
              </div>
            </div>
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
    </>
  );
}
