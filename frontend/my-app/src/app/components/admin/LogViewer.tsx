// frontend/my-app/src/app/components/admin/LogViewer.tsx

import { useState, useEffect } from 'react';
import { Card } from '../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { toast } from 'sonner';
import API_ENDPOINTS from '../../../api/config';
import { useApiClient } from '../../apiClient';

interface Log {
  id: number;
  user_id: number;
  machine_id: number;
  domanda: string;
  risposta: string;
  timestamp: string;
}

export const LogViewer = () => {
  const { apiCall } = useApiClient();
  const [logs, setLogs] = useState<Log[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const response = await apiCall(`${API_ENDPOINTS.LIST_LOGS}?page=1&size=50`);

      if (!response.ok) throw new Error('Errore');
      const data = await response.json();
      setLogs(data);
    } catch (error) {
      console.error('Errore:', error);
      toast.error('Errore nel caricamento log');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchLogs();
  }, [apiCall]);

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="font-semibold">Data/Ora</TableHead>
              <TableHead className="font-semibold">Utente ID</TableHead>
              <TableHead className="font-semibold">Macchinario ID</TableHead>
              <TableHead className="font-semibold">Domanda</TableHead>
              <TableHead className="font-semibold">Risposta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                  Caricamento...
                </TableCell>
              </TableRow>
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                  Nessun log trovato
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow key={log.id} className="hover:bg-slate-50">
                  <TableCell className="text-sm">
                    {new Date(log.timestamp).toLocaleString('it-IT')}
                  </TableCell>
                  <TableCell className="text-sm">{log.user_id}</TableCell>
                  <TableCell className="text-sm">{log.machine_id}</TableCell>
                  <TableCell className="text-sm max-w-xs truncate">{log.domanda}</TableCell>
                  <TableCell className="text-sm max-w-xs truncate">{log.risposta}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
};
