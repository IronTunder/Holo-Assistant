import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Circle, Shield } from 'lucide-react';
import { ScrollArea } from '@/shared/ui/scroll-area';
import { API_ENDPOINTS } from '@/shared/api/config';
import { useApiClient } from '@/shared/api/apiClient';

interface StartupChecklistDialogProps {
  machineId: number;
  machineName: string;
  accessToken: string;
  onComplete: () => void;
}

interface WorkingStationResponse {
  id: number;
  name: string;
  startup_checklist: string[];
  department_id: number | null;
  department_name: string | null;
  reparto: string | null;
  in_uso: boolean;
  operatore_attuale_id: number | null;
}

export function StartupChecklistDialog({
  machineId,
  machineName,
  accessToken,
  onComplete,
}: StartupChecklistDialogProps) {
  const { apiCall } = useApiClient();
  const [checklist, setChecklist] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkedItems, setCheckedItems] = useState<Set<number>>(new Set());
  const [compactMode, setCompactMode] = useState(false);

  useEffect(() => {
    const fetchChecklist = async () => {
      try {
        const response = await apiCall(API_ENDPOINTS.GET_WORKING_STATION(machineId), {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        });
        if (!response.ok) {
          throw new Error('Impossibile caricare la checklist');
        }
        const data: WorkingStationResponse = await response.json();
        setChecklist(data.startup_checklist || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Errore sconosciuto');
      } finally {
        setLoading(false);
      }
    };

    fetchChecklist();
  }, [machineId, accessToken, apiCall]);

  useEffect(() => {
    const updateCompactMode = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      setCompactMode(viewportHeight <= 760);
    };

    updateCompactMode();

    window.addEventListener('resize', updateCompactMode);
    window.addEventListener('orientationchange', updateCompactMode);
    window.visualViewport?.addEventListener('resize', updateCompactMode);

    return () => {
      window.removeEventListener('resize', updateCompactMode);
      window.removeEventListener('orientationchange', updateCompactMode);
      window.visualViewport?.removeEventListener('resize', updateCompactMode);
    };
  }, []);

  const allChecked = checkedItems.size === checklist.length;

  const toggleItem = (index: number) => {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    if (allChecked) {
      onComplete();
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/70 p-2 backdrop-blur-sm sm:items-center sm:p-4"
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="flex min-h-0 w-full max-w-lg flex-col overflow-hidden rounded-[1.5rem] border border-white/20 bg-slate-900/95 shadow-2xl backdrop-blur-md sm:rounded-3xl"
          style={{ maxHeight: 'calc(var(--app-viewport-height, 100dvh) - 1rem)' }}
        >
          {/* Header */}
          <div className={`shrink-0 border-b border-white/10 px-4 text-center sm:px-6 ${compactMode ? 'py-3' : 'py-4 sm:py-5'}`}>
            <h2 className={`font-bold text-white ${compactMode ? 'text-base sm:text-lg' : 'text-lg sm:text-xl'}`}>Checklist pre-avvio</h2>
            <p className={`mt-1 text-slate-400 ${compactMode ? 'text-xs sm:text-sm' : 'text-sm'}`}>
              Completare tutti i controlli per <span className="font-semibold text-blue-400">{machineName}</span>
            </p>
          </div>

          {/* Checklist */}
          <ScrollArea className="min-h-0 flex-1">
            <div className={`px-4 sm:px-6 ${compactMode ? 'space-y-2.5 py-2.5' : 'space-y-4 py-4'}`}>
              <div className={`rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 ${compactMode ? 'py-2' : 'py-3'}`}>
                <p className={`text-center text-amber-200 ${compactMode ? 'text-xs sm:text-sm' : 'text-sm'}`}>
                  <Shield className={`mb-0.5 mr-1.5 inline-block ${compactMode ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
                  Tutti i controlli devono essere completati prima di procedere
                </p>
              </div>

            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-400 border-t-transparent"></div>
              </div>
            ) : error ? (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-center text-sm text-red-200">
                {error}
              </div>
            ) : checklist.length === 0 ? (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-center text-sm text-amber-200">
                Nessuna checklist configurata per questa macchina
              </div>
            ) : (
              <div className={compactMode ? 'space-y-2' : 'space-y-3'}>
                {checklist.map((item, index) => {
                  const isChecked = checkedItems.has(index);
                  return (
                    <button
                      key={index}
                      type="button"
                      onClick={() => toggleItem(index)}
                      className={`w-full rounded-xl border text-left transition-all ${
                        isChecked
                          ? 'border-green-500/40 bg-green-500/10'
                          : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                      } ${compactMode ? 'px-3 py-2.5' : 'px-4 py-3'}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 shrink-0">
                          {isChecked ? (
                            <CheckCircle2 className={`${compactMode ? 'h-4 w-4' : 'h-5 w-5'} text-green-400`} />
                          ) : (
                            <Circle className={`${compactMode ? 'h-4 w-4' : 'h-5 w-5'} text-slate-500`} />
                          )}
                        </div>
                        <span
                          className={`${compactMode ? 'text-xs leading-5 sm:text-sm' : 'text-sm leading-relaxed'} ${
                            isChecked ? 'text-green-100' : 'text-slate-200'
                          }`}
                        >
                          {item}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            </div>
          </ScrollArea>

          {/* Footer */}
          <div
            className={`shrink-0 border-t border-white/10 px-4 sm:px-6 ${compactMode ? 'py-2.5' : 'py-3 sm:py-4'}`}
            style={{
              paddingBottom: compactMode
                ? 'calc(env(safe-area-inset-bottom, 0px) + 0.625rem)'
                : 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)',
            }}
          >
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!allChecked}
              className={`w-full rounded-xl font-semibold transition-colors ${
                allChecked
                  ? 'bg-blue-500 text-white hover:bg-blue-600'
                  : 'cursor-not-allowed bg-slate-700 text-slate-400'
              } ${compactMode ? 'py-2.5 text-xs sm:text-sm' : 'py-3 text-sm'}`}
            >
              {allChecked ? 'Conferma e procedi' : `Completa tutti i controlli (${checkedItems.size}/${checklist.length})`}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
