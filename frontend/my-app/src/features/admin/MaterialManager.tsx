import { useCallback, useEffect, useMemo, useState } from 'react';

import API_ENDPOINTS from '@/shared/api/config';
import { useApiClient } from '@/shared/api/apiClient';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { ScrollArea } from '@/shared/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Switch } from '@/shared/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Textarea } from '@/shared/ui/textarea';
import { Boxes, PackagePlus, PencilLine, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import type {
  AdminMachine,
  AdminMaterial,
  AdminMaterialDetail,
  AdminWorkingStation,
  MaterialMovementType,
  MaterialStockStatus,
} from './adminTypes';

interface MaterialManagerProps {
  workingStations: AdminWorkingStation[];
  machines: AdminMachine[];
  onMetadataRefresh: () => Promise<void>;
}

type MaterialFormState = {
  name: string;
  sku: string;
  category: string;
  description: string;
  characteristics: string;
  aliases: string;
  unit_of_measure: string;
  current_quantity: string;
  minimum_quantity: string;
  reorder_quantity: string;
  storage_location: string;
  is_stock_tracked: boolean;
  is_active: boolean;
};

type MovementFormState = {
  movement_type: MaterialMovementType;
  quantity: string;
  note: string;
  working_station_id: string;
};

type AssignmentFormState = {
  working_station_id: string;
  machine_id: string;
  usage_context: string;
  notes: string;
  display_order: string;
  is_required: boolean;
  is_active: boolean;
};

const emptyMaterialForm: MaterialFormState = {
  name: '',
  sku: '',
  category: '',
  description: '',
  characteristics: '',
  aliases: '',
  unit_of_measure: 'pz',
  current_quantity: '0',
  minimum_quantity: '0',
  reorder_quantity: '0',
  storage_location: '',
  is_stock_tracked: true,
  is_active: true,
};

const emptyMovementForm: MovementFormState = {
  movement_type: 'load',
  quantity: '0',
  note: '',
  working_station_id: 'none',
};

const emptyAssignmentForm: AssignmentFormState = {
  working_station_id: '',
  machine_id: 'none',
  usage_context: '',
  notes: '',
  display_order: '0',
  is_required: false,
  is_active: true,
};

const stockStatusLabels: Record<MaterialStockStatus, string> = {
  ok: 'OK',
  low_stock: 'Sotto soglia',
  out_of_stock: 'Esaurito',
  inactive: 'Disattivo',
};

const stockStatusBadgeClassNames: Record<MaterialStockStatus, string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  low_stock: 'border-amber-200 bg-amber-50 text-amber-700',
  out_of_stock: 'border-red-200 bg-red-50 text-red-700',
  inactive: 'border-slate-200 bg-slate-100 text-slate-600',
};

function toNullableString(value: string): string | null {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function MaterialManager({ workingStations, machines, onMetadataRefresh }: MaterialManagerProps) {
  const { apiCall } = useApiClient();
  const [materials, setMaterials] = useState<AdminMaterial[]>([]);
  const [selectedMaterialId, setSelectedMaterialId] = useState<number | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<AdminMaterialDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [activeFilter, setActiveFilter] = useState('active');
  const [assignedOnly, setAssignedOnly] = useState(false);
  const [isMaterialDialogOpen, setIsMaterialDialogOpen] = useState(false);
  const [isMovementDialogOpen, setIsMovementDialogOpen] = useState(false);
  const [isAssignmentDialogOpen, setIsAssignmentDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<AdminMaterial | null>(null);
  const [materialForm, setMaterialForm] = useState<MaterialFormState>(emptyMaterialForm);
  const [movementForm, setMovementForm] = useState<MovementFormState>(emptyMovementForm);
  const [assignmentForm, setAssignmentForm] = useState<AssignmentFormState>(emptyAssignmentForm);
  const [isSaving, setIsSaving] = useState(false);

  const fetchMaterials = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        include_inactive: activeFilter === 'all' ? 'true' : 'false',
      });
      if (statusFilter !== 'all') {
        params.set('stock_status', statusFilter);
      }
      if (assignedOnly) {
        params.set('assigned_only', 'true');
      }
      const response = await apiCall(`${API_ENDPOINTS.LIST_MATERIALS}?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Errore nel caricamento materiali');
      }
      const data = (await response.json()) as AdminMaterial[];
      setMaterials(data);
      if (!selectedMaterialId && data[0]) {
        setSelectedMaterialId(data[0].id);
      } else if (selectedMaterialId && !data.some((material) => material.id === selectedMaterialId)) {
        setSelectedMaterialId(data[0]?.id ?? null);
      }
    } catch (error) {
      console.error(error);
      toast.error('Errore nel caricamento materiali');
    } finally {
      setIsLoading(false);
    }
  }, [activeFilter, apiCall, assignedOnly, selectedMaterialId, statusFilter]);

  const fetchMaterialDetail = useCallback(async (materialId: number) => {
    setIsDetailLoading(true);
    try {
      const response = await apiCall(API_ENDPOINTS.GET_MATERIAL_DETAIL(materialId));
      if (!response.ok) {
        throw new Error('Errore nel caricamento dettaglio materiale');
      }
      const data = (await response.json()) as AdminMaterialDetail;
      setSelectedMaterial(data);
    } catch (error) {
      console.error(error);
      toast.error('Errore nel caricamento dettaglio materiale');
    } finally {
      setIsDetailLoading(false);
    }
  }, [apiCall]);

  useEffect(() => {
    void fetchMaterials();
  }, [fetchMaterials]);

  useEffect(() => {
    if (!selectedMaterialId) {
      setSelectedMaterial(null);
      return;
    }
    void fetchMaterialDetail(selectedMaterialId);
  }, [fetchMaterialDetail, selectedMaterialId]);

  const filteredMaterials = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return materials.filter((material) => {
      if (activeFilter === 'active' && !material.is_active) {
        return false;
      }
      if (activeFilter === 'inactive' && material.is_active) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      return `${material.name} ${material.sku || ''} ${material.category || ''} ${material.storage_location || ''}`
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [activeFilter, materials, searchTerm]);

  const resetMaterialForm = useCallback(() => {
    setEditingMaterial(null);
    setMaterialForm(emptyMaterialForm);
  }, []);

  const openCreateMaterialDialog = () => {
    resetMaterialForm();
    setIsMaterialDialogOpen(true);
  };

  const openEditMaterialDialog = () => {
    if (!selectedMaterial) {
      return;
    }
    setEditingMaterial(selectedMaterial);
    setMaterialForm({
      name: selectedMaterial.name,
      sku: selectedMaterial.sku || '',
      category: selectedMaterial.category || '',
      description: selectedMaterial.description || '',
      characteristics: selectedMaterial.characteristics || '',
      aliases: selectedMaterial.aliases || '',
      unit_of_measure: selectedMaterial.unit_of_measure,
      current_quantity: String(selectedMaterial.current_quantity),
      minimum_quantity: String(selectedMaterial.minimum_quantity),
      reorder_quantity: String(selectedMaterial.reorder_quantity),
      storage_location: selectedMaterial.storage_location || '',
      is_stock_tracked: selectedMaterial.is_stock_tracked,
      is_active: selectedMaterial.is_active,
    });
    setIsMaterialDialogOpen(true);
  };

  const handleSaveMaterial = async () => {
    if (!materialForm.name.trim()) {
      toast.error('Inserisci il nome materiale');
      return;
    }

    const payload = {
      name: materialForm.name.trim(),
      sku: toNullableString(materialForm.sku),
      category: toNullableString(materialForm.category),
      description: toNullableString(materialForm.description),
      characteristics: toNullableString(materialForm.characteristics),
      aliases: toNullableString(materialForm.aliases),
      unit_of_measure: materialForm.unit_of_measure.trim() || 'pz',
      current_quantity: toNumber(materialForm.current_quantity),
      minimum_quantity: toNumber(materialForm.minimum_quantity),
      reorder_quantity: toNumber(materialForm.reorder_quantity),
      storage_location: toNullableString(materialForm.storage_location),
      is_stock_tracked: materialForm.is_stock_tracked,
      is_active: materialForm.is_active,
    };

    setIsSaving(true);
    try {
      const response = await apiCall(
        editingMaterial ? API_ENDPOINTS.UPDATE_MATERIAL(editingMaterial.id) : API_ENDPOINTS.CREATE_MATERIAL,
        {
          method: editingMaterial ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.detail || 'Errore nel salvataggio materiale');
      }
      const savedMaterial = (await response.json()) as AdminMaterial;
      setIsMaterialDialogOpen(false);
      resetMaterialForm();
      await Promise.all([fetchMaterials(), onMetadataRefresh()]);
      setSelectedMaterialId(savedMaterial.id);
      toast.success(editingMaterial ? 'Materiale aggiornato' : 'Materiale creato');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Errore nel salvataggio materiale');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateMovement = async () => {
    if (!selectedMaterial) {
      return;
    }
    const quantity = toNumber(movementForm.quantity);
    if (quantity < 0) {
      toast.error('La quantita non puo essere negativa');
      return;
    }

    setIsSaving(true);
    try {
      const response = await apiCall(API_ENDPOINTS.CREATE_MATERIAL_MOVEMENT(selectedMaterial.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          movement_type: movementForm.movement_type,
          quantity,
          note: toNullableString(movementForm.note),
          working_station_id: movementForm.working_station_id !== 'none' ? Number(movementForm.working_station_id) : null,
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.detail || 'Errore nel salvataggio movimento');
      }
      setIsMovementDialogOpen(false);
      setMovementForm(emptyMovementForm);
      await Promise.all([fetchMaterials(), fetchMaterialDetail(selectedMaterial.id), onMetadataRefresh()]);
      toast.success('Movimento registrato');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Errore nel salvataggio movimento');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateAssignment = async () => {
    if (!selectedMaterial) {
      return;
    }
    if (!assignmentForm.working_station_id) {
      toast.error('Seleziona una postazione');
      return;
    }

    setIsSaving(true);
    try {
      const response = await apiCall(API_ENDPOINTS.CREATE_WORKING_STATION_MATERIAL(Number(assignmentForm.working_station_id)), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          material_id: selectedMaterial.id,
          machine_id: assignmentForm.machine_id !== 'none' ? Number(assignmentForm.machine_id) : null,
          usage_context: toNullableString(assignmentForm.usage_context),
          notes: toNullableString(assignmentForm.notes),
          display_order: toNumber(assignmentForm.display_order),
          is_required: assignmentForm.is_required,
          is_active: assignmentForm.is_active,
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.detail || 'Errore nell assegnazione materiale');
      }
      setIsAssignmentDialogOpen(false);
      setAssignmentForm(emptyAssignmentForm);
      await Promise.all([fetchMaterials(), fetchMaterialDetail(selectedMaterial.id), onMetadataRefresh()]);
      toast.success('Materiale assegnato alla postazione');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Errore nell assegnazione materiale');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeactivateAssignment = async (assignmentId: number) => {
    if (!selectedMaterial) {
      return;
    }
    const assignment = selectedMaterial.assignments.find((item) => item.id === assignmentId);
    if (!assignment) {
      return;
    }
    setIsSaving(true);
    try {
      const response = await apiCall(
        API_ENDPOINTS.UPDATE_WORKING_STATION_MATERIAL(assignment.working_station_id, assignment.id),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            material_id: assignment.material_id,
            machine_id: assignment.machine_id,
            usage_context: assignment.usage_context,
            notes: assignment.notes,
            display_order: assignment.display_order,
            is_required: assignment.is_required,
            is_active: false,
          }),
        }
      );
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.detail || 'Errore nell aggiornamento assegnazione');
      }
      await Promise.all([fetchMaterials(), fetchMaterialDetail(selectedMaterial.id), onMetadataRefresh()]);
      toast.success('Assegnazione disattivata');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Errore nell aggiornamento assegnazione');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 bg-white">
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-slate-900">
                <Boxes className="h-5 w-5 text-sky-600" />
                <h3 className="text-lg font-semibold">Materiali e magazzino</h3>
              </div>
              <p className="text-sm text-slate-500">
                {filteredMaterials.length} materiali visibili, {materials.filter((item) => item.stock_status !== 'ok').length} con attenzione richiesta
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void fetchMaterials()} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Aggiorna
              </Button>
              <Button onClick={openCreateMaterialDialog} className="gap-2">
                <PackagePlus className="h-4 w-4" />
                Nuovo materiale
              </Button>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1.4fr_0.8fr_0.8fr_auto]">
            <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Cerca per nome, SKU o categoria..." />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Tutti gli stati" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti gli stati</SelectItem>
                <SelectItem value="ok">OK</SelectItem>
                <SelectItem value="low_stock">Sotto soglia</SelectItem>
                <SelectItem value="out_of_stock">Esauriti</SelectItem>
                <SelectItem value="inactive">Disattivi</SelectItem>
              </SelectContent>
            </Select>
            <Select value={activeFilter} onValueChange={setActiveFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Solo attivi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Solo attivi</SelectItem>
                <SelectItem value="inactive">Solo inattivi</SelectItem>
                <SelectItem value="all">Tutti</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center justify-end gap-2 rounded-md border border-slate-200 px-3">
              <Label htmlFor="assigned-only" className="text-xs text-slate-600">Solo assegnati</Label>
              <Switch id="assigned-only" checked={assignedOnly} onCheckedChange={setAssignedOnly} />
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead>Materiale</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Soglia</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Assegnazioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-slate-500">Caricamento materiali...</TableCell>
                  </TableRow>
                ) : filteredMaterials.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-slate-500">Nessun materiale trovato</TableCell>
                  </TableRow>
                ) : (
                  filteredMaterials.map((material) => (
                    <TableRow
                      key={material.id}
                      className={`cursor-pointer hover:bg-slate-50/80 ${selectedMaterialId === material.id ? 'bg-sky-50/60' : ''}`}
                      onClick={() => setSelectedMaterialId(material.id)}
                    >
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium text-slate-900">{material.name}</p>
                          <p className="text-xs text-slate-500">{material.sku || 'Senza SKU'} {material.category ? `• ${material.category}` : ''}</p>
                        </div>
                      </TableCell>
                      <TableCell>{material.current_quantity} {material.unit_of_measure}</TableCell>
                      <TableCell>{material.minimum_quantity} {material.unit_of_measure}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={stockStatusBadgeClassNames[material.stock_status]}>
                          {stockStatusLabels[material.stock_status]}
                        </Badge>
                      </TableCell>
                      <TableCell>{material.assignment_count}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

        <Card className="border-slate-200 bg-white p-5">
          {!selectedMaterialId ? (
            <p className="text-sm text-slate-500">Seleziona un materiale per vedere il dettaglio.</p>
          ) : isDetailLoading || !selectedMaterial ? (
            <p className="text-sm text-slate-500">Caricamento dettaglio materiale...</p>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-slate-950">{selectedMaterial.name}</h3>
                    <Badge variant="outline" className={stockStatusBadgeClassNames[selectedMaterial.stock_status]}>
                      {stockStatusLabels[selectedMaterial.stock_status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {selectedMaterial.sku || 'Senza SKU'} {selectedMaterial.category ? `• ${selectedMaterial.category}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={openEditMaterialDialog} className="gap-2">
                    <PencilLine className="h-4 w-4" />
                    Modifica
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setIsMovementDialogOpen(true)}>Movimento</Button>
                  <Button size="sm" onClick={() => setIsAssignmentDialogOpen(true)}>Assegna</Button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Giacenza</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">
                    {selectedMaterial.current_quantity} {selectedMaterial.unit_of_measure}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Minimo {selectedMaterial.minimum_quantity} • Riordino {selectedMaterial.reorder_quantity}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Magazzino</p>
                  <p className="mt-2 text-sm text-slate-900">{selectedMaterial.storage_location || 'Posizione non indicata'}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {selectedMaterial.last_stock_update_at ? `Ultimo aggiornamento ${new Date(selectedMaterial.last_stock_update_at).toLocaleString('it-IT')}` : 'Nessun aggiornamento giacenza'}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-slate-900">Assegnazioni postazione</h4>
                {selectedMaterial.assignments.length === 0 ? (
                  <p className="text-sm text-slate-500">Nessuna assegnazione attiva.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedMaterial.assignments.map((assignment) => (
                      <div key={assignment.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-medium text-slate-900">
                              {workingStations.find((station) => station.id === assignment.working_station_id)?.name || `Postazione ${assignment.working_station_id}`}
                            </p>
                            <p className="text-xs text-slate-500">
                              {assignment.machine_name || 'Nessun macchinario specifico'}
                              {assignment.usage_context ? ` • ${assignment.usage_context}` : ''}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {assignment.is_required ? <Badge variant="outline">Obbligatorio</Badge> : null}
                            <Badge variant="outline" className={assignment.is_active ? '' : 'border-slate-200 bg-slate-100 text-slate-500'}>
                              {assignment.is_active ? 'Attiva' : 'Disattiva'}
                            </Badge>
                            {assignment.is_active ? (
                              <Button variant="outline" size="sm" disabled={isSaving} onClick={() => void handleDeactivateAssignment(assignment.id)}>
                                Disattiva
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        {assignment.notes ? <p className="mt-2 text-xs text-slate-500">{assignment.notes}</p> : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-slate-900">Movimenti recenti</h4>
                {selectedMaterial.recent_movements.length === 0 ? (
                  <p className="text-sm text-slate-500">Nessun movimento registrato.</p>
                ) : (
                  <ScrollArea className="h-72 pr-3">
                    <div className="space-y-2">
                      {selectedMaterial.recent_movements.map((movement) => (
                        <div key={movement.id} className="rounded-xl border border-slate-200 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">{movement.movement_type}</Badge>
                              <span className="text-sm font-medium text-slate-900">
                                {movement.quantity_delta > 0 ? '+' : ''}{movement.quantity_delta} {selectedMaterial.unit_of_measure}
                              </span>
                            </div>
                            <span className="text-xs text-slate-400">{new Date(movement.created_at).toLocaleString('it-IT')}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {movement.created_by_user_name || 'Utente'} • {movement.quantity_before} → {movement.quantity_after}
                          </p>
                          {movement.working_station_name ? (
                            <p className="mt-1 text-xs text-slate-500">Postazione: {movement.working_station_name}</p>
                          ) : null}
                          {movement.note ? <p className="mt-2 text-sm text-slate-700">{movement.note}</p> : null}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Dialog open={isMaterialDialogOpen} onOpenChange={setIsMaterialDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingMaterial ? 'Modifica materiale' : 'Nuovo materiale'}</DialogTitle>
            <DialogDescription>Configura catalogo, soglie e tracking della giacenza centrale.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={materialForm.name} onChange={(event) => setMaterialForm((current) => ({ ...current, name: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>SKU</Label>
              <Input value={materialForm.sku} onChange={(event) => setMaterialForm((current) => ({ ...current, sku: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Input value={materialForm.category} onChange={(event) => setMaterialForm((current) => ({ ...current, category: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Unità</Label>
              <Input value={materialForm.unit_of_measure} onChange={(event) => setMaterialForm((current) => ({ ...current, unit_of_measure: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>{editingMaterial ? 'Giacenza attuale (solo lettura)' : 'Quantità iniziale'}</Label>
              <Input
                type="number"
                step="0.01"
                value={materialForm.current_quantity}
                disabled={Boolean(editingMaterial)}
                onChange={(event) => setMaterialForm((current) => ({ ...current, current_quantity: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Soglia minima</Label>
              <Input type="number" step="0.01" value={materialForm.minimum_quantity} onChange={(event) => setMaterialForm((current) => ({ ...current, minimum_quantity: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Quantità riordino</Label>
              <Input type="number" step="0.01" value={materialForm.reorder_quantity} onChange={(event) => setMaterialForm((current) => ({ ...current, reorder_quantity: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Posizione</Label>
              <Input value={materialForm.storage_location} onChange={(event) => setMaterialForm((current) => ({ ...current, storage_location: event.target.value }))} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Descrizione</Label>
              <Textarea value={materialForm.description} onChange={(event) => setMaterialForm((current) => ({ ...current, description: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Caratteristiche</Label>
              <Textarea value={materialForm.characteristics} onChange={(event) => setMaterialForm((current) => ({ ...current, characteristics: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Alias</Label>
              <Textarea value={materialForm.aliases} onChange={(event) => setMaterialForm((current) => ({ ...current, aliases: event.target.value }))} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
              <Label htmlFor="stock-tracked">Traccia giacenza</Label>
              <Switch id="stock-tracked" checked={materialForm.is_stock_tracked} onCheckedChange={(checked) => setMaterialForm((current) => ({ ...current, is_stock_tracked: checked }))} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
              <Label htmlFor="material-active">Materiale attivo</Label>
              <Switch id="material-active" checked={materialForm.is_active} onCheckedChange={(checked) => setMaterialForm((current) => ({ ...current, is_active: checked }))} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsMaterialDialogOpen(false)}>Annulla</Button>
            <Button type="button" onClick={() => void handleSaveMaterial()} disabled={isSaving}>
              {editingMaterial ? 'Salva modifiche' : 'Crea materiale'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isMovementDialogOpen} onOpenChange={setIsMovementDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuovo movimento magazzino</DialogTitle>
            <DialogDescription>Registra carico, scarico o rettifica della giacenza centrale.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Tipo movimento</Label>
              <Select value={movementForm.movement_type} onValueChange={(value: MaterialMovementType) => setMovementForm((current) => ({ ...current, movement_type: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="load">Carico</SelectItem>
                  <SelectItem value="unload">Scarico</SelectItem>
                  <SelectItem value="adjustment">Rettifica quantità finale</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{movementForm.movement_type === 'adjustment' ? 'Quantità finale' : 'Quantità'}</Label>
              <Input type="number" step="0.01" value={movementForm.quantity} onChange={(event) => setMovementForm((current) => ({ ...current, quantity: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Postazione collegata</Label>
              <Select value={movementForm.working_station_id} onValueChange={(value) => setMovementForm((current) => ({ ...current, working_station_id: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nessuna</SelectItem>
                  {workingStations.map((station) => (
                    <SelectItem key={station.id} value={String(station.id)}>{station.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Nota</Label>
              <Textarea value={movementForm.note} onChange={(event) => setMovementForm((current) => ({ ...current, note: event.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsMovementDialogOpen(false)}>Annulla</Button>
            <Button type="button" onClick={() => void handleCreateMovement()} disabled={isSaving}>Registra movimento</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAssignmentDialogOpen} onOpenChange={setIsAssignmentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assegna materiale a postazione</DialogTitle>
            <DialogDescription>Crea il collegamento operativo tra materiale e postazione.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Postazione</Label>
              <Select value={assignmentForm.working_station_id} onValueChange={(value) => setAssignmentForm((current) => ({ ...current, working_station_id: value }))}>
                <SelectTrigger><SelectValue placeholder="Seleziona postazione" /></SelectTrigger>
                <SelectContent>
                  {workingStations.map((station) => (
                    <SelectItem key={station.id} value={String(station.id)}>{station.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Macchinario specifico</Label>
              <Select value={assignmentForm.machine_id} onValueChange={(value) => setAssignmentForm((current) => ({ ...current, machine_id: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nessuno</SelectItem>
                  {machines.map((machine) => (
                    <SelectItem key={machine.id} value={String(machine.id)}>{machine.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Contesto uso</Label>
              <Input value={assignmentForm.usage_context} onChange={(event) => setAssignmentForm((current) => ({ ...current, usage_context: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Note</Label>
              <Textarea value={assignmentForm.notes} onChange={(event) => setAssignmentForm((current) => ({ ...current, notes: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Ordine visualizzazione</Label>
              <Input type="number" value={assignmentForm.display_order} onChange={(event) => setAssignmentForm((current) => ({ ...current, display_order: event.target.value }))} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
              <Label htmlFor="assignment-required">Obbligatorio</Label>
              <Switch id="assignment-required" checked={assignmentForm.is_required} onCheckedChange={(checked) => setAssignmentForm((current) => ({ ...current, is_required: checked }))} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsAssignmentDialogOpen(false)}>Annulla</Button>
            <Button type="button" onClick={() => void handleCreateAssignment()} disabled={isSaving}>Assegna</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
