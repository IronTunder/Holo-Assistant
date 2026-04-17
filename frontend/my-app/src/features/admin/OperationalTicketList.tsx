import { useCallback, useEffect, useMemo, useState } from 'react';

import API_ENDPOINTS from '@/shared/api/config';
import { useApiClient } from '@/shared/api/apiClient';
import { Badge } from '@/shared/ui/badge';
import { Card } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { toast } from 'sonner';

import type { AdminOperationalTicket } from './adminTypes';

const workflowLabels: Record<string, string> = {
  material_shortage: 'Materiale',
};

const statusBadgeClassNames: Record<string, string> = {
  open: 'border-red-200 bg-red-50 text-red-700',
  closed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

export function OperationalTicketList() {
  const { apiCall } = useApiClient();
  const [tickets, setTickets] = useState<AdminOperationalTicket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchTickets = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      const response = await apiCall(
        `${API_ENDPOINTS.LIST_OPERATIONAL_TICKETS}${params.toString() ? `?${params.toString()}` : ''}`
      );
      if (!response.ok) {
        throw new Error('Errore nel caricamento ticket');
      }
      setTickets((await response.json()) as AdminOperationalTicket[]);
    } catch (error) {
      console.error(error);
      toast.error('Errore nel caricamento ticket');
    } finally {
      setIsLoading(false);
    }
  }, [apiCall, statusFilter]);

  useEffect(() => {
    void fetchTickets();
  }, [fetchTickets]);

  const filteredTickets = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return tickets.filter((ticket) => {
      if (!normalizedSearch) {
        return true;
      }
      return `${ticket.summary} ${ticket.details || ''} ${ticket.machine_name || ''} ${ticket.material_name || ''}`
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [searchTerm, tickets]);

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-[1.2fr_0.4fr]">
          <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Cerca per riepilogo, materiale o macchinario..." />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue placeholder="Tutti gli stati" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti gli stati</SelectItem>
              <SelectItem value="open">Aperti</SelectItem>
              <SelectItem value="closed">Chiusi</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>Creato</TableHead>
                <TableHead>Ticket</TableHead>
                <TableHead>Contesto</TableHead>
                <TableHead>Stato</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-slate-500">Caricamento ticket...</TableCell>
                </TableRow>
              ) : filteredTickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-slate-500">Nessun ticket trovato</TableCell>
                </TableRow>
              ) : (
                filteredTickets.map((ticket) => (
                  <TableRow key={ticket.id} className="hover:bg-slate-50/80">
                    <TableCell className="text-sm text-slate-500">{new Date(ticket.created_at).toLocaleString('it-IT')}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-slate-900">#{ticket.id}</p>
                          <Badge variant="outline">{workflowLabels[ticket.workflow_type] || ticket.workflow_type}</Badge>
                        </div>
                        <p className="text-sm text-slate-700">{ticket.summary}</p>
                        {ticket.details ? <p className="text-xs text-slate-500">{ticket.details}</p> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">
                      <div className="space-y-1">
                        <p>{ticket.machine_name || ticket.working_station_name || '-'}</p>
                        <p className="text-xs text-slate-500">{ticket.material_name || ticket.user_name || '-'}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusBadgeClassNames[ticket.status] || 'border-slate-200 bg-slate-50 text-slate-700'}>
                        {ticket.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
