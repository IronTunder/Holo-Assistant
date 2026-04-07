import { useCallback, useEffect, useState } from 'react';

import API_ENDPOINTS from '@/shared/api/config';
import { useApiClient } from '@/shared/api/apiClient';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Checkbox } from '@/shared/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Textarea } from '@/shared/ui/textarea';
import { Edit2, Plus, Trash2, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import type { DepartmentOption } from './adminTypes';

interface DepartmentManagerProps {
  onMetadataRefresh: () => Promise<void>;
}

export const DepartmentManager = ({ onMetadataRefresh }: DepartmentManagerProps) => {
  const { apiCall } = useApiClient();
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [editingDepartment, setEditingDepartment] = useState<DepartmentOption | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);

  const fetchDepartments = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await apiCall(API_ENDPOINTS.LIST_DEPARTMENTS);
      if (!response.ok) {
        throw new Error('Errore nel caricamento reparti');
      }
      setDepartments((await response.json()) as DepartmentOption[]);
    } catch (error) {
      console.error(error);
      toast.error('Errore nel caricamento reparti');
    } finally {
      setIsLoading(false);
    }
  }, [apiCall]);

  useEffect(() => {
    void fetchDepartments();
  }, [fetchDepartments]);

  useEffect(() => {
    if (!isFormOpen) {
      return;
    }
    if (editingDepartment) {
      setName(editingDepartment.name);
      setCode(editingDepartment.code || '');
      setDescription(editingDepartment.description || '');
      setIsActive(editingDepartment.is_active);
      return;
    }
    setName('');
    setCode('');
    setDescription('');
    setIsActive(true);
  }, [editingDepartment, isFormOpen]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload = {
      name: name.trim(),
      code: code.trim() || null,
      description: description.trim() || null,
      is_active: isActive,
    };

    try {
      const response = await apiCall(
        editingDepartment ? API_ENDPOINTS.UPDATE_DEPARTMENT(editingDepartment.id) : API_ENDPOINTS.CREATE_DEPARTMENT,
        {
          method: editingDepartment ? 'PUT' : 'POST',
          body: JSON.stringify(payload),
        }
      );
      if (!response.ok) {
        throw new Error('Errore nel salvataggio reparto');
      }
      toast.success(editingDepartment ? 'Reparto aggiornato' : 'Reparto creato');
      setIsFormOpen(false);
      setEditingDepartment(null);
      await fetchDepartments();
      await onMetadataRefresh();
    } catch (error) {
      console.error(error);
      toast.error('Errore nel salvataggio reparto');
    }
  };

  const handleDelete = async (department: DepartmentOption) => {
    if (!window.confirm(`Eliminare o disattivare il reparto "${department.name}"?`)) {
      return;
    }
    try {
      const response = await apiCall(API_ENDPOINTS.DELETE_DEPARTMENT(department.id), { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Errore nella eliminazione reparto');
      }
      toast.success('Reparto aggiornato');
      await fetchDepartments();
      await onMetadataRefresh();
    } catch (error) {
      console.error(error);
      toast.error('Impossibile eliminare il reparto');
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-slate-900">
              <Workflow className="h-5 w-5 text-sky-600" />
              <h3 className="text-lg font-semibold">Reparti</h3>
            </div>
            <p className="text-sm text-slate-500">Organizza utenti e macchinari per area aziendale.</p>
          </div>
          <Button onClick={() => { setEditingDepartment(null); setIsFormOpen(true); }} className="gap-2">
            <Plus className="h-4 w-4" />
            Nuovo reparto
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>Reparto</TableHead>
                <TableHead>Descrizione</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-slate-500">Caricamento reparti...</TableCell>
                </TableRow>
              ) : departments.map((department) => (
                <TableRow key={department.id}>
                  <TableCell>
                    <div className="space-y-1">
                      <p className="font-medium text-slate-900">{department.name}</p>
                      <p className="text-xs text-slate-500">{department.code || '-'}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">{department.description || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={department.is_active ? 'secondary' : 'outline'}>
                      {department.is_active ? 'Attivo' : 'Non attivo'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => { setEditingDepartment(department); setIsFormOpen(true); }}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:bg-red-50 hover:text-red-800"
                        onClick={() => void handleDelete(department)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingDepartment ? 'Modifica reparto' : 'Nuovo reparto'}</DialogTitle>
            <DialogDescription>Nome e codice vengono usati in utenti, macchinari e filtri admin.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Nome</label>
                <Input value={name} onChange={(event) => setName(event.target.value)} required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Codice</label>
                <Input value={code} onChange={(event) => setCode(event.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">Descrizione</label>
                <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={isActive} onCheckedChange={(checked) => setIsActive(checked === true)} />
              Reparto attivo
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>Annulla</Button>
              <Button type="submit">Salva reparto</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
