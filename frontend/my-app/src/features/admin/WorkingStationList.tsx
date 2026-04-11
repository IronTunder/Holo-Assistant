import { useCallback, useEffect, useMemo, useState } from 'react';

import API_ENDPOINTS from '@/shared/api/config';
import { useApiClient } from '@/shared/api/apiClient';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { toast } from 'sonner';
import type { AdminWorkingStation, DepartmentOption } from './adminTypes';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';

interface WorkingStationListProps {
  departments: DepartmentOption[];
  onMetadataRefresh: () => Promise<void>;
}

const emptyForm = {
  name: '',
  stationCode: '',
  description: '',
  departmentId: '',
  startupChecklist: [''],
};

export function WorkingStationList({ departments, onMetadataRefresh }: WorkingStationListProps) {
  const { apiCall } = useApiClient();
  const [workingStations, setWorkingStations] = useState<AdminWorkingStation[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingWorkingStation, setEditingWorkingStation] = useState<AdminWorkingStation | null>(null);
  const [selectedWorkingStation, setSelectedWorkingStation] = useState<AdminWorkingStation | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [formState, setFormState] = useState(emptyForm);

  const fetchWorkingStations = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await apiCall(API_ENDPOINTS.LIST_WORKING_STATIONS);
      if (!response.ok) {
        throw new Error('Errore nel caricamento postazioni');
      }
      const data = (await response.json()) as AdminWorkingStation[];
      setWorkingStations(data.sort((a, b) => a.name.localeCompare(b.name, 'it')));
    } catch (error) {
      console.error(error);
      toast.error('Errore nel caricamento postazioni');
    } finally {
      setIsLoading(false);
    }
  }, [apiCall]);

  useEffect(() => {
    void fetchWorkingStations();
  }, [fetchWorkingStations]);

  const filteredWorkingStations = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase();
    if (!normalized) {
      return workingStations;
    }
    return workingStations.filter((workingStation) =>
      `${workingStation.name} ${workingStation.station_code} ${workingStation.reparto || ''} ${workingStation.assigned_machine?.nome || ''}`
        .toLowerCase()
        .includes(normalized)
    );
  }, [searchTerm, workingStations]);

  const resetForm = () => {
    setFormState(emptyForm);
    setEditingWorkingStation(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setIsFormOpen(true);
  };

  const openEditDialog = (workingStation: AdminWorkingStation) => {
    setEditingWorkingStation(workingStation);
    setFormState({
      name: workingStation.name,
      stationCode: workingStation.station_code,
      description: workingStation.description || '',
      departmentId: workingStation.department_id ? String(workingStation.department_id) : '',
      startupChecklist: workingStation.startup_checklist.length > 0 ? workingStation.startup_checklist : [''],
    });
    setIsFormOpen(true);
  };

  const handleSave = async () => {
    if (!formState.name.trim() || !formState.stationCode.trim() || !formState.departmentId) {
      toast.error('Compila nome, codice postazione e reparto');
      return;
    }

    const payload = {
      name: formState.name.trim(),
      station_code: formState.stationCode.trim(),
      description: formState.description.trim() || null,
      department_id: Number(formState.departmentId),
      startup_checklist: formState.startupChecklist.map((item) => item.trim()).filter(Boolean),
    };

    if (payload.startup_checklist.length === 0) {
      toast.error('Inserisci almeno un controllo checklist');
      return;
    }

    try {
      const response = await apiCall(
        editingWorkingStation
          ? API_ENDPOINTS.UPDATE_WORKING_STATION(editingWorkingStation.id)
          : API_ENDPOINTS.CREATE_WORKING_STATION,
        {
          method: editingWorkingStation ? 'PUT' : 'POST',
          body: JSON.stringify(payload),
        }
      );
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.detail || 'Errore salvataggio postazione');
      }
      toast.success(editingWorkingStation ? 'Postazione aggiornata' : 'Postazione creata');
      setIsFormOpen(false);
      resetForm();
      await Promise.all([fetchWorkingStations(), onMetadataRefresh()]);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Errore salvataggio postazione');
    }
  };

  const handleDelete = async () => {
    if (!selectedWorkingStation) {
      return;
    }
    try {
      const response = await apiCall(API_ENDPOINTS.DELETE_WORKING_STATION(selectedWorkingStation.id), {
        method: 'DELETE',
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.detail || 'Errore eliminazione postazione');
      }
      toast.success('Postazione eliminata');
      setIsDeleteOpen(false);
      setSelectedWorkingStation(null);
      await Promise.all([fetchWorkingStations(), onMetadataRefresh()]);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Errore eliminazione postazione');
    }
  };

  return (

    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Cerca per nome, codice o macchinario..."
          className="sm:max-w-sm"
        />
        <Button onClick={openCreateDialog}>Nuova postazione</Button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Codice</TableHead>
              <TableHead>Reparto</TableHead>
              <TableHead>Macchinario associato</TableHead>
              <TableHead>Stato</TableHead>
              <TableHead className="text-right">Azioni</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6}>Caricamento postazioni...</TableCell>
              </TableRow>
            ) : filteredWorkingStations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>Nessuna postazione trovata.</TableCell>
              </TableRow>
            ) : (
              filteredWorkingStations.map((workingStation) => (
                <TableRow key={workingStation.id}>
                  <TableCell className="font-medium">{workingStation.name}</TableCell>
                  <TableCell>{workingStation.station_code}</TableCell>
                  <TableCell>{workingStation.reparto || '-'}</TableCell>
                  <TableCell>{workingStation.assigned_machine?.nome || '-'}</TableCell>
                  <TableCell>{workingStation.in_uso ? 'In uso' : 'Libera'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEditDialog(workingStation)} disabled={workingStation.in_uso}>
                        Modifica
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedWorkingStation(workingStation);
                          setIsDeleteOpen(true);
                        }}
                        disabled={workingStation.in_uso}
                      >
                        Elimina
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={isFormOpen}
        onOpenChange={(open) => {
          setIsFormOpen(open);
          if (!open) {
            resetForm();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingWorkingStation ? 'Modifica postazione' : 'Nuova postazione'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={formState.name}
              onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))}
              placeholder="Nome postazione"
            />
            <Input
              value={formState.stationCode}
              onChange={(event) => setFormState((current) => ({ ...current, stationCode: event.target.value }))}
              placeholder="Codice postazione"
            />
            <select
              value={formState.departmentId}
              onChange={(event) => setFormState((current) => ({ ...current, departmentId: event.target.value }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">Seleziona reparto</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
            <Input
              value={formState.description}
              onChange={(event) => setFormState((current) => ({ ...current, description: event.target.value }))}
              placeholder="Descrizione"
            />
            <div className="space-y-2">
              {formState.startupChecklist.map((item, index) => (
                <Input
                  key={`${index}-${item}`}
                  value={item}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      startupChecklist: current.startupChecklist.map((entry, entryIndex) =>
                        entryIndex === index ? event.target.value : entry
                      ),
                    }))
                  }
                  placeholder={`Controllo ${index + 1}`}
                />
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setFormState((current) => ({
                    ...current,
                    startupChecklist: [...current.startupChecklist, ''],
                  }))
                }
              >
                Aggiungi controllo
              </Button>
            </div>
            <Button onClick={handleSave} className="w-full">
              {editingWorkingStation ? 'Salva modifiche' : 'Crea postazione'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        isOpen={isDeleteOpen}
        onClose={() => {
          setIsDeleteOpen(false);
          setSelectedWorkingStation(null);
        }}
        title="Eliminare postazione?"
        description={selectedWorkingStation ? `Questa azione rimuovera la postazione ${selectedWorkingStation.name}.` : ''}
        onConfirm={handleDelete}
      />
    </div>
  );
}
