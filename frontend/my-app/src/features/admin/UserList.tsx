import { useEffect, useMemo, useState, type ReactNode } from 'react';

import API_ENDPOINTS from '@/shared/api/config';
import { useApiClient } from '@/shared/api/apiClient';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';
import { Edit2, Key, Plus, Trash2, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import type { AdminMachine, AdminUser, DepartmentOption, RoleOption } from './adminTypes';
import { ResetPasswordDialog } from './ResetPasswordDialog';
import { UserForm } from './UserForm';

interface UserListProps {
  departments: DepartmentOption[];
  roles: RoleOption[];
  machines: AdminMachine[];
  onMetadataRefresh: () => Promise<void>;
}

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

export const UserList = ({ departments, roles, machines, onMetadataRefresh }: UserListProps) => {
  const { apiCall } = useApiClient();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [shiftFilter, setShiftFilter] = useState('all');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const response = await apiCall(API_ENDPOINTS.LIST_USERS);
      if (!response.ok) {
        throw new Error('Errore nel caricamento utenti');
      }
      const data = (await response.json()) as AdminUser[];
      setUsers(data);
    } catch (error) {
      console.error(error);
      toast.error('Errore nel caricamento utenti');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchUsers();
  }, [apiCall]);

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const matchesSearch =
        user.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.badge_id.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesDepartment =
        departmentFilter === 'all' || String(user.department_id ?? '') === departmentFilter;
      const matchesRole = roleFilter === 'all' || String(user.role_id ?? '') === roleFilter;
      const matchesShift = shiftFilter === 'all' || user.turno === shiftFilter;
      return matchesSearch && matchesDepartment && matchesRole && matchesShift;
    });
  }, [departmentFilter, roleFilter, searchTerm, shiftFilter, users]);

  const activeMachineByUserId = useMemo(
    () =>
      new Map(
        machines
          .filter((machine) => machine.in_uso && machine.operatore_attuale_id != null)
          .map((machine) => [machine.operatore_attuale_id as number, machine])
      ),
    [machines]
  );

  const handleDeleteUser = async (userId: number) => {
    try {
      const response = await apiCall(API_ENDPOINTS.DELETE_USER(userId), { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Errore nella eliminazione utente');
      }
      toast.success('Utente eliminato');
      setIsDeleteOpen(false);
      setSelectedUser(null);
      await fetchUsers();
      await onMetadataRefresh();
    } catch (error) {
      console.error(error);
      toast.error('Errore nella eliminazione utente');
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 bg-white">
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-slate-900">
                <UsersRound className="h-5 w-5 text-sky-600" />
                <h3 className="text-lg font-semibold">Utenti</h3>
              </div>
              <p className="text-sm text-slate-500">
                {filteredUsers.length} utenti visibili su {users.length} totali
              </p>
            </div>
            <Button
              onClick={() => {
                setEditingUser(null);
                setIsFormOpen(true);
              }}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Nuovo utente
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Input
              placeholder="Cerca per nome o badge..."
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
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Tutti i ruoli" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i ruoli</SelectItem>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={String(role.id)}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={shiftFilter} onValueChange={setShiftFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Tutti i turni" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i turni</SelectItem>
                <SelectItem value="mattina">Mattina</SelectItem>
                <SelectItem value="pomeriggio">Pomeriggio</SelectItem>
                <SelectItem value="notte">Notte</SelectItem>
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
                <TableHead>Utente</TableHead>
                <TableHead>Ruolo</TableHead>
                <TableHead>Esperienza</TableHead>
                <TableHead>Reparto</TableHead>
                <TableHead>Turno</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-slate-500">
                    Caricamento utenti...
                  </TableCell>
                </TableRow>
              ) : filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-slate-500">
                    Nessun utente trovato con i filtri correnti
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map((user) => (
                  <TableRow key={user.id} className="hover:bg-slate-50/80">
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium text-slate-900">{user.nome}</p>
                        <p className="text-xs text-slate-500">{user.badge_id}</p>
                        {activeMachineByUserId.get(user.id) ? (
                          <p className="text-xs text-amber-700">
                            In sessione su {activeMachineByUserId.get(user.id)?.nome}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={user.role_code === 'admin' || user.ruolo === 'admin' ? 'destructive' : 'secondary'}
                        className="capitalize"
                      >
                        {user.role_name || user.ruolo}
                      </Badge>
                    </TableCell>
                    <TableCell className="capitalize">{user.livello_esperienza}</TableCell>
                    <TableCell>{user.department_name || user.reparto || '-'}</TableCell>
                    <TableCell className="capitalize">{user.turno}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <ActionButton
                          label={
                            activeMachineByUserId.get(user.id)
                              ? 'Non modificabile mentre usa un macchinario'
                              : 'Modifica utente'
                          }
                          disabled={Boolean(activeMachineByUserId.get(user.id))}
                          onClick={() => {
                            setEditingUser(user);
                            setIsFormOpen(true);
                          }}
                        >
                          <Edit2 className="h-4 w-4" />
                        </ActionButton>
                        <ActionButton
                          label="Reimposta password"
                          onClick={() => {
                            setSelectedUser(user);
                            setIsResetPasswordOpen(true);
                          }}
                        >
                          <Key className="h-4 w-4" />
                        </ActionButton>
                        <ActionButton
                          label={
                            activeMachineByUserId.get(user.id)
                              ? 'Non eliminabile mentre usa un macchinario'
                              : 'Elimina utente'
                          }
                          disabled={Boolean(activeMachineByUserId.get(user.id))}
                          destructive
                          onClick={() => {
                            setSelectedUser(user);
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

      <UserForm
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditingUser(null);
        }}
        user={editingUser}
        departments={departments}
        roles={roles}
        onSuccess={() => {
          void fetchUsers();
          void onMetadataRefresh();
          setIsFormOpen(false);
          setEditingUser(null);
        }}
      />

      {selectedUser ? (
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
            description={`Sei certo di voler eliminare "${selectedUser.nome}"? Questa azione non puo essere annullata.`}
            onConfirm={() => handleDeleteUser(selectedUser.id)}
          />
        </>
      ) : null}
    </div>
  );
};
