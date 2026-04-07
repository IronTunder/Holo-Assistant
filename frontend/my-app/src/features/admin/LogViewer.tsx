import { useEffect, useMemo, useState } from 'react';

import API_ENDPOINTS from '@/shared/api/config';
import { useApiClient } from '@/shared/api/apiClient';
import { Badge } from '@/shared/ui/badge';
import { Card } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { toast } from 'sonner';
import type { AdminCategory, AdminMachine, AdminUser, DepartmentOption, InteractionLogEntry } from './adminTypes';

interface LogViewerProps {
  departments: DepartmentOption[];
  categories: AdminCategory[];
  machines: AdminMachine[];
  users: AdminUser[];
}

export const LogViewer = ({ departments, categories, machines, users }: LogViewerProps) => {
  const { apiCall } = useApiClient();
  const [logs, setLogs] = useState<InteractionLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [machineFilter, setMachineFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');

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
      return matchesSearch && matchesDepartment && matchesCategory && matchesMachine && matchesUser;
    });
  }, [categoryFilter, departmentFilter, departments, logs, machineFilter, searchTerm, userFilter]);

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 bg-white p-4">
        <div className="grid gap-3 lg:grid-cols-5">
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-slate-500">
                    Caricamento log...
                  </TableCell>
                </TableRow>
              ) : filteredLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-slate-500">
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
                        <Badge variant="outline">{log.category_name || 'Fallback'}</Badge>
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
