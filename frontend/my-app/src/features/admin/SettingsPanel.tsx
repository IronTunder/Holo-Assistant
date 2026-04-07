// frontend/my-app/src/features/admin/SettingsPanel.tsx

import { Card } from '@/shared/ui/card';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Info } from 'lucide-react';

export const SettingsPanel = () => {
  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Le impostazioni di sistema sono ancora in fase di sviluppo.
        </AlertDescription>
      </Alert>

      <Card className="p-6">
        <h3 className="font-semibold mb-4">Parametri di Sistema</h3>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-600">Server Backend</label>
            <p className="text-sm mt-1 text-slate-900">
              {import.meta.env.VITE_API_URL || 'http://localhost:8000'}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600">Ambiente</label>
            <p className="text-sm mt-1 text-slate-900">
              {import.meta.env.DEV ? 'Development' : 'Production'}
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-6 bg-slate-50">
        <h3 className="font-semibold mb-2">Prossime Funzionalità</h3>
        <ul className="list-disc list-inside space-y-1 text-sm text-slate-600">
          <li>Configurazione token expiry</li>
          <li>Backup e restore dati</li>
          <li>Gestione avanzata permessi</li>
          <li>Report personalizzati</li>
        </ul>
      </Card>
    </div>
  );
};
