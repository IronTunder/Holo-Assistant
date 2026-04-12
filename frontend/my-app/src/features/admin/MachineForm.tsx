import { useEffect, useMemo, useState } from 'react';

import API_ENDPOINTS from '@/shared/api/config';
import { useApiClient } from '@/shared/api/apiClient';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminMachine, AdminWorkingStation, DepartmentOption } from './adminTypes';

interface MachineFormProps {
  isOpen: boolean;
  onClose: () => void;
  machine: AdminMachine | null;
  departments: DepartmentOption[];
  workingStations: AdminWorkingStation[];
  onSuccess: () => void;
}

export const MachineForm = ({ isOpen, onClose, machine, departments, workingStations, onSuccess }: MachineFormProps) => {
  const { apiCall } = useApiClient();
  const [nome, setNome] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [descrizione, setDescrizione] = useState('');
  const [idPostazione, setIdPostazione] = useState('');
  const [workingStationId, setWorkingStationId] = useState('');
  const [startupChecklist, setStartupChecklist] = useState<string[]>(['']);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (machine) {
      setNome(machine.nome);
      setDepartmentId(machine.department_id ? String(machine.department_id) : '');
      setDescrizione(machine.descrizione || '');
      setIdPostazione(machine.id_postazione || '');
      setWorkingStationId(machine.working_station_id ? String(machine.working_station_id) : 'none');
      setStartupChecklist(machine.startup_checklist?.length ? machine.startup_checklist : ['']);
      return;
    }

    setNome('');
    setDepartmentId(departments[0] ? String(departments[0].id) : '');
    setDescrizione('');
    setIdPostazione('');
    setWorkingStationId('none');
    setStartupChecklist(['']);
  }, [departments, isOpen, machine]);

  const availableWorkingStations = useMemo(() => {
    return workingStations.filter((workingStation) => {
      if (workingStation.assigned_machine == null) {
        return true;
      }

      return workingStation.id === machine?.working_station_id;
    });
  }, [machine?.working_station_id, workingStations]);

  const inlineError = useMemo(() => {
    const checklistItems = startupChecklist.map((item) => item.trim());
    if (!departmentId) {
      return 'Seleziona un reparto per il macchinario.';
    }
    if (workingStationId === 'none' || !idPostazione.trim()) {
      return 'Seleziona una postazione disponibile.';
    }
    if (!checklistItems.length || checklistItems.some((item) => !item)) {
      return 'Aggiungi almeno un controllo checklist e compila tutte le voci.';
    }
    return null;
  }, [departmentId, idPostazione, startupChecklist, workingStationId]);

  const updateChecklistItem = (index: number, value: string) => {
    setStartupChecklist((currentItems) =>
      currentItems.map((item, itemIndex) => (itemIndex === index ? value : item))
    );
  };

  const addChecklistItem = () => {
    setStartupChecklist((currentItems) => [...currentItems, '']);
  };

  const removeChecklistItem = (index: number) => {
    setStartupChecklist((currentItems) => {
      const nextItems = currentItems.filter((_, itemIndex) => itemIndex !== index);
      return nextItems.length ? nextItems : [''];
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inlineError) {
      toast.error(inlineError);
      return;
    }

    setIsLoading(true);
    try {
      const payload = {
        nome,
        department_id: Number(departmentId),
        descrizione: descrizione.trim() || null,
        id_postazione: idPostazione.trim() || null,
        working_station_id: workingStationId !== 'none' ? Number(workingStationId) : null,
        startup_checklist: startupChecklist.map((item) => item.trim()),
      };

      const response = await apiCall(
        machine ? API_ENDPOINTS.UPDATE_ADMIN_MACHINE(machine.id) : API_ENDPOINTS.CREATE_ADMIN_MACHINE,
        {
          method: machine ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        throw new Error('Errore nel salvataggio macchinario');
      }

      toast.success(machine ? 'Macchinario aggiornato' : 'Macchinario creato');
      onSuccess();
    } catch (error) {
      console.error(error);
      toast.error('Errore durante il salvataggio del macchinario');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{machine ? 'Modifica macchinario' : 'Nuovo macchinario'}</DialogTitle>
          <DialogDescription>
            Assegna il macchinario a un reparto centrale e compila i dati base della postazione.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome</label>
              <Input value={nome} onChange={(event) => setNome(event.target.value)} required />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Reparto</label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona reparto" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((department) => (
                    <SelectItem key={department.id} value={String(department.id)}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Descrizione</label>
              <Input value={descrizione} onChange={(event) => setDescrizione(event.target.value)} />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Postazione associata</label>
              <Select
                value={workingStationId}
                onValueChange={(value) => {
                  setWorkingStationId(value);
                  if (value === 'none') {
                    setIdPostazione('');
                    return;
                  }

                  const selectedWorkingStation = availableWorkingStations.find(
                    (workingStation) => String(workingStation.id) === value
                  );
                  setIdPostazione(selectedWorkingStation?.station_code || '');
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona una postazione disponibile" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nessuna postazione</SelectItem>
                  {availableWorkingStations.map((workingStation) => (
                    <SelectItem key={workingStation.id} value={String(workingStation.id)}>
                      {workingStation.name} - {workingStation.station_code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Codice postazione</label>
              <Input value={idPostazione} readOnly className="bg-slate-50 text-slate-600" placeholder="Seleziona una postazione disponibile" />
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">Checklist pre-avvio</p>
                <p className="text-xs text-slate-500">
                  Controlli obbligatori da completare prima di usare il macchinario.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addChecklistItem} className="gap-2">
                <Plus className="h-4 w-4" />
                Aggiungi controllo
              </Button>
            </div>

            <div className="space-y-2">
              {startupChecklist.map((item, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={item}
                    onChange={(event) => updateChecklistItem(index, event.target.value)}
                    placeholder={`Controllo ${index + 1}`}
                    required
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => removeChecklistItem(index)}
                    className="shrink-0 text-red-600 hover:bg-red-50 hover:text-red-800"
                    aria-label={`Rimuovi controllo ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {inlineError ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {inlineError}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annulla
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Salvataggio...' : 'Salva macchinario'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
