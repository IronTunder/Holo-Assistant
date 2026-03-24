// frontend/my-app/src/app/components/admin/MachineList.tsx

import { useState, useEffect } from 'react';
import { useAuth } from '../../AuthContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card } from '../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Plus, Edit2, Trash2, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import API_ENDPOINTS from '../../../api/config';
import { MachineForm } from './MachineForm';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';

interface Machine {
  id: number;
  nome: string;
  reparto: string;
  descrizione?: string;
  id_postazione?: string;
  in_uso: boolean;
  operatore_attuale_id?: number;
}

export const MachineList = () => {
  const { accessToken } = useAuth();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingMachine, setEditingMachine] = useState<Machine | null>(null);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const fetchMachines = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(API_ENDPOINTS.LIST_MACHINES, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) throw new Error('Errore');
      const data = await response.json();
      setMachines(data);
    } catch (error) {
      console.error('Errore:', error);
      toast.error('Errore nel caricamento macchinari');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMachines();
  }, [accessToken]);

  const handleDeleteMachine = async (machineId: number) => {
    try {
      const response = await fetch(API_ENDPOINTS.DELETE_ADMIN_MACHINE(machineId), {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) throw new Error('Errore');
      setMachines(machines.filter((m) => m.id !== machineId));
      toast.success('Macchinario eliminato');
      setIsDeleteOpen(false);
    } catch (error) {
      console.error('Errore:', error);
      toast.error('Errore nella eliminazione');
    }
  };

  const handleResetStatus = async (machineId: number) => {
    try {
      const response = await fetch(API_ENDPOINTS.RESET_MACHINE_STATUS(machineId), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) throw new Error('Errore');
      fetchMachines();
      toast.success('Stato macchinario resettato');
    } catch (error) {
      console.error('Errore:', error);
      toast.error('Errore nel reset stato');
    }
  };

  const filteredMachines = machines.filter((m) =>
    m.nome.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
          fetchMachines();
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
    </div>
  );
};
