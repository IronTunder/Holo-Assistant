// frontend/my-app/src/app/components/admin/ResetPasswordDialog.tsx

import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { toast } from 'sonner';
import API_ENDPOINTS from '../../../api/config';
import { useApiClient } from '../../apiClient';

interface User {
  id: number;
  nome: string;
}

interface ResetPasswordDialogProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  onSuccess: () => void;
}

export const ResetPasswordDialog = ({ isOpen, onClose, user, onSuccess }: ResetPasswordDialogProps) => {
  const { apiCall } = useApiClient();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newPassword || !confirmPassword) {
      toast.error('Inserisci la password');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('Le password non corrispondono');
      return;
    }

    setIsLoading(true);

    try {
      const response = await apiCall(API_ENDPOINTS.RESET_PASSWORD(user.id), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ new_password: newPassword }),
      });

      if (!response.ok) throw new Error('Errore');

      toast.success('Password resettata');
      setNewPassword('');
      setConfirmPassword('');
      onSuccess();
    } catch (error) {
      console.error('Errore:', error);
      toast.error('Errore nel reset password');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Resetta Password</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-slate-600">
            Resetta la password per l'utente: <strong>{user.nome}</strong>
          </p>

          <div>
            <label className="text-sm font-medium">Nuova Password</label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Inserisci nuova password"
              required
            />
          </div>

          <div>
            <label className="text-sm font-medium">Conferma Password</label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Conferma password"
              required
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annulla
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Resetting...' : 'Resetta'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
