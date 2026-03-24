// frontend/my-app/src/app/components/admin/UserForm.tsx

import { useState, useEffect } from 'react';
import { useAuth } from '../../AuthContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { toast } from 'sonner';
import API_ENDPOINTS from '../../../api/config';

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

interface UserFormProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  onSuccess: () => void;
}

export const UserForm = ({ isOpen, onClose, user, onSuccess }: UserFormProps) => {
  const { accessToken } = useAuth();
  const [nome, setNome] = useState('');
  const [badge_id, setBadge_id] = useState('');
  const [password, setPassword] = useState('');
  const [ruolo, setRuolo] = useState('operaio');
  const [livello_esperienza, setLivello_esperienza] = useState('operaio');
  const [reparto, setReparto] = useState('');
  const [turno, setTurno] = useState('mattina');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setNome(user.nome);
      setBadge_id(user.badge_id);
      setPassword('');
      setRuolo(user.ruolo);
      setLivello_esperienza(user.livello_esperienza);
      setReparto(user.reparto);
      setTurno(user.turno);
    } else {
      resetForm();
    }
  }, [user, isOpen]);

  const resetForm = () => {
    setNome('');
    setBadge_id('');
    setPassword('');
    setRuolo('operaio');
    setLivello_esperienza('operaio');
    setReparto('');
    setTurno('mattina');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const data: any = {
        nome,
        badge_id,
        ruolo,
        livello_esperienza,
        reparto,
        turno,
      };

      if (user) {
        // Update user
        if (password) {
          data.password = password;
        }
        const response = await fetch(API_ENDPOINTS.UPDATE_USER(user.id), {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        });

        if (!response.ok) throw new Error('Errore nell\'aggiornamento');
        toast.success('Utente aggiornato');
      } else {
        // Create user
        if (!password) {
          toast.error('La password è obbligatoria');
          setIsLoading(false);
          return;
        }
        data.password = password;

        const response = await fetch(API_ENDPOINTS.CREATE_USER, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        });

        if (!response.ok) throw new Error('Errore nella creazione');
        toast.success('Utente creato');
      }

      onSuccess();
    } catch (error) {
      console.error('Errore:', error);
      toast.error(user ? 'Errore nell\'aggiornamento' : 'Errore nella creazione utente');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{user ? 'Modifica Utente' : 'Nuovo Utente'}</DialogTitle>
          <DialogDescription>
            {user ? 'Aggiorna i dati dell\'utente' : 'Crea un nuovo utente nel sistema'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Nome</label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} required />
          </div>

          <div>
            <label className="text-sm font-medium">Badge ID</label>
            <Input value={badge_id} onChange={(e) => setBadge_id(e.target.value)} required />
          </div>

          <div>
            <label className="text-sm font-medium">Password {user && '(lascia vuoto per non cambiare)'}</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required={!user} />
          </div>

          <div>
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

          <div>
            <label className="text-sm font-medium">Livello Esperienza</label>
            <Select value={livello_esperienza} onValueChange={setLivello_esperienza}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="apprendista">Apprendista</SelectItem>
                <SelectItem value="operaio">Operaio</SelectItem>
                <SelectItem value="senior">Senior</SelectItem>
                <SelectItem value="manutentore">Manutentore</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium">Reparto</label>
            <Input value={reparto} onChange={(e) => setReparto(e.target.value)} required />
          </div>

          <div>
            <label className="text-sm font-medium">Turno</label>
            <Select value={turno} onValueChange={setTurno}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mattina">Mattina</SelectItem>
                <SelectItem value="pomeriggio">Pomeriggio</SelectItem>
                <SelectItem value="notte">Notte</SelectItem>
              </SelectContent>
            </Select>
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
