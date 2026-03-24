// frontend/my-app/src/app/components/admin/RoleManager.tsx

import { Card } from '@/app/components/ui/card';
import { Alert, AlertDescription } from '@/app/components/ui/alert';
import { Info } from 'lucide-react';

export const RoleManager = () => {
  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Il sistema utilizza due ruoli: <strong>Operaio</strong> e <strong>Admin</strong>.
          I ruoli sono assegnati durante la creazione dell'utente nella sezione Utenti.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-6">
          <h3 className="font-semibold mb-2">Operaio</h3>
          <p className="text-sm text-slate-600">
            Gli operatori possono accedere e utilizzare i macchinari tramite badge o credenziali.
          </p>
        </Card>

        <Card className="p-6">
          <h3 className="font-semibold mb-2">Admin</h3>
          <p className="text-sm text-slate-600">
            Gli amministratori possono accedere al pannello di gestione e modificare tutti i dati del sistema.
          </p>
        </Card>
      </div>
    </div>
  );
};
