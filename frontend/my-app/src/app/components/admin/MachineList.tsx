// frontend/my-app/src/app/components/admin/MachineList.tsx

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card } from '../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Plus, Edit2, Trash2, RotateCw, Eye } from 'lucide-react';
import { toast } from 'sonner';
import API_ENDPOINTS from '../../../api/config';
import { MachineForm } from './MachineForm';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';

interface MachineOperator {
  id: number;
  nome: string;
  badge_id: string;
  reparto: string;
  turno: string;
  livello_esperienza: string;
}

interface Machine {
  id: number;
  nome: string;
  reparto: string;
  descrizione?: string;
  id_postazione?: string;
  in_uso: boolean;
  operatore_attuale_id?: number;
  operator?: MachineOperator | null;
  deleted?: boolean;
}

const POLLING_WARMUP_MS = 60_000;
const POLLING_WARMUP_INTERVAL_MS = 10_000;
const POLLING_STEADY_INTERVAL_MS = 30_000;

export const MachineList = () => {
  const { accessToken, isAdmin, refreshAccessToken } = useAuth();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingMachine, setEditingMachine] = useState<Machine | null>(null);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [detailsMachineId, setDetailsMachineId] = useState<number | null>(null);

  const getCurrentAccessToken = useCallback(() => {
    return localStorage.getItem('accessToken') || accessToken;
  }, [accessToken]);

  const authorizedFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}, allowRetry = true): Promise<Response> => {
      const token = getCurrentAccessToken();
      const headers = new Headers(init.headers);

      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      const response = await fetch(input, {
        ...init,
        headers,
      });

      if (response.status === 401 && allowRetry) {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          return authorizedFetch(input, init, false);
        }
      }

      return response;
    },
    [getCurrentAccessToken, refreshAccessToken]
  );

  const sortMachines = useCallback((items: Machine[]) => {
    return [...items].sort((left, right) => left.nome.localeCompare(right.nome, 'it'));
  }, []);

  const applyMachineUpdate = useCallback((incoming: Machine) => {
    setMachines((currentMachines) => {
      if (incoming.deleted) {
        return currentMachines.filter((machine) => machine.id !== incoming.id);
      }

      const nextMachines = currentMachines.filter((machine) => machine.id !== incoming.id);
      nextMachines.push({
        ...incoming,
        deleted: false,
      });
      return sortMachines(nextMachines);
    });
  }, [sortMachines]);

  const fetchMachines = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setIsLoading(true);
    }

    try {
      const response = await authorizedFetch(API_ENDPOINTS.LIST_MACHINES);

      if (!response.ok) throw new Error('Errore');
      const data = await response.json();
      setMachines(sortMachines(data));
      return true;
    } catch (error) {
      console.error('Errore:', error);
      if (!silent) {
        toast.error('Errore nel caricamento macchinari');
      }
      return false;
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, [authorizedFetch, sortMachines]);

  useEffect(() => {
    if (!accessToken || !isAdmin) {
      return;
    }

    let isCancelled = false;
    let pollingTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let streamAbortController: AbortController | null = null;
    let pollingActive = false;
    let pollingInFlight = false;
    let streamHealthy = false;
    const effectStartedAt = Date.now();

    const isVisible = () => document.visibilityState === 'visible';

    const stopPolling = () => {
      pollingActive = false;
      if (pollingTimeoutId) {
        clearTimeout(pollingTimeoutId);
        pollingTimeoutId = null;
      }
    };

    const abortStream = () => {
      if (streamAbortController) {
        streamAbortController.abort();
        streamAbortController = null;
      }
    };

    const cleanupTimers = () => {
      stopPolling();
      if (retryTimeoutId) {
        clearTimeout(retryTimeoutId);
        retryTimeoutId = null;
      }
    };

    const getPollingDelay = () => {
      return Date.now() - effectStartedAt < POLLING_WARMUP_MS
        ? POLLING_WARMUP_INTERVAL_MS
        : POLLING_STEADY_INTERVAL_MS;
    };

    const runPollingCycle = async () => {
      if (
        isCancelled ||
        !pollingActive ||
        pollingInFlight ||
        !isVisible()
      ) {
        return;
      }

      pollingInFlight = true;
      try {
        await fetchMachines({ silent: true });
      } finally {
        pollingInFlight = false;
      }

      if (!isCancelled && pollingActive && !streamHealthy && isVisible()) {
        pollingTimeoutId = setTimeout(runPollingCycle, getPollingDelay());
      }
    };

    const startPolling = () => {
      if (pollingActive || isCancelled || !isVisible()) {
        return;
      }
      pollingActive = true;
      void runPollingCycle();
    };

    const scheduleRetry = () => {
      if (retryTimeoutId || isCancelled || !isVisible()) {
        return;
      }

      retryTimeoutId = setTimeout(() => {
        retryTimeoutId = null;
        void connectMachineStream();
      }, 5000);
    };

    const handleMachineEvent = (eventName: string, rawData: string) => {
      if (eventName === 'heartbeat' || !rawData) {
        return;
      }

      if (eventName !== 'machine_status') {
        return;
      }

      try {
        const payload = JSON.parse(rawData) as Machine;
        applyMachineUpdate(payload);
      } catch (error) {
        console.error('Errore nel parsing evento admin SSE:', error);
      }
    };

    const processSseChunk = (chunk: string) => {
      const blocks = chunk.split('\n\n');
      const remainder = blocks.pop() ?? '';

      for (const block of blocks) {
        const lines = block.split(/\r?\n/);
        let eventName = 'message';
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
          }
        }

        handleMachineEvent(eventName, dataLines.join('\n'));
      }

      return remainder;
    };

    const connectMachineStream = async () => {
      if (isCancelled || !isVisible()) {
        return;
      }

      abortStream();
      streamAbortController = new AbortController();

      try {
        const response = await authorizedFetch(
          API_ENDPOINTS.ADMIN_MACHINE_EVENTS,
          {
            headers: {
              Accept: 'text/event-stream',
            },
            signal: streamAbortController.signal,
          }
        );

        if (!response.ok || !response.body) {
          throw new Error(`Stream admin non disponibile (${response.status})`);
        }

        streamHealthy = true;
        stopPolling();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!isCancelled) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          buffer = processSseChunk(buffer);
        }

        if (buffer.trim()) {
          processSseChunk(`${buffer}\n\n`);
        }

        if (!isCancelled && isVisible()) {
          streamHealthy = false;
          startPolling();
          scheduleRetry();
        }
      } catch (error) {
        if (streamAbortController?.signal.aborted || isCancelled) {
          return;
        }

        console.error('Errore stream admin SSE:', error);
        streamHealthy = false;
        startPolling();
        scheduleRetry();
      }
    };

    const handleVisibilityChange = () => {
      if (!isVisible()) {
        abortStream();
        cleanupTimers();
        streamHealthy = false;
        return;
      }

      void fetchMachines({ silent: true });
      void connectMachineStream();
    };

    void (async () => {
      await fetchMachines();
      if (!isCancelled && isVisible()) {
        await connectMachineStream();
      }
    })();

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isCancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      abortStream();
      cleanupTimers();
    };
  }, [accessToken, applyMachineUpdate, authorizedFetch, fetchMachines, isAdmin]);

  const handleDeleteMachine = async (machineId: number) => {
    try {
      const response = await authorizedFetch(API_ENDPOINTS.DELETE_ADMIN_MACHINE(machineId), {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Errore');
      toast.success('Macchinario eliminato');
      setIsDeleteOpen(false);
    } catch (error) {
      console.error('Errore:', error);
      toast.error('Errore nella eliminazione');
    }
  };

  const handleResetStatus = async (machineId: number) => {
    try {
      const response = await authorizedFetch(API_ENDPOINTS.RESET_MACHINE_STATUS(machineId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) throw new Error('Errore');
      toast.success('Stato macchinario resettato');
    } catch (error) {
      console.error('Errore:', error);
      toast.error('Errore nel reset stato');
    }
  };

  const filteredMachines = useMemo(() => {
    return machines.filter((machine) =>
      machine.nome.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [machines, searchTerm]);

  const detailsMachine = useMemo(() => {
    if (detailsMachineId === null) {
      return null;
    }

    return machines.find((machine) => machine.id === detailsMachineId) ?? null;
  }, [detailsMachineId, machines]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2 justify-between">
        <Input
          placeholder="Cerca per nome..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="sm:max-w-xs"
        />
        <Button
          onClick={() => {
            setEditingMachine(null);
            setIsFormOpen(true);
          }}
          className="gap-2"
        >
          <Plus className="w-4 h-4" />
          Nuovo Macchinario
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="font-semibold">Nome</TableHead>
                <TableHead className="font-semibold">Reparto</TableHead>
                <TableHead className="font-semibold">Stato</TableHead>
                <TableHead className="font-semibold">Postazione</TableHead>
                <TableHead className="font-semibold text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                    Caricamento...
                  </TableCell>
                </TableRow>
              ) : filteredMachines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                    Nessun macchinario trovato
                  </TableCell>
                </TableRow>
              ) : (
                filteredMachines.map((machine) => (
                  <TableRow key={machine.id} className="hover:bg-slate-50">
                    <TableCell className="font-medium">{machine.nome}</TableCell>
                    <TableCell className="text-sm">{machine.reparto}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                        machine.in_uso 
                          ? 'bg-yellow-100 text-yellow-800' 
                          : 'bg-green-100 text-green-800'
                      }`}>
                        {machine.in_uso ? 'In uso' : 'Libero'}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{machine.id_postazione || '-'}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingMachine(machine);
                            setIsFormOpen(true);
                          }}
                          title="Modifica"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        {machine.in_uso && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setDetailsMachineId(machine.id);
                              setIsDetailsOpen(true);
                            }}
                            title="Dettagli operatore"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        )}
                        {machine.in_uso && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleResetStatus(machine.id)}
                            title="Libera macchinario"
                          >
                            <RotateCw className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-800 hover:bg-red-50"
                          onClick={() => {
                            setSelectedMachine(machine);
                            setIsDeleteOpen(true);
                          }}
                          title="Elimina"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <MachineForm
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditingMachine(null);
        }}
        machine={editingMachine}
        onSuccess={() => {
          void fetchMachines();
          setIsFormOpen(false);
          setEditingMachine(null);
        }}
      />

      {selectedMachine && (
        <DeleteConfirmDialog
          isOpen={isDeleteOpen}
          onClose={() => {
            setIsDeleteOpen(false);
            setSelectedMachine(null);
          }}
          title="Eliminare macchinario?"
          description={`Sei certo di voler eliminare "${selectedMachine.nome}"? Questa azione non può essere annullata.`}
          onConfirm={() => handleDeleteMachine(selectedMachine.id)}
        />
      )}

      <Dialog
        open={isDetailsOpen}
        onOpenChange={(open) => {
          setIsDetailsOpen(open);
          if (!open) {
            setDetailsMachineId(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Dettagli utilizzo macchinario</DialogTitle>
            <DialogDescription>
              Stato in tempo reale dell&apos;operatore associato alla macchina selezionata.
            </DialogDescription>
          </DialogHeader>

          {!detailsMachine ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Macchinario non piu disponibile.
            </div>
          ) : !detailsMachine.in_uso ? (
            <div className="space-y-2 rounded-lg border border-green-200 bg-green-50 p-4">
              <p className="text-sm font-semibold text-green-800">{detailsMachine.nome}</p>
              <p className="text-sm text-green-700">La macchina e ora libera.</p>
            </div>
          ) : detailsMachine.operator ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm text-slate-500">Macchinario</p>
                <p className="font-semibold text-slate-900">{detailsMachine.nome}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Operatore</p>
                  <p className="mt-1 font-medium text-slate-900">{detailsMachine.operator.nome}</p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Badge ID</p>
                  <p className="mt-1 font-medium text-slate-900">{detailsMachine.operator.badge_id}</p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Reparto</p>
                  <p className="mt-1 font-medium text-slate-900">{detailsMachine.operator.reparto}</p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Turno</p>
                  <p className="mt-1 font-medium text-slate-900">{detailsMachine.operator.turno}</p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3 sm:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Livello esperienza</p>
                  <p className="mt-1 font-medium text-slate-900">{detailsMachine.operator.livello_esperienza}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Operatore non disponibile per questo macchinario.
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
