// frontend/my-app/src/app/components/admin/UserList.tsx

import { useState, useEffect } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card } from '../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Plus, Edit2, Trash2, Key } from 'lucide-react';
import { toast } from 'sonner';
import API_ENDPOINTS from '../../../api/config';
import { useApiClient } from '../../apiClient';
import { UserForm } from './UserForm';
import { ResetPasswordDialog } from './ResetPasswordDialog';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';

interface User {
  id: number;
  nome: string;
  badge_id: string;
  ruolo: string;
  livello_esperienza: string;
  reparto: string;
  turno: string;
  created_at: string;
}

export const UserList = () => {
  const { apiCall } = useApiClient();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const response = await apiCall(API_ENDPOINTS.LIST_USERS);

      if (!response.ok) throw new Error('Errore nel caricamento utenti');

      const data = await response.json();
      setUsers(data);
    } catch (error) {
      console.error('Errore:', error);
      toast.error('Errore nel caricamento utenti');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchUsers();
  }, [apiCall]);

  const handleDeleteUser = async (userId: number) => {
    try {
      const response = await apiCall(API_ENDPOINTS.DELETE_USER(userId), {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Errore nella eliminazione');

      setUsers(users.filter((u) => u.id !== userId));
      toast.success('Utente eliminato');
      setIsDeleteOpen(false);
    } catch (error) {
      console.error('Errore:', error);
      toast.error('Errore nella eliminazione utente');
    }
  };

  const filteredUsers = users.filter((u) =>
    u.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.badge_id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2 justify-between">
        <Input
          placeholder="Cerca per nome o badge ID..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="sm:max-w-xs"
        />
        <Button
          onClick={() => {
            setEditingUser(null);
            setIsFormOpen(true);
          }}
          className="gap-2"
        >
          <Plus className="w-4 h-4" />
          Nuovo Utente
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="font-semibold">Nome</TableHead>
                <TableHead className="font-semibold">Badge ID</TableHead>
                <TableHead className="font-semibold">Ruolo</TableHead>
                <TableHead className="font-semibold">Livello</TableHead>
                <TableHead className="font-semibold">Reparto</TableHead>
                <TableHead className="font-semibold text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                    Caricamento...
                  </TableCell>
                </TableRow>
              ) : filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                    Nessun utente trovato
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map((user) => (
                  <TableRow key={user.id} className="hover:bg-slate-50">
                    <TableCell className="font-medium">{user.nome}</TableCell>
                    <TableCell className="text-sm text-slate-600">{user.badge_id}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                        user.ruolo === 'admin' 
                          ? 'bg-red-100 text-red-800' 
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {user.ruolo}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{user.livello_esperienza}</TableCell>
                    <TableCell className="text-sm">{user.reparto}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingUser(user);
                            setIsFormOpen(true);
                          }}
                          title="Modifica"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setSelectedUser(user);
                            setIsResetPasswordOpen(true);
                          }}
                          title="Resetta password"
                        >
                          <Key className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-800 hover:bg-red-50"
                          onClick={() => {
                            setSelectedUser(user);
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

      <UserForm
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditingUser(null);
        }}
        user={editingUser}
        onSuccess={() => {
          void fetchUsers();
          setIsFormOpen(false);
          setEditingUser(null);
        }}
      />

      {selectedUser && (
        <>
          <ResetPasswordDialog
            isOpen={isResetPasswordOpen}
            onClose={() => {
              setIsResetPasswordOpen(false);
              setSelectedUser(null);
            }}
            user={selectedUser}
            onSuccess={() => {
              setIsResetPasswordOpen(false);
              setSelectedUser(null);
              toast.success('Password resettata');
            }}
          />

          <DeleteConfirmDialog
            isOpen={isDeleteOpen}
            onClose={() => {
              setIsDeleteOpen(false);
              setSelectedUser(null);
            }}
            title="Eliminare utente?"
            description={`Sei certo di voler eliminare l'utente "${selectedUser.nome}"? Questa azione non può essere annullata.`}
            onConfirm={() => handleDeleteUser(selectedUser.id)}
          />
        </>
      )}
    </div>
  );
};
