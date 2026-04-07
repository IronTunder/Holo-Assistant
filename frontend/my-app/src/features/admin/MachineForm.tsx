import { useEffect, useMemo, useState } from 'react';

import API_ENDPOINTS from '@/shared/api/config';
import { useApiClient } from '@/shared/api/apiClient';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { toast } from 'sonner';
import type { AdminMachine, DepartmentOption } from './adminTypes';

interface MachineFormProps {
  isOpen: boolean;
  onClose: () => void;
  machine: AdminMachine | null;
  departments: DepartmentOption[];
  onSuccess: () => void;
}

export const MachineForm = ({ isOpen, onClose, machine, departments, onSuccess }: MachineFormProps) => {
  const { apiCall } = useApiClient();
  const [nome, setNome] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [descrizione, setDescrizione] = useState('');
  const [idPostazione, setIdPostazione] = useState('');
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
      return;
    }

    setNome('');
    setDepartmentId(departments[0] ? String(departments[0].id) : '');
    setDescrizione('');
    setIdPostazione('');
  }, [departments, isOpen, machine]);

  const inlineError = useMemo(() => {
    if (!departmentId) {
      return 'Seleziona un reparto per il macchinario.';
    }
    if (!idPostazione.trim()) {
      return 'L ID postazione e obbligatorio.';
    }
    return null;
  }, [departmentId, idPostazione]);

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
        id_postazione: idPostazione.trim(),
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
      <DialogContent className="sm:max-w-2xl">
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

            <div className="space-y-2">
              <label className="text-sm font-medium">ID postazione</label>
              <Input value={idPostazione} onChange={(event) => setIdPostazione(event.target.value)} required />
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
