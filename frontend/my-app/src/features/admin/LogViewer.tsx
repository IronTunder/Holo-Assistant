import { useEffect, useMemo, useState } from 'react';

import API_ENDPOINTS from '@/shared/api/config';
import { useApiClient } from '@/shared/api/apiClient';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { toast } from 'sonner';
import type {
  AdminCategory,
  AdminMachine,
  AdminUser,
  DepartmentOption,
  InteractionActionType,
  InteractionFeedbackStatus,
  InteractionLogEntry,
  InteractionPriority,
} from './adminTypes';

interface LogViewerProps {
  departments: DepartmentOption[];
  categories: AdminCategory[];
  machines: AdminMachine[];
  users: AdminUser[];
}

type InteractionResolutionResponse = {
  interaction_id: number;
  feedback_status: 'resolved';
  feedback_timestamp: string;
  resolved_by_user_id: number;
  resolved_by_user_name: string;
  resolution_note?: string | null;
  resolution_timestamp: string;
};

export const LogViewer = ({ departments, categories, machines, users }: LogViewerProps) => {
  const { apiCall } = useApiClient();
  const [logs, setLogs] = useState<InteractionLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [machineFilter, setMachineFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [feedbackFilter, setFeedbackFilter] = useState('all');
  const [updatingInteractionId, setUpdatingInteractionId] = useState<number | null>(null);

  const feedbackLabels: Record<InteractionFeedbackStatus, string> = {
    resolved: 'Risolto',
    unresolved: 'Non risolto',
    not_applicable: 'Non rilevante',
  };

  const feedbackBadgeClassNames: Record<InteractionFeedbackStatus, string> = {
    resolved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    unresolved: 'border-red-200 bg-red-50 text-red-700',
    not_applicable: 'border-slate-200 bg-slate-100 text-slate-700',
  };

  const actionLabels: Record<InteractionActionType, string> = {
    question: 'Domanda',
    maintenance: 'Manutenzione',
    emergency: 'Emergenza',
  };

  const actionBadgeClassNames: Record<InteractionActionType, string> = {
    question: 'border-slate-200 bg-slate-50 text-slate-700',
    maintenance: 'border-amber-200 bg-amber-50 text-amber-700',
    emergency: 'border-red-200 bg-red-50 text-red-700',
  };

  const priorityLabels: Record<InteractionPriority, string> = {
    normal: 'Priorita normale',
    critical: 'Priorita critica',
  };

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const response = await apiCall(`${API_ENDPOINTS.LIST_LOGS}?page=1&size=100`);
      if (!response.ok) {
        throw new Error('Errore nel caricamento log');
      }
      const data = (await response.json()) as InteractionLogEntry[];
      setLogs(data);
    } catch (error) {
      console.error(error);
      toast.error('Errore nel caricamento log');
    } finally {
      setIsLoading(false);
    }
  };

  const markInteractionAsResolved = async (interactionId: number) => {
    setUpdatingInteractionId(interactionId);
    try {
      const response = await apiCall(API_ENDPOINTS.INTERACTION_RESOLVE(interactionId), {
        method: 'POST',
        body: JSON.stringify({
          resolution_note: 'Risoluzione confermata da admin',
        }),
      });
      if (!response.ok) {
        throw new Error('Errore nell\'aggiornamento dello stato');
      }
      const resolvedData = (await response.json()) as InteractionResolutionResponse;

      setLogs((currentLogs) =>
        currentLogs.map((log) =>
          log.id === interactionId
            ? {
                ...log,
                feedback_status: 'resolved',
                feedback_timestamp: resolvedData.feedback_timestamp,
                resolved_by_user_id: resolvedData.resolved_by_user_id,
                resolved_by_user_name: resolvedData.resolved_by_user_name,
                resolution_note: resolvedData.resolution_note,
                resolution_timestamp: resolvedData.resolution_timestamp,
              }
            : log
        )
      );
      toast.success('Problema segnato come risolto');
    } catch (error) {
      console.error(error);
      toast.error('Impossibile aggiornare il problema');
    } finally {
      setUpdatingInteractionId(null);
    }
  };

  useEffect(() => {
    void fetchLogs();
  }, [apiCall]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const haystack = `${log.user_name} ${log.machine_name} ${log.domanda} ${log.risposta ?? ''}`.toLowerCase();
      const matchesSearch = haystack.includes(searchTerm.toLowerCase());
      const matchesDepartment =
        departmentFilter === 'all' || (log.department_name ?? '') === departments.find((item) => String(item.id) === departmentFilter)?.name;
      const matchesCategory = categoryFilter === 'all' || String(log.category_id ?? '') === categoryFilter;
      const matchesMachine = machineFilter === 'all' || String(log.machine_id) === machineFilter;
      const matchesUser = userFilter === 'all' || String(log.user_id) === userFilter;
      const matchesFeedback = feedbackFilter === 'all' || (log.feedback_status ?? 'pending') === feedbackFilter;
      return matchesSearch && matchesDepartment && matchesCategory && matchesMachine && matchesUser && matchesFeedback;
    });
  }, [categoryFilter, departmentFilter, departments, feedbackFilter, logs, machineFilter, searchTerm, userFilter]);

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Input
            placeholder="Cerca domanda, risposta o nome..."
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
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Tutte le categorie" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutte le categorie</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={String(category.id)}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={machineFilter} onValueChange={setMachineFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Tutti i macchinari" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i macchinari</SelectItem>
              {machines.map((machine) => (
                <SelectItem key={machine.id} value={String(machine.id)}>
                  {machine.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={userFilter} onValueChange={setUserFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Tutti gli utenti" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti gli utenti</SelectItem>
              {users.map((user) => (
                <SelectItem key={user.id} value={String(user.id)}>
                  {user.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={feedbackFilter} onValueChange={setFeedbackFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Tutti gli esiti" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti gli esiti</SelectItem>
              <SelectItem value="pending">In attesa</SelectItem>
              <SelectItem value="resolved">Risolto</SelectItem>
              <SelectItem value="unresolved">Non risolto</SelectItem>
              <SelectItem value="not_applicable">Non rilevante</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>Data</TableHead>
                <TableHead>Contesto</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Domanda</TableHead>
                <TableHead>Risposta</TableHead>
                <TableHead>Esito</TableHead>
                <TableHead>Azione</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-slate-500">
                    Caricamento log...
                  </TableCell>
                </TableRow>
              ) : filteredLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-slate-500">
                    Nessun log trovato con i filtri correnti
                  </TableCell>
                </TableRow>
              ) : (
                filteredLogs.map((log) => (
                  <TableRow key={log.id} className="align-top hover:bg-slate-50/80">
                    <TableCell className="text-sm text-slate-600">
                      {new Date(log.timestamp).toLocaleString('it-IT')}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1 text-sm">
                        <p className="font-medium text-slate-900">{log.user_name}</p>
                        <p className="text-slate-500">{log.machine_name}</p>
                        <p className="text-xs text-slate-400">{log.department_name || 'Reparto non disponibile'}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          <Badge
                            variant="outline"
                            className={actionBadgeClassNames[log.action_type]}
                          >
                            {actionLabels[log.action_type]}
                          </Badge>
                          {log.priority === 'critical' ? (
                            <Badge variant="outline" className="border-red-300 bg-red-600 text-white">
                              {priorityLabels[log.priority]}
                            </Badge>
                          ) : null}
                          <Badge variant="outline">{log.category_name || 'Fallback'}</Badge>
                        </div>
                        {log.knowledge_item_title ? (
                          <p className="max-w-xs text-xs text-slate-500">{log.knowledge_item_title}</p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-sm text-sm text-slate-700">
                      <p className="line-clamp-4 whitespace-pre-wrap">{log.domanda}</p>
                    </TableCell>
                    <TableCell className="max-w-md text-sm text-slate-700">
                      <p className="line-clamp-5 whitespace-pre-wrap">{log.risposta || '-'}</p>
                    </TableCell>
                    <TableCell>
                      {log.feedback_status ? (
                        <div className="space-y-2">
                          <Badge
                            variant="outline"
                            className={feedbackBadgeClassNames[log.feedback_status]}
                          >
                            {log.feedback_status === 'unresolved' ? 'In attesa tecnico' : feedbackLabels[log.feedback_status]}
                          </Badge>
                          <p className="text-xs text-slate-400">
                            {log.feedback_timestamp
                              ? new Date(log.feedback_timestamp).toLocaleString('it-IT')
                              : 'Aggiornato'}
                          </p>
                          {log.resolved_by_user_name ? (
                            <div className="space-y-1 text-xs text-slate-500">
                              <p>Chiuso da {log.resolved_by_user_name}</p>
                              {log.resolution_note ? (
                                <p className="max-w-xs whitespace-pre-wrap">{log.resolution_note}</p>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                          In attesa
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {log.feedback_status === 'unresolved' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={updatingInteractionId === log.id}
                          onClick={() => void markInteractionAsResolved(log.id)}
                        >
                          Conferma risoluzione
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
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
};
