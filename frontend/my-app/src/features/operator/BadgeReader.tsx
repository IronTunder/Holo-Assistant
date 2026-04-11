import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { UserCircle, ChevronDown, Search, Lock, User } from 'lucide-react';
import { motion } from 'motion/react';
import { ScrollArea } from '@/shared/ui/scroll-area';
import { API_ENDPOINTS } from '@/shared/api/config';

interface WorkingStation {
  id: number;
  name: string;
  reparto: string;
  station_code: string;
  in_uso: boolean;
  assigned_machine?: {
    id: number;
    nome: string;
  } | null;
}

interface BadgeReaderProps {
  onBadgeDetected: (badgeId: string, workingStationId: number) => void;
  onCredentialsLogin: (username: string, password: string, workingStationId: number) => void;
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
  const [workingStations, setWorkingStations] = useState<WorkingStation[]>([]);
  const [selectedWorkingStation, setSelectedWorkingStation] = useState<WorkingStation | null>(null);
  const [showWorkingStationSelector, setShowWorkingStationSelector] = useState(false);
  const [workingStationSearch, setWorkingStationSearch] = useState('');
  const [workingStationSelectorRect, setWorkingStationSelectorRect] = useState<MachineSelectorRect | null>(null);
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
    const preferredMaxHeight = 280;
    const minUsableHeight = 180;
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const openAbove = availableBelow < minUsableHeight && availableAbove > availableBelow;
    const maxHeight = Math.max(
      minUsableHeight,
      Math.min(preferredMaxHeight, openAbove ? availableAbove : availableBelow)
    );

    setWorkingStationSelectorRect({
      left: Math.max(viewportPadding, rect.left),
      top: openAbove ? Math.max(viewportPadding, rect.top - maxHeight - 8) : rect.bottom + 8,
      width: Math.min(rect.width, window.innerWidth - viewportPadding * 2),
      maxHeight,
    });
  };

  useEffect(() => {
    if (!showWorkingStationSelector) {
      setWorkingStationSelectorRect(null);
      return;
    }

    updateMachineSelectorRect();
    window.addEventListener('resize', updateMachineSelectorRect);
    window.addEventListener('scroll', updateMachineSelectorRect, true);

    return () => {
      window.removeEventListener('resize', updateMachineSelectorRect);
      window.removeEventListener('scroll', updateMachineSelectorRect, true);
    };
  }, [showWorkingStationSelector]);

  const fetchMachines = async () => {
    try {
      setLoading(true);
      const response = await fetch(API_ENDPOINTS.GET_AVAILABLE_WORKING_STATIONS);
      if (!response.ok) throw new Error('Errore nel caricamento delle postazioni');
      const data = await response.json();
      setWorkingStations(data);
      setSelectedWorkingStation(null);
      setError(null);
    } catch (err) {
      setError('Impossibile caricare le postazioni disponibili');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const simulateBadgeScan = () => {
    if (!selectedWorkingStation) {
      setError('Seleziona una postazione prima di procedere');
      return;
    }

    setScanning(true);
    setTimeout(() => {
      const badgeId = `NFT-00${Math.floor(Math.random() * 4) + 1}`;
      onBadgeDetected(badgeId, selectedWorkingStation.id);
      setScanning(false);
    }, 1500);
  };

  const handleCredentialsSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedWorkingStation) {
      setError('Seleziona una postazione prima di procedere');
      return;
    }

    if (!username.trim() || !password) {
      setError('Inserisci username e password');
      return;
    }

    setError(null);
    onCredentialsLogin(username.trim(), password, selectedWorkingStation.id);
  };

  const filteredMachines = useMemo(() => {
    const normalizedSearch = workingStationSearch.trim().toLowerCase();
    if (!normalizedSearch) {
      return workingStations;
    }

    return workingStations.filter((workingStation) => {
      const haystack = `${workingStation.name} ${workingStation.reparto} ${workingStation.station_code} ${workingStation.assigned_machine?.nome || ''}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [workingStationSearch, workingStations]);

  const toggleMachineSelector = () => {
    const nextValue = !showWorkingStationSelector;
    setShowWorkingStationSelector(nextValue);
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
          <section className="flex min-h-0 flex-col overflow-hidden p-4 pt-2 text-center sm:p-6 sm:pt-3">
            <div className="flex min-h-0 flex-1 items-start justify-center overflow-hidden">
              <div
                className="flex w-full max-w-md flex-col items-center gap-[clamp(0.875rem,1.8vh,1.25rem)] pt-2 sm:pt-4"
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
                    : 'Seleziona la postazione per poter accedere.'}
                </p>
              </div>

              {workingStations.length > 0 ? (
                <button
                  ref={machineSelectorButtonRef}
                  onClick={toggleMachineSelector}
                  className="flex w-full rounded-2xl border border-white/15 bg-white/10 px-[clamp(1rem,2vw,1.25rem)] py-[clamp(0.9rem,2vh,1.25rem)] text-left transition-colors hover:bg-white/15"
                >
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Postazione selezionata</div>
                      <div className="truncate text-base font-semibold text-white sm:text-lg">{selectedWorkingStation?.name || 'Seleziona...'}</div>
                      <div className="truncate text-xs text-slate-400">
                        {selectedWorkingStation?.reparto} - {selectedWorkingStation?.station_code}
                        {selectedWorkingStation?.assigned_machine ? ` - ${selectedWorkingStation.assigned_machine.nome}` : ''}
                      </div>
                    </div>
                    <ChevronDown className={`h-5 w-5 shrink-0 transition-transform ${showWorkingStationSelector ? 'rotate-180' : ''}`} />
                  </div>
                </button>
              ) : null}

              {loading ? (
                <div className="flex w-full max-w-md items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-slate-300">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"></div>
                  <span>Caricamento postazioni...</span>
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
                {!loading && workingStations.length === 0 ? (
                  <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-4 text-sm text-amber-100">
                    Nessuna postazione disponibile al momento.
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
                    disabled={!selectedWorkingStation || !username.trim() || !password || workingStations.length === 0}
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
                  disabled={scanning || !selectedWorkingStation || workingStations.length === 0}
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

      {showWorkingStationSelector && workingStationSelectorRect && createPortal(
        <div
          className="fixed z-[9999] overflow-hidden rounded-2xl border border-white/20 bg-slate-900 shadow-2xl"
          style={{
            left: workingStationSelectorRect.left,
            top: workingStationSelectorRect.top,
            width: workingStationSelectorRect.width,
          }}
        >
          <div className="border-b border-white/10 p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={workingStationSearch}
                onChange={(event) => setWorkingStationSearch(event.target.value)}
                placeholder="Cerca postazione, reparto o macchinario..."
                className="w-full rounded-xl border border-white/15 bg-white/10 py-3 pl-9 pr-3 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                autoFocus
              />
            </div>
          </div>

          <div
            className="overflow-y-auto overscroll-contain p-2"
            style={{ maxHeight: Math.min(workingStationSelectorRect.maxHeight, 280) }}
          >
            {filteredMachines.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                Nessuna postazione trovata.
              </div>
            ) : (
              filteredMachines.map((workingStation) => (
                <button
                  key={workingStation.id}
                  onClick={() => {
                    setSelectedWorkingStation(workingStation);
                    setShowWorkingStationSelector(false);
                    setWorkingStationSearch('');
                  }}
                  className={`w-full rounded-xl px-4 py-3 text-left transition-colors hover:bg-white/10 ${
                    selectedWorkingStation?.id === workingStation.id ? 'bg-blue-500/20' : ''
                  }`}
                >
                  <div className="font-semibold text-white">{workingStation.name}</div>
                  <div className="text-xs text-slate-400">
                    {workingStation.reparto} - {workingStation.station_code}
                    {workingStation.assigned_machine ? ` - ${workingStation.assigned_machine.nome}` : ''}
                  </div>
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
