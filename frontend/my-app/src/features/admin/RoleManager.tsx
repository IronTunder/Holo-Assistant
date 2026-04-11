import { useCallback, useEffect, useMemo, useState } from 'react';

import API_ENDPOINTS from '@/shared/api/config';
import { useApiClient } from '@/shared/api/apiClient';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Checkbox } from '@/shared/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Edit2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { RoleOption } from './adminTypes';

const permissionOptions = [
  { value: 'operator.interface.access', label: 'Accesso interfaccia operatore' },
  { value: 'backoffice.access', label: 'Accesso backoffice' },
  { value: 'users.manage', label: 'Gestione utenti' },
  { value: 'roles.manage', label: 'Gestione ruoli' },
  { value: 'departments.manage', label: 'Gestione reparti' },
  { value: 'machines.manage', label: 'Gestione macchinari' },
  { value: 'knowledge.manage', label: 'Gestione knowledge' },
  { value: 'logs.view', label: 'Visualizza log' },
  { value: 'settings.view', label: 'Visualizza impostazioni' },
  { value: 'settings.edit', label: 'Modifica impostazioni' },
  { value: 'maintenance.view', label: 'Richieste manutenzione' },
  { value: 'emergencies.view', label: 'Alert emergenze' },
  { value: 'interactions.resolve', label: 'Conferma risoluzioni' },
];

interface RoleManagerProps {
  onMetadataRefresh: () => Promise<void>;
}

export const RoleManager = ({ onMetadataRefresh }: RoleManagerProps) => {
  const { apiCall } = useApiClient();
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [editingRole, setEditingRole] = useState<RoleOption | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);

  const fetchRoles = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await apiCall(API_ENDPOINTS.LIST_ROLES);
      if (!response.ok) {
        throw new Error('Errore nel caricamento ruoli');
      }
      setRoles((await response.json()) as RoleOption[]);
    } catch (error) {
      console.error(error);
      toast.error('Errore nel caricamento ruoli');
    } finally {
      setIsLoading(false);
    }
  }, [apiCall]);

  useEffect(() => {
    void fetchRoles();
  }, [fetchRoles]);

  useEffect(() => {
    if (!isFormOpen) {
      return;
    }
    if (editingRole) {
      setName(editingRole.name);
      setCode(editingRole.code || '');
      setDescription(editingRole.description || '');
      setPermissions(editingRole.permissions);
      setIsActive(editingRole.is_active);
      return;
    }
    setName('');
    setCode('');
    setDescription('');
    setPermissions([]);
    setIsActive(true);
  }, [editingRole, isFormOpen]);

  const selectedPermissionLabels = useMemo(
    () => new Map(permissionOptions.map((permission) => [permission.value, permission.label])),
    []
  );

  const togglePermission = (permission: string) => {
    setPermissions((current) =>
      current.includes(permission)
        ? current.filter((item) => item !== permission)
        : [...current, permission]
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload = {
      name: name.trim(),
      code: code.trim() || null,
      description: description.trim() || null,
      permissions,
      is_active: isActive,
    };

    try {
      const response = await apiCall(
        editingRole ? API_ENDPOINTS.UPDATE_ROLE(editingRole.id) : API_ENDPOINTS.CREATE_ROLE,
        {
          method: editingRole ? 'PUT' : 'POST',
          body: JSON.stringify(payload),
        }
      );
      if (!response.ok) {
        throw new Error('Errore nel salvataggio ruolo');
      }
      toast.success(editingRole ? 'Ruolo aggiornato' : 'Ruolo creato');
      setIsFormOpen(false);
      setEditingRole(null);
      await fetchRoles();
      await onMetadataRefresh();
    } catch (error) {
      console.error(error);
      toast.error('Errore nel salvataggio ruolo');
    }
  };

  const handleDelete = async (role: RoleOption) => {
    if (!window.confirm(`Eliminare il ruolo "${role.name}"?`)) {
      return;
    }
    try {
      const response = await apiCall(API_ENDPOINTS.DELETE_ROLE(role.id), { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Errore nella eliminazione ruolo');
      }
      toast.success('Ruolo eliminato');
      await fetchRoles();
      await onMetadataRefresh();
    } catch (error) {
      console.error(error);
      toast.error('Impossibile eliminare il ruolo');
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-slate-900">
              <ShieldCheck className="h-5 w-5 text-sky-600" />
              <h3 className="text-lg font-semibold">Ruoli e permessi</h3>
            </div>
            <p className="text-sm text-slate-500">Configura cosa puo fare ogni ruolo nel sistema.</p>
          </div>
          <Button onClick={() => { setEditingRole(null); setIsFormOpen(true); }} className="gap-2">
            <Plus className="h-4 w-4" />
            Nuovo ruolo
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>Ruolo</TableHead>
                <TableHead>Permessi</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-slate-500">Caricamento ruoli...</TableCell>
                </TableRow>
              ) : roles.map((role) => (
                <TableRow key={role.id}>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-slate-900">{role.name}</p>
                        {role.is_system ? <Badge variant="outline">Sistema</Badge> : null}
                      </div>
                      <p className="text-xs text-slate-500">{role.code || '-'}</p>
                      {role.description ? <p className="text-xs text-slate-500">{role.description}</p> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-xl flex-wrap gap-1.5">
                      {role.permissions.length ? role.permissions.map((permission) => (
                        <Badge key={permission} variant="secondary">
                          {selectedPermissionLabels.get(permission) || permission}
                        </Badge>
                      )) : <span className="text-sm text-slate-500">Nessun permesso</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={role.is_active ? 'secondary' : 'outline'}>
                      {role.is_active ? 'Attivo' : 'Non attivo'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => { setEditingRole(role); setIsFormOpen(true); }}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={role.is_system}
                        className="text-red-600 hover:bg-red-50 hover:text-red-800"
                        onClick={() => void handleDelete(role)}
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
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingRole ? 'Modifica ruolo' : 'Nuovo ruolo'}</DialogTitle>
            <DialogDescription>Assegna solo i permessi necessari al lavoro del ruolo.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Nome</label>
                <Input value={name} onChange={(event) => setName(event.target.value)} required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Codice</label>
                <Input value={code} onChange={(event) => setCode(event.target.value)} disabled={editingRole?.is_system} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">Descrizione</label>
                <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={isActive} onCheckedChange={(checked) => setIsActive(checked === true)} disabled={editingRole?.code === 'admin'} />
              Ruolo attivo
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              {permissionOptions.map((permission) => (
                <label key={permission.value} className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm">
                  <Checkbox
                    checked={permissions.includes(permission.value)}
                    onCheckedChange={() => togglePermission(permission.value)}
                    disabled={editingRole?.code === 'admin'}
                  />
                  {permission.label}
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>Annulla</Button>
              <Button type="submit">Salva ruolo</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
