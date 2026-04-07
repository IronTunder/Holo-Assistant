import { useCallback, useEffect, useMemo, useState } from 'react';

import API_ENDPOINTS from '@/shared/api/config';
import { useAuth } from '@/shared/auth/AuthContext';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Cpu, Edit2, Eye, Plus, RotateCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminMachine, DepartmentOption } from './adminTypes';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { MachineForm } from './MachineForm';

interface MachineListProps {
  departments: DepartmentOption[];
  onMetadataRefresh: () => Promise<void>;
}

export const MachineList = ({ departments, onMetadataRefresh }: MachineListProps) => {
  const { accessToken, isAdmin, refreshAccessToken } = useAuth();
  const [machines, setMachines] = useState<AdminMachine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingMachine, setEditingMachine] = useState<AdminMachine | null>(null);
  const [selectedMachine, setSelectedMachine] = useState<AdminMachine | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [detailsMachineId, setDetailsMachineId] = useState<number | null>(null);

  const authorizedFetch = useCallback(
    async (
      input: RequestInfo | URL,
      init: RequestInit = {},
      allowRetry = true,
      tokenOverride?: string
    ): Promise<Response> => {
      const token = tokenOverride ?? accessToken;
      const headers = new Headers(init.headers);

      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      const response = await fetch(input, {
        ...init,
        headers,
        credentials: 'include',
      });

      if (response.status === 401 && allowRetry) {
        const refreshedToken = await refreshAccessToken();
        if (refreshedToken) {
          return authorizedFetch(input, init, false, refreshedToken);
        }
      }

      return response;
    },
    [accessToken, refreshAccessToken]
  );

  const sortMachines = useCallback((items: AdminMachine[]) => {
    return [...items].sort((left, right) => left.nome.localeCompare(right.nome, 'it'));
  }, []);

  const applyMachineUpdate = useCallback((incoming: AdminMachine) => {
    setMachines((currentMachines) => {
      if (incoming.deleted) {
        return currentMachines.filter((machine) => machine.id !== incoming.id);
      }

      const nextMachines = currentMachines.filter((machine) => machine.id !== incoming.id);
      nextMachines.push({ ...incoming, deleted: false });
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
      if (!response.ok) {
        throw new Error('Errore nel caricamento macchinari');
      }

      const data = (await response.json()) as AdminMachine[];
      setMachines(sortMachines(data));
      return true;
    } catch (error) {
      console.error(error);
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
    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let streamAbortController: AbortController | null = null;

    const isVisible = () => document.visibilityState === 'visible';

    const abortStream = () => {
      if (streamAbortController) {
        streamAbortController.abort();
        streamAbortController = null;
      }
    };

    const cleanupTimers = () => {
      if (retryTimeoutId) {
        clearTimeout(retryTimeoutId);
        retryTimeoutId = null;
      }
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
      if (eventName === 'heartbeat' || !rawData || eventName !== 'machine_status') {
        return;
      }

      try {
        const payload = JSON.parse(rawData) as AdminMachine;
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
      const controller = new AbortController();
      streamAbortController = controller;

      try {
        const response = await authorizedFetch(
          API_ENDPOINTS.ADMIN_MACHINE_EVENTS,
          {
            headers: { Accept: 'text/event-stream' },
            signal: controller.signal,
          }
        );

        if (!response.ok || !response.body) {
          throw new Error(`Stream admin non disponibile (${response.status})`);
        }

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
          scheduleRetry();
        }
      } catch (error) {
        if (
          controller.signal.aborted ||
          isCancelled ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          return;
        }

        console.error('Errore stream admin SSE:', error);
        scheduleRetry();
      }
    };

    const handleVisibilityChange = () => {
      if (!isVisible()) {
        abortStream();
        cleanupTimers();
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

  const filteredMachines = useMemo(() => {
    return machines.filter((machine) => {
      const matchesSearch =
        machine.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (machine.id_postazione || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchesDepartment =
        departmentFilter === 'all' || String(machine.department_id ?? '') === departmentFilter;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'busy' ? machine.in_uso : !machine.in_uso);

      return matchesSearch && matchesDepartment && matchesStatus;
    });
  }, [departmentFilter, machines, searchTerm, statusFilter]);

  const detailsMachine = useMemo(() => {
    if (detailsMachineId === null) {
      return null;
    }
    return machines.find((machine) => machine.id === detailsMachineId) ?? null;
  }, [detailsMachineId, machines]);

  const handleDeleteMachine = async (machineId: number) => {
    try {
      const response = await authorizedFetch(API_ENDPOINTS.DELETE_ADMIN_MACHINE(machineId), {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Errore');
      }
      toast.success('Macchinario eliminato');
      setIsDeleteOpen(false);
      setSelectedMachine(null);
      await fetchMachines({ silent: true });
      await onMetadataRefresh();
    } catch (error) {
      console.error(error);
      toast.error('Errore nella eliminazione del macchinario');
    }
  };

  const handleResetStatus = async (machineId: number) => {
    try {
      const response = await authorizedFetch(API_ENDPOINTS.RESET_MACHINE_STATUS(machineId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        throw new Error('Errore');
      }
      toast.success('Stato macchinario resettato');
      await fetchMachines({ silent: true });
    } catch (error) {
      console.error(error);
      toast.error('Errore nel reset stato');
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 bg-white">
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-slate-900">
                <Cpu className="h-5 w-5 text-sky-600" />
                <h3 className="text-lg font-semibold">Macchinari</h3>
              </div>
              <p className="text-sm text-slate-500">
                {filteredMachines.length} macchinari visibili, {machines.filter((machine) => machine.in_uso).length} attivi ora
              </p>
            </div>
            <Button
              onClick={() => {
                setEditingMachine(null);
                setIsFormOpen(true);
              }}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Nuovo macchinario
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Input
              placeholder="Cerca per nome o postazione..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Tutti i reparti" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i reparti</SelectItem>
                {departments.map((department) => (
                  <SelectItem key={department.id} value={String(department.id)}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Tutti gli stati" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti gli stati</SelectItem>
                <SelectItem value="free">Liberi</SelectItem>
                <SelectItem value="busy">In uso</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>Macchinario</TableHead>
                <TableHead>Reparto</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead>Postazione</TableHead>
                <TableHead>Checklist</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-slate-500">
                    Caricamento macchinari...
                  </TableCell>
                </TableRow>
              ) : filteredMachines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-slate-500">
                    Nessun macchinario trovato con i filtri correnti
                  </TableCell>
                </TableRow>
              ) : (
                filteredMachines.map((machine) => (
                  <TableRow key={machine.id} className="hover:bg-slate-50/80">
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium text-slate-900">{machine.nome}</p>
                        <p className="text-xs text-slate-500">{machine.descrizione || 'Nessuna descrizione'}</p>
                      </div>
                    </TableCell>
                    <TableCell>{machine.department_name || machine.reparto || '-'}</TableCell>
                    <TableCell>
                      <Badge
                        variant={machine.in_uso ? 'secondary' : 'outline'}
                        className={machine.in_uso ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-800'}
                      >
                        {machine.in_uso ? 'In uso' : 'Libero'}
                      </Badge>
                    </TableCell>
                    <TableCell>{machine.id_postazione || '-'}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          machine.startup_checklist?.length
                            ? 'bg-sky-50 text-sky-800'
                            : 'bg-red-50 text-red-800'
                        }
                      >
                        {machine.startup_checklist?.length || 0}{' '}
                        {(machine.startup_checklist?.length || 0) === 1 ? 'controllo' : 'controlli'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingMachine(machine);
                            setIsFormOpen(true);
                          }}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setDetailsMachineId(machine.id);
                            setIsDetailsOpen(true);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {machine.in_uso ? (
                          <Button size="sm" variant="ghost" onClick={() => handleResetStatus(machine.id)}>
                            <RotateCw className="h-4 w-4" />
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:bg-red-50 hover:text-red-800"
                          onClick={() => {
                            setSelectedMachine(machine);
                            setIsDeleteOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
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
        departments={departments}
        onSuccess={() => {
          void fetchMachines();
          void onMetadataRefresh();
          setIsFormOpen(false);
          setEditingMachine(null);
        }}
      />

      {selectedMachine ? (
        <DeleteConfirmDialog
          isOpen={isDeleteOpen}
          onClose={() => {
            setIsDeleteOpen(false);
            setSelectedMachine(null);
          }}
          title="Eliminare macchinario?"
          description={`Sei certo di voler eliminare "${selectedMachine.nome}"? Questa azione non puo essere annullata.`}
          onConfirm={() => handleDeleteMachine(selectedMachine.id)}
        />
      ) : null}

      <Dialog
        open={isDetailsOpen}
        onOpenChange={(open) => {
          setIsDetailsOpen(open);
          if (!open) {
            setDetailsMachineId(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Dettagli utilizzo macchinario</DialogTitle>
            <DialogDescription>
              Stato in tempo reale del macchinario e dell operatore associato.
            </DialogDescription>
          </DialogHeader>

          {!detailsMachine ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Macchinario non piu disponibile.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Macchinario</p>
                  <p className="mt-1 font-medium text-slate-900">{detailsMachine.nome}</p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Stato</p>
                  <p className="mt-1 font-medium text-slate-900">
                    {detailsMachine.in_uso ? 'In uso' : 'Libero'}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Reparto</p>
                  <p className="mt-1 font-medium text-slate-900">
                    {detailsMachine.department_name || detailsMachine.reparto || '-'}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Postazione</p>
                  <p className="mt-1 font-medium text-slate-900">{detailsMachine.id_postazione || '-'}</p>
                </div>
              </div>

              {detailsMachine.operator ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">Operatore attuale</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Nome</p>
                      <p className="mt-1 font-medium text-slate-900">{detailsMachine.operator.nome}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Badge ID</p>
                      <p className="mt-1 font-medium text-slate-900">{detailsMachine.operator.badge_id}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Reparto</p>
                      <p className="mt-1 font-medium text-slate-900">
                        {detailsMachine.operator.department_name || detailsMachine.operator.reparto || '-'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Turno</p>
                      <p className="mt-1 font-medium text-slate-900">{detailsMachine.operator.turno}</p>
                    </div>
                    <div className="sm:col-span-2">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Livello esperienza</p>
                      <p className="mt-1 font-medium text-slate-900">{detailsMachine.operator.livello_esperienza}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  Nessun operatore associato al momento.
                </div>
              )}

              <div className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">Checklist pre-avvio</p>
                  <Badge variant="outline" className="bg-sky-50 text-sky-800">
                    {detailsMachine.startup_checklist?.length || 0}{' '}
                    {(detailsMachine.startup_checklist?.length || 0) === 1 ? 'controllo' : 'controlli'}
                  </Badge>
                </div>

                {detailsMachine.startup_checklist?.length ? (
                  <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
                    {detailsMachine.startup_checklist.map((item, index) => (
                      <li key={`${index}-${item}`}>{item}</li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    Nessun controllo configurato.
                  </p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
