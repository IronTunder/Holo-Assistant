// frontend/my-app/src/app/components/admin/MachineForm.tsx

import { useState, useEffect } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { toast } from 'sonner';
import API_ENDPOINTS from '../../../api/config';
import { useApiClient } from '../../apiClient';

interface Machine {
  id: number;
  nome: string;
  reparto: string;
  descrizione?: string;
  id_postazione?: string;
  in_uso: boolean;
}

interface MachineFormProps {
  isOpen: boolean;
  onClose: () => void;
  machine: Machine | null;
  onSuccess: () => void;
}

export const MachineForm = ({ isOpen, onClose, machine, onSuccess }: MachineFormProps) => {
  const { apiCall } = useApiClient();
  const [nome, setNome] = useState('');
  const [reparto, setReparto] = useState('');
  const [descrizione, setDescrizione] = useState('');
  const [id_postazione, setId_postazione] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (machine) {
      setNome(machine.nome);
      setReparto(machine.reparto);
      setDescrizione(machine.descrizione || '');
      setId_postazione(machine.id_postazione || '');
    } else {
      resetForm();
    }
  }, [machine, isOpen]);

  const resetForm = () => {
    setNome('');
    setReparto('');
    setDescrizione('');
    setId_postazione('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const data = {
        nome,
        reparto,
        descrizione,
        id_postazione,
      };

      const endpoint = machine
        ? API_ENDPOINTS.UPDATE_ADMIN_MACHINE(machine.id)
        : API_ENDPOINTS.CREATE_ADMIN_MACHINE;

      const method = machine ? 'PUT' : 'POST';

      const response = await apiCall(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) throw new Error('Errore');
      toast.success(machine ? 'Macchinario aggiornato' : 'Macchinario creato');
      onSuccess();
    } catch (error) {
      console.error('Errore:', error);
      toast.error('Errore durante l\'operazione');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{machine ? 'Modifica Macchinario' : 'Nuovo Macchinario'}</DialogTitle>
          <DialogDescription>
            {machine ? 'Aggiorna i dati del macchinario' : 'Aggiungi un nuovo macchinario'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Nome</label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} required />
          </div>

          <div>
            <label className="text-sm font-medium">Reparto</label>
            <Input value={reparto} onChange={(e) => setReparto(e.target.value)} required />
          </div>

          <div>
            <label className="text-sm font-medium">Descrizione</label>
            <Input value={descrizione} onChange={(e) => setDescrizione(e.target.value)} />
          </div>

          <div>
            <label className="text-sm font-medium">ID Postazione</label>
            <Input value={id_postazione} onChange={(e) => setId_postazione(e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annulla
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Salvataggio...' : 'Salva'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
