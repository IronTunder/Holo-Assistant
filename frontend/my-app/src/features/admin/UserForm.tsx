import { useEffect, useMemo, useState } from 'react';

import API_ENDPOINTS from '@/shared/api/config';
import { useApiClient } from '@/shared/api/apiClient';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { toast } from 'sonner';
import type { AdminUser, DepartmentOption } from './adminTypes';

interface UserFormProps {
  isOpen: boolean;
  onClose: () => void;
  user: AdminUser | null;
  departments: DepartmentOption[];
  onSuccess: () => void;
}

const experienceOptions = [
  { value: 'apprendista', label: 'Apprendista' },
  { value: 'operaio', label: 'Operaio' },
  { value: 'senior', label: 'Senior' },
  { value: 'manutentore', label: 'Manutentore' },
];

const shiftOptions = [
  { value: 'mattina', label: 'Mattina' },
  { value: 'pomeriggio', label: 'Pomeriggio' },
  { value: 'notte', label: 'Notte' },
];

export const UserForm = ({ isOpen, onClose, user, departments, onSuccess }: UserFormProps) => {
  const { apiCall } = useApiClient();
  const [nome, setNome] = useState('');
  const [badgeId, setBadgeId] = useState('');
  const [password, setPassword] = useState('');
  const [ruolo, setRuolo] = useState('operaio');
  const [livelloEsperienza, setLivelloEsperienza] = useState('operaio');
  const [departmentId, setDepartmentId] = useState('');
  const [turno, setTurno] = useState('mattina');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (user) {
      setNome(user.nome);
      setBadgeId(user.badge_id);
      setPassword('');
      setRuolo(user.ruolo);
      setLivelloEsperienza(user.livello_esperienza);
      setDepartmentId(user.department_id ? String(user.department_id) : '');
      setTurno(user.turno);
      return;
    }

    setNome('');
    setBadgeId('');
    setPassword('');
    setRuolo('operaio');
    setLivelloEsperienza('operaio');
    setDepartmentId(departments[0] ? String(departments[0].id) : '');
    setTurno('mattina');
  }, [departments, isOpen, user]);

  const inlineError = useMemo(() => {
    if (!departmentId) {
      return 'Seleziona un reparto.';
    }
    if (!user && !password.trim()) {
      return 'La password iniziale e obbligatoria.';
    }
    return null;
  }, [departmentId, password, user]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inlineError) {
      toast.error(inlineError);
      return;
    }

    setIsLoading(true);
    try {
      const payload: Record<string, unknown> = {
        nome,
        badge_id: badgeId,
        ruolo,
        livello_esperienza: livelloEsperienza,
        department_id: Number(departmentId),
        turno,
      };

      if (password.trim()) {
        payload.password = password.trim();
      }

      const response = await apiCall(
        user ? API_ENDPOINTS.UPDATE_USER(user.id) : API_ENDPOINTS.CREATE_USER,
        {
          method: user ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        throw new Error('Errore nel salvataggio utente');
      }

      toast.success(user ? 'Utente aggiornato' : 'Utente creato');
      onSuccess();
    } catch (error) {
      console.error(error);
      toast.error(user ? 'Errore nell aggiornamento utente' : 'Errore nella creazione utente');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{user ? 'Modifica utente' : 'Nuovo utente'}</DialogTitle>
          <DialogDescription>
            Usa dati guidati per creare utenti coerenti con reparti, ruoli e turni configurati.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome</label>
              <Input value={nome} onChange={(event) => setNome(event.target.value)} required />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Badge ID</label>
              <Input value={badgeId} onChange={(event) => setBadgeId(event.target.value)} required />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">
                Password {user ? '(lascia vuoto per mantenerla invariata)' : ''}
              </label>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required={!user}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Ruolo</label>
              <Select value={ruolo} onValueChange={setRuolo}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="operaio">Operaio</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Livello esperienza</label>
              <Select value={livelloEsperienza} onValueChange={setLivelloEsperienza}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {experienceOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
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

            <div className="space-y-2">
              <label className="text-sm font-medium">Turno</label>
              <Select value={turno} onValueChange={setTurno}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {shiftOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              {isLoading ? 'Salvataggio...' : 'Salva utente'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
