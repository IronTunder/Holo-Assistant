import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import API_ENDPOINTS from '@/shared/api/config';
import { useApiClient } from '@/shared/api/apiClient';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Textarea } from '@/shared/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';
import { Edit2, MapPinned, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import type { AdminWorkingStation, DepartmentOption, WorkingStationMaterialAssignment } from './adminTypes';
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

function ActionButton({
  label,
  disabled = false,
  destructive = false,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  destructive?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const button = (
    <span className="inline-flex">
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        className={destructive ? 'text-red-600 hover:bg-red-50 hover:text-red-800 disabled:text-red-300' : undefined}
        onClick={onClick}
      >
        {children}
      </Button>
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function WorkingStationList({ departments, onMetadataRefresh }: WorkingStationListProps) {
  const { apiCall } = useApiClient();
  const [workingStations, setWorkingStations] = useState<AdminWorkingStation[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingWorkingStation, setEditingWorkingStation] = useState<AdminWorkingStation | null>(null);
  const [selectedWorkingStation, setSelectedWorkingStation] = useState<AdminWorkingStation | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [formState, setFormState] = useState(emptyForm);
  const [materialAssignmentsByStation, setMaterialAssignmentsByStation] = useState<Record<number, WorkingStationMaterialAssignment[]>>({});

  const fetchWorkingStations = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await apiCall(API_ENDPOINTS.LIST_WORKING_STATIONS);
      if (!response.ok) {
        throw new Error('Errore nel caricamento postazioni');
      }
      const data = (await response.json()) as AdminWorkingStation[];
      setWorkingStations(data.sort((left, right) => left.name.localeCompare(right.name, 'it')));
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

  useEffect(() => {
    if (!workingStations.length) {
      setMaterialAssignmentsByStation({});
      return;
    }

    let isCancelled = false;
    const fetchAssignments = async () => {
      try {
        const entries = await Promise.all(
          workingStations.map(async (workingStation) => {
            const response = await apiCall(API_ENDPOINTS.LIST_WORKING_STATION_MATERIALS(workingStation.id));
            if (!response.ok) {
              return [workingStation.id, []] as const;
            }
            return [workingStation.id, (await response.json()) as WorkingStationMaterialAssignment[]] as const;
          })
        );
        if (!isCancelled) {
          setMaterialAssignmentsByStation(Object.fromEntries(entries));
        }
      } catch (error) {
        console.error(error);
      }
    };

    void fetchAssignments();
    return () => {
      isCancelled = true;
    };
  }, [apiCall, workingStations]);

  const filteredWorkingStations = useMemo(() => {
    return workingStations.filter((workingStation) => {
      const normalizedSearch = searchTerm.trim().toLowerCase();
      const matchesSearch =
        !normalizedSearch ||
        `${workingStation.name} ${workingStation.station_code} ${workingStation.reparto || ''} ${workingStation.assigned_machine?.nome || ''}`
          .toLowerCase()
          .includes(normalizedSearch);
      const matchesDepartment =
        departmentFilter === 'all' || String(workingStation.department_id ?? '') === departmentFilter;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'busy' ? workingStation.in_uso : !workingStation.in_uso);

      return matchesSearch && matchesDepartment && matchesStatus;
    });
  }, [departmentFilter, searchTerm, statusFilter, workingStations]);

  const resetForm = () => {
    setFormState(emptyForm);
    setEditingWorkingStation(null);
    setIsSaving(false);
  };

  const openCreateDialog = () => {
    resetForm();
    setFormState((currentState) => ({
      ...currentState,
      departmentId: departments[0] ? String(departments[0].id) : '',
    }));
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

  const updateChecklistItem = (index: number, value: string) => {
    setFormState((currentState) => ({
      ...currentState,
      startupChecklist: currentState.startupChecklist.map((entry, entryIndex) =>
        entryIndex === index ? value : entry
      ),
    }));
  };

  const addChecklistItem = () => {
    setFormState((currentState) => ({
      ...currentState,
      startupChecklist: [...currentState.startupChecklist, ''],
    }));
  };

  const removeChecklistItem = (index: number) => {
    setFormState((currentState) => {
      const nextChecklist = currentState.startupChecklist.filter((_, entryIndex) => entryIndex !== index);
      return {
        ...currentState,
        startupChecklist: nextChecklist.length > 0 ? nextChecklist : [''],
      };
    });
  };

  const inlineError = useMemo(() => {
    const checklistItems = formState.startupChecklist.map((item) => item.trim());

    if (!formState.name.trim()) {
      return 'Inserisci il nome della postazione.';
    }
    if (!formState.stationCode.trim()) {
      return 'Inserisci il codice della postazione.';
    }
    if (!formState.departmentId) {
      return 'Seleziona un reparto.';
    }
    if (!checklistItems.length || checklistItems.some((item) => !item)) {
      return 'Aggiungi almeno un controllo checklist e compila tutte le voci.';
    }

    return null;
  }, [formState]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inlineError) {
      toast.error(inlineError);
      return;
    }

    const payload = {
      name: formState.name.trim(),
      station_code: formState.stationCode.trim(),
      description: formState.description.trim() || null,
      department_id: Number(formState.departmentId),
      startup_checklist: formState.startupChecklist.map((item) => item.trim()),
    };

    setIsSaving(true);
    try {
      const response = await apiCall(
        editingWorkingStation
          ? API_ENDPOINTS.UPDATE_WORKING_STATION(editingWorkingStation.id)
          : API_ENDPOINTS.CREATE_WORKING_STATION,
        {
          method: editingWorkingStation ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
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
    } finally {
      setIsSaving(false);
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
      <Card className="border-slate-200 bg-white">
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-slate-900">
                <MapPinned className="h-5 w-5 text-sky-600" />
                <h3 className="text-lg font-semibold">Postazioni</h3>
              </div>
              <p className="text-sm text-slate-500">
                {filteredWorkingStations.length} postazioni visibili, {workingStations.filter((workingStation) => workingStation.in_uso).length} in uso
              </p>
            </div>
            <Button onClick={openCreateDialog} className="gap-2">
              <Plus className="h-4 w-4" />
              Nuova postazione
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Cerca per nome, codice o macchinario..."
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
                <SelectItem value="free">Libere</SelectItem>
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
                <TableHead>Postazione</TableHead>
                <TableHead>Reparto</TableHead>
                <TableHead>Macchinario</TableHead>
                <TableHead>Materiali</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead>Checklist</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-slate-500">
                    Caricamento postazioni...
                  </TableCell>
                </TableRow>
              ) : filteredWorkingStations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-slate-500">
                    Nessuna postazione trovata con i filtri correnti
                  </TableCell>
                </TableRow>
              ) : (
                filteredWorkingStations.map((workingStation) => (
                  <TableRow key={workingStation.id} className="hover:bg-slate-50/80">
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium text-slate-900">{workingStation.name}</p>
                        <p className="text-xs text-slate-500">{workingStation.station_code}</p>
                        {workingStation.description ? (
                          <p className="text-xs text-slate-500">{workingStation.description}</p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>{workingStation.department_name || workingStation.reparto || '-'}</TableCell>
                    <TableCell>
                      {workingStation.assigned_machine ? (
                        <div className="space-y-1">
                          <p className="font-medium text-slate-900">{workingStation.assigned_machine.nome}</p>
                          <p className="text-xs text-slate-500">{workingStation.assigned_machine.id_postazione || '-'}</p>
                        </div>
                      ) : (
                        <span className="text-sm text-slate-500">Nessun macchinario</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const assignments = (materialAssignmentsByStation[workingStation.id] || []).filter((assignment) => assignment.is_active);
                        const criticalCount = assignments.filter(
                          (assignment) => assignment.material_stock_status === 'low_stock' || assignment.material_stock_status === 'out_of_stock'
                        ).length;
                        if (!assignments.length) {
                          return <span className="text-sm text-slate-500">Nessuno</span>;
                        }
                        return (
                          <div className="space-y-1">
                            <div className="flex flex-wrap gap-2">
                              <Badge variant="outline">{assignments.length} assegnati</Badge>
                              {criticalCount > 0 ? (
                                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                                  {criticalCount} critici
                                </Badge>
                              ) : null}
                            </div>
                            <p className="text-xs text-slate-500">
                              {assignments.slice(0, 2).map((assignment) => assignment.material_name).join(', ')}
                              {assignments.length > 2 ? '...' : ''}
                            </p>
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={workingStation.in_uso ? 'secondary' : 'outline'}
                        className={workingStation.in_uso ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-800'}
                      >
                        {workingStation.in_uso ? 'In uso' : 'Libera'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          workingStation.startup_checklist.length
                            ? 'bg-sky-50 text-sky-800'
                            : 'bg-red-50 text-red-800'
                        }
                      >
                        {workingStation.startup_checklist.length} {workingStation.startup_checklist.length === 1 ? 'controllo' : 'controlli'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <ActionButton
                          label={workingStation.in_uso ? 'Non modificabile mentre e in uso' : 'Modifica postazione'}
                          disabled={workingStation.in_uso}
                          onClick={() => openEditDialog(workingStation)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </ActionButton>
                        <ActionButton
                          label={workingStation.in_uso ? 'Non eliminabile mentre e in uso' : 'Elimina postazione'}
                          disabled={workingStation.in_uso}
                          destructive
                          onClick={() => {
                            setSelectedWorkingStation(workingStation);
                            setIsDeleteOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </ActionButton>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog
        open={isFormOpen}
        onOpenChange={(open) => {
          setIsFormOpen(open);
          if (!open) {
            resetForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingWorkingStation ? 'Modifica postazione' : 'Nuova postazione'}</DialogTitle>
            <DialogDescription>
              Configura dati base, reparto e checklist di avvio della postazione operatore.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Nome</label>
                <Input
                  value={formState.name}
                  onChange={(event) => setFormState((currentState) => ({ ...currentState, name: event.target.value }))}
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Codice postazione</label>
                <Input
                  value={formState.stationCode}
                  onChange={(event) => setFormState((currentState) => ({ ...currentState, stationCode: event.target.value }))}
                  required
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">Reparto</label>
                <Select
                  value={formState.departmentId}
                  onValueChange={(value) => setFormState((currentState) => ({ ...currentState, departmentId: value }))}
                >
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
                <Textarea
                  className="min-h-24"
                  value={formState.description}
                  onChange={(event) => setFormState((currentState) => ({ ...currentState, description: event.target.value }))}
                  placeholder="Descrizione operativa della postazione"
                />
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Checklist pre-avvio</p>
                  <p className="text-xs text-slate-500">
                    Controlli richiesti prima di iniziare la sessione operatore.
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addChecklistItem} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Aggiungi controllo
                </Button>
              </div>

              <div className="space-y-2">
                {formState.startupChecklist.map((item, index) => (
                  <div key={`${index}-${item}`} className="flex gap-2">
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
              <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>
                Annulla
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? 'Salvataggio...' : editingWorkingStation ? 'Salva postazione' : 'Crea postazione'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        isOpen={isDeleteOpen}
        onClose={() => {
          setIsDeleteOpen(false);
          setSelectedWorkingStation(null);
        }}
        title="Eliminare postazione?"
        description={
          selectedWorkingStation
            ? `Sei certo di voler eliminare "${selectedWorkingStation.name}"? Questa azione non puo essere annullata.`
            : ''
        }
        onConfirm={handleDelete}
      />
    </div>
  );
}
