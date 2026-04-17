import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import API_ENDPOINTS from '@/shared/api/config';
import { useAuth } from '@/shared/auth/AuthContext';
import { useApiClient } from '@/shared/api/apiClient';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { Activity, BookText, Boxes, Cpu, LayoutDashboard, LogOut, MapPinned, ScrollText, Settings, ShieldCheck, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { DashboardSummary, InteractionLogEntry } from './adminTypes';
import { KnowledgeManager } from './KnowledgeManager';
import { LogViewer } from './LogViewer';
import { MachineList } from './MachineList';
import { WorkingStationList } from './WorkingStationList';
import { DepartmentManager } from './DepartmentManager';
import { RoleManager } from './RoleManager';
import { SettingsPanel } from './SettingsPanel';
import { UserList } from './UserList';
import { useAdminMetadata } from './useAdminMetadata';
import { compactInteractionLogs } from './compactInteractionLogs';
import { MaterialManager } from './MaterialManager';
import { OperationalTicketList } from './OperationalTicketList';

const statCards = [
  { key: 'total_users', label: 'Utenti', icon: Users, accent: 'bg-sky-50 text-sky-700' },
  { key: 'machines_available', label: 'Macchinari liberi', icon: Cpu, accent: 'bg-emerald-50 text-emerald-700' },
  { key: 'machines_in_use', label: 'Macchinari in uso', icon: Activity, accent: 'bg-amber-50 text-amber-700' },
  { key: 'active_departments', label: 'Reparti attivi', icon: LayoutDashboard, accent: 'bg-indigo-50 text-indigo-700' },
  { key: 'knowledge_items', label: 'Template knowledge', icon: BookText, accent: 'bg-rose-50 text-rose-700' },
  { key: 'total_materials', label: 'Materiali', icon: Boxes, accent: 'bg-cyan-50 text-cyan-700' },
  { key: 'low_stock_materials', label: 'Sotto soglia', icon: Boxes, accent: 'bg-amber-50 text-amber-700' },
  { key: 'out_of_stock_materials', label: 'Esauriti', icon: Boxes, accent: 'bg-red-50 text-red-700' },
] as const;

const feedbackLabels = {
  resolved: 'Risolto',
  unresolved: 'Non risolto',
  not_applicable: 'Non rilevante',
} as const;

const actionLabels = {
  question: 'Domanda',
  maintenance: 'Manutenzione',
  emergency: 'Emergenza',
  material_shortage: 'Materiale',
} as const;

type InteractionResolutionResponse = {
  interaction_id: number;
  feedback_status: 'resolved';
  feedback_timestamp: string;
  resolved_by_user_id: number;
  resolved_by_user_name: string;
  resolution_note?: string | null;
  resolution_timestamp: string;
};

export const AdminDashboard = () => {
  const { accessToken, isAdmin, logout, refreshAccessToken, user } = useAuth();
  const { apiCall } = useApiClient();
  const { departments, categories, machines, workingStations, users, roles, refresh } = useAdminMetadata();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [operationsView, setOperationsView] = useState<'logs' | 'tickets'>('logs');
  const [resourcesView, setResourcesView] = useState<'users' | 'machines' | 'working-stations' | 'materials'>('users');
  const [configurationView, setConfigurationView] = useState<'knowledge' | 'organization' | 'settings'>('knowledge');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [recentLogs, setRecentLogs] = useState<InteractionLogEntry[]>([]);
  const [recentUnresolvedLogs, setRecentUnresolvedLogs] = useState<InteractionLogEntry[]>([]);
  const [isLoadingOverview, setIsLoadingOverview] = useState(true);
  const [updatingInteractionId, setUpdatingInteractionId] = useState<number | null>(null);

  const authorizedFetch = useCallback(
    async (
      input: RequestInfo | URL,
      init: RequestInit = {},
      allowRetry = true,
      tokenOverride?: string
    ): Promise<Response> => {
      const token = tokenOverride ?? accessToken;
      const headers = new Headers(init.headers);

      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      const response = await fetch(input, {
        ...init,
        headers,
        credentials: 'include',
      });

      if (response.status === 401 && allowRetry) {
        const refreshedToken = await refreshAccessToken();
        if (refreshedToken) {
          return authorizedFetch(input, init, false, refreshedToken);
        }
      }

      return response;
    },
    [accessToken, refreshAccessToken]
  );

  const loadOverview = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setIsLoadingOverview(true);
    }

    try {
      const [summaryResponse, logsResponse, unresolvedLogsResponse] = await Promise.all([
        apiCall(API_ENDPOINTS.ADMIN_DASHBOARD_SUMMARY),
        apiCall(`${API_ENDPOINTS.LIST_LOGS}?page=1&size=5`),
        apiCall(`${API_ENDPOINTS.LIST_LOGS}?page=1&size=5&feedback_status=unresolved`),
      ]);

      if (summaryResponse.ok) {
        setSummary((await summaryResponse.json()) as DashboardSummary);
      }
      if (logsResponse.ok) {
        setRecentLogs((await logsResponse.json()) as InteractionLogEntry[]);
      }
      if (unresolvedLogsResponse.ok) {
        setRecentUnresolvedLogs((await unresolvedLogsResponse.json()) as InteractionLogEntry[]);
      }
    } catch (error) {
      console.error(error);
      if (!silent) {
        toast.error('Errore nel caricamento panoramica admin');
      }
    } finally {
      if (!silent) {
        setIsLoadingOverview(false);
      }
    }
  }, [apiCall]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (activeTab === 'overview') {
      void loadOverview({ silent: true });
    }
  }, [activeTab, loadOverview]);

  useEffect(() => {
    if (!accessToken || !isAdmin) {
      return;
    }

    window.history.pushState({ adminDashboard: true }, '', window.location.href);

    const handlePopState = () => {
      window.history.pushState({ adminDashboard: true }, '', window.location.href);
      navigate('/admin', { replace: true });
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [accessToken, isAdmin, navigate]);

  const headerSubtitle = useMemo(() => {
    if (!summary) {
      return 'Controlla utenti, macchinari, materiali e knowledge da un unico punto.';
    }
    return `${summary.total_users} utenti, ${summary.total_machines} macchinari, ${summary.total_working_stations} postazioni, ${summary.total_materials} materiali, ${summary.knowledge_items} template knowledge.`;
  }, [summary]);

  const compactRecentLogs = useMemo(() => compactInteractionLogs(recentLogs), [recentLogs]);
  const compactRecentUnresolvedLogs = useMemo(() => compactInteractionLogs(recentUnresolvedLogs), [recentUnresolvedLogs]);
  const compactRecentCriticalEmergencyLogs = useMemo(
    () => compactRecentUnresolvedLogs.filter((log) => log.action_type === 'emergency' && log.priority === 'critical'),
    [compactRecentUnresolvedLogs]
  );
  const compactRecentStandardUnresolvedLogs = useMemo(
    () => compactRecentUnresolvedLogs.filter((log) => !(log.action_type === 'emergency' && log.priority === 'critical')),
    [compactRecentUnresolvedLogs]
  );

  const hasPermission = useCallback(
    (permission: string) => {
      if (user?.permissions?.includes(permission)) {
        return true;
      }
      return isAdmin && !user?.permissions;
    },
    [isAdmin, user?.permissions]
  );

  const handleLogout = async () => {
    await logout();
    navigate('/admin-login', { replace: true });
    toast.success('Logout effettuato');
  };

  const refreshAll = useCallback(async () => {
    await Promise.all([refresh(), loadOverview()]);
  }, [loadOverview, refresh]);

  const markInteractionAsResolved = useCallback(
    async (interactionId: number) => {
      setUpdatingInteractionId(interactionId);
      try {
        const response = await apiCall(API_ENDPOINTS.INTERACTION_RESOLVE(interactionId), {
          method: 'POST',
          body: JSON.stringify({
            resolution_note: 'Risoluzione confermata da admin',
          }),
        });
        if (!response.ok) {
          throw new Error('Errore nell\'aggiornamento del problema');
        }
        const resolvedData = (await response.json()) as InteractionResolutionResponse;

        setRecentUnresolvedLogs((currentLogs) =>
          currentLogs.filter((log) => log.id !== interactionId)
        );
        setRecentLogs((currentLogs) =>
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
    },
    [apiCall]
  );

  useEffect(() => {
    if (!accessToken || !isAdmin) {
      return;
    }

    let isCancelled = false;
    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let streamAbortController: AbortController | null = null;

    const isVisible = () => document.visibilityState === 'visible';

    const abortStream = () => {
      if (streamAbortController) {
        streamAbortController.abort();
        streamAbortController = null;
      }
    };

    const handleAdminEvent = async (eventName: string) => {
      if (eventName === 'heartbeat') {
        return;
      }

      if (eventName === 'machine_status') {
        await refresh();
      }

      if (
        eventName === 'machine_status' ||
        eventName === 'interaction_created' ||
        eventName === 'interaction_feedback_updated'
      ) {
        await loadOverview({ silent: true });
      }
    };

    const processSseChunk = async (chunk: string) => {
      const blocks = chunk.split('\n\n');
      const remainder = blocks.pop() ?? '';

      for (const block of blocks) {
        const lines = block.split(/\r?\n/);
        let eventName = 'message';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          }
        }

        await handleAdminEvent(eventName);
      }

      return remainder;
    };

    const scheduleRetry = () => {
      if (retryTimeoutId || isCancelled || !isVisible()) {
        return;
      }

      retryTimeoutId = setTimeout(() => {
        retryTimeoutId = null;
        void connectAdminStream();
      }, 5000);
    };

    const connectAdminStream = async () => {
      if (isCancelled || !isVisible()) {
        return;
      }

      abortStream();
      const controller = new AbortController();
      streamAbortController = controller;

      try {
        const response = await authorizedFetch(
          API_ENDPOINTS.ADMIN_MACHINE_EVENTS,
          {
            headers: { Accept: 'text/event-stream' },
            signal: controller.signal,
          }
        );

        if (!response.ok || !response.body) {
          throw new Error(`Stream admin non disponibile (${response.status})`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!isCancelled) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          buffer = await processSseChunk(buffer);
        }

        if (buffer.trim()) {
          await processSseChunk(`${buffer}\n\n`);
        }

        if (!isCancelled && isVisible()) {
          scheduleRetry();
        }
      } catch (error) {
        if (
          controller.signal.aborted ||
          isCancelled ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          return;
        }

        console.error('Errore stream panoramica admin SSE:', error);
        scheduleRetry();
      }
    };

    const handleVisibilityChange = () => {
      if (!isVisible()) {
        abortStream();
        if (retryTimeoutId) {
          clearTimeout(retryTimeoutId);
          retryTimeoutId = null;
        }
        return;
      }

      void refreshAll();
      void connectAdminStream();
    };

    void connectAdminStream();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isCancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      abortStream();
      if (retryTimeoutId) {
        clearTimeout(retryTimeoutId);
      }
    };
  }, [accessToken, authorizedFetch, isAdmin, loadOverview, refresh, refreshAll]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#eff6ff,_#f8fafc_55%)]">
      <div className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
                Area Admin
              </Badge>
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                {user?.nome || 'Amministratore'}
              </Badge>
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Dashboard operativa</h1>
              <p className="text-sm text-slate-500">{headerSubtitle}</p>
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
              Aggiornamento automatico attivo
            </Badge>
            <Button onClick={handleLogout} variant="outline" className="gap-2">
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-2 rounded-2xl bg-white p-2 shadow-sm sm:grid-cols-4">
            <TabsTrigger value="overview" className="gap-2">
              <LayoutDashboard className="h-4 w-4" />
              <span>Panoramica</span>
            </TabsTrigger>
            {hasPermission('logs.view') ? (
              <TabsTrigger value="operations" className="gap-2">
                <ScrollText className="h-4 w-4" />
                <span>Operazioni</span>
              </TabsTrigger>
            ) : null}
            {hasPermission('users.manage') || hasPermission('machines.manage') || hasPermission('knowledge.manage') ? (
              <TabsTrigger value="resources" className="gap-2">
                <Boxes className="h-4 w-4" />
                <span>Risorse</span>
              </TabsTrigger>
            ) : null}
            {hasPermission('knowledge.manage') || hasPermission('roles.manage') || hasPermission('departments.manage') || hasPermission('settings.view') ? (
              <TabsTrigger value="configuration" className="gap-2">
                <Settings className="h-4 w-4" />
                <span>Configurazione</span>
              </TabsTrigger>
            ) : null}
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {statCards.map((card) => {
                const Icon = card.icon;
                const value = summary ? summary[card.key] : null;
                return (
                  <Card key={card.key} className="border-slate-200 bg-white/90 p-5 shadow-sm">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm text-slate-500">{card.label}</p>
                        <p className="mt-3 text-3xl font-semibold text-slate-950">
                          {isLoadingOverview ? '...' : value}
                        </p>
                      </div>
                      <div className={`rounded-xl p-3 ${card.accent}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                    </div>
                  </Card>
                );
              })}
            </section>

            <section>
              <Card className="border-red-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">Problemi non risolti recenti</h2>
                    <p className="text-sm text-slate-500">
                      Segnalazioni in attesa di conferma da un tecnico manutentore.
                    </p>
                  </div>
                  <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
                    {compactRecentUnresolvedLogs.length} aperti
                  </Badge>
                </div>

                <div className="mt-4 space-y-3">
                  {compactRecentCriticalEmergencyLogs.length > 0 ? (
                    <div className="rounded-xl border border-red-300 bg-red-600 p-4 text-white shadow-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="border-white/40 bg-white text-red-700">
                          Emergenza critica
                        </Badge>
                        <span className="text-xs text-red-100">{compactRecentCriticalEmergencyLogs.length} attive</span>
                      </div>
                      <div className="mt-3 space-y-3">
                        {compactRecentCriticalEmergencyLogs.map((log) => (
                          <div key={log.id} className="rounded-xl border border-white/20 bg-white/10 p-3">
                            <p className="text-sm font-semibold">
                              {log.machine_name} - {log.user_name}
                            </p>
                            <p className="mt-1 text-sm text-red-50">{log.domanda}</p>
                            <p className="mt-1 text-xs text-red-100">
                              {new Date(log.timestamp).toLocaleString('it-IT')}
                            </p>
                            <div className="mt-3">
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={updatingInteractionId === log.id}
                                onClick={() => void markInteractionAsResolved(log.id)}
                              >
                                Conferma risoluzione
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {compactRecentUnresolvedLogs.length === 0 ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                      Nessun problema non risolto nelle interazioni piu recenti.
                    </div>
                  ) : (
                    compactRecentStandardUnresolvedLogs.map((log) => (
                      <div key={log.id} className="rounded-xl border border-red-100 bg-red-50/60 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="border-red-200 bg-white text-red-700">
                            In attesa tecnico
                          </Badge>
                          <Badge variant="outline" className={log.action_type === 'maintenance' ? 'border-amber-200 bg-amber-50 text-amber-700' : ''}>
                            {actionLabels[log.action_type]}
                          </Badge>
                          <Badge variant="outline">{log.category_name || 'Fallback'}</Badge>
                          {log.compactedEntriesCount > 1 ? (
                            <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
                              {log.compactedEntriesCount} passaggi
                            </Badge>
                          ) : null}
                          <span className="text-xs text-slate-500">
                            {new Date(log.timestamp).toLocaleString('it-IT')}
                          </span>
                        </div>
                        <p className="mt-2 text-sm font-semibold text-slate-900">
                          {log.machine_name} - {log.user_name}
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm text-slate-700">{log.domanda}</p>
                        {log.risposta ? (
                          <p className="mt-2 line-clamp-2 text-xs text-slate-500">{log.risposta}</p>
                        ) : null}
                        <div className="mt-3">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={updatingInteractionId === log.id}
                            onClick={() => void markInteractionAsResolved(log.id)}
                          >
                            Conferma risoluzione
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
              <Card className="border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">Ultime interazioni</h2>
                    <p className="text-sm text-slate-500">Panoramica rapida delle richieste recenti.</p>
                  </div>
                  {hasPermission('logs.view') ? (
                    <Button variant="outline" size="sm" onClick={() => {
                      setOperationsView('logs');
                      setActiveTab('operations');
                    }}>
                      Vai ai log
                    </Button>
                  ) : null}
                </div>

                <div className="mt-4 space-y-3">
                  {compactRecentLogs.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                      Nessuna interazione recente disponibile.
                    </div>
                  ) : (
                    compactRecentLogs.map((log) => (
                      <div key={log.id} className="rounded-xl border border-slate-200 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{log.category_name || 'Fallback'}</Badge>
                          {log.compactedEntriesCount > 1 ? (
                            <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
                              {log.compactedEntriesCount} passaggi
                            </Badge>
                          ) : null}
                          {log.feedback_status ? (
                            <Badge variant="outline">
                              {feedbackLabels[log.feedback_status]}
                            </Badge>
                          ) : null}
                          {log.resolved_by_user_name ? (
                            <span className="text-xs text-slate-500">
                              Chiuso da {log.resolved_by_user_name}
                            </span>
                          ) : null}
                          <span className="text-xs text-slate-400">
                            {new Date(log.timestamp).toLocaleString('it-IT')}
                          </span>
                        </div>
                        <p className="mt-2 text-sm font-medium text-slate-900">
                          {log.user_name} su {log.machine_name}
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm text-slate-600">{log.domanda}</p>
                      </div>
                    ))
                  )}
                </div>
              </Card>

              <Card className="border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-950">Azioni rapide</h2>
                <p className="text-sm text-slate-500">Apri subito il flusso che ti serve di piu.</p>
                <div className="mt-4 grid gap-3">
                  {hasPermission('users.manage') ? (
                    <Button variant="outline" className="justify-start" onClick={() => {
                      setResourcesView('users');
                      setActiveTab('resources');
                    }}>
                      Crea o modifica utenti
                    </Button>
                  ) : null}
                  {hasPermission('machines.manage') ? (
                    <Button variant="outline" className="justify-start" onClick={() => {
                      setResourcesView('machines');
                      setActiveTab('resources');
                    }}>
                      Gestisci macchinari e stato
                    </Button>
                  ) : null}
                  {hasPermission('machines.manage') ? (
                    <Button variant="outline" className="justify-start" onClick={() => {
                      setResourcesView('working-stations');
                      setActiveTab('resources');
                    }}>
                      Crea o modifica postazioni
                    </Button>
                  ) : null}
                  {hasPermission('knowledge.manage') ? (
                    <Button variant="outline" className="justify-start" onClick={() => {
                      setResourcesView('materials');
                      setActiveTab('resources');
                    }}>
                      Gestisci materiali e magazzino
                    </Button>
                  ) : null}
                  {hasPermission('knowledge.manage') ? (
                    <Button variant="outline" className="justify-start" onClick={() => {
                      setConfigurationView('knowledge');
                      setActiveTab('configuration');
                    }}>
                      Aggiorna knowledge e assegnazioni
                    </Button>
                  ) : null}
                  {hasPermission('settings.view') ? (
                    <Button variant="outline" className="justify-start" onClick={() => {
                      setConfigurationView('settings');
                      setActiveTab('configuration');
                    }}>
                      Controlla impostazioni sistema
                    </Button>
                  ) : null}
                </div>
              </Card>
            </section>
          </TabsContent>

          <TabsContent value="operations" className="space-y-4">
            <Card className="border-slate-200 bg-white p-4">
              <div className="flex flex-wrap gap-2">
                <Button variant={operationsView === 'logs' ? 'default' : 'outline'} onClick={() => setOperationsView('logs')}>
                  Log
                </Button>
                <Button variant={operationsView === 'tickets' ? 'default' : 'outline'} onClick={() => setOperationsView('tickets')}>
                  Ticket / segnalazioni
                </Button>
              </div>
            </Card>
            {operationsView === 'logs' && hasPermission('logs.view') ? (
              <LogViewer departments={departments} categories={categories} machines={machines} users={users} />
            ) : null}
            {operationsView === 'tickets' && hasPermission('logs.view') ? (
              <OperationalTicketList />
            ) : null}
          </TabsContent>

          <TabsContent value="resources" className="space-y-4">
            <Card className="border-slate-200 bg-white p-4">
              <div className="flex flex-wrap gap-2">
                {hasPermission('users.manage') ? (
                  <Button variant={resourcesView === 'users' ? 'default' : 'outline'} onClick={() => setResourcesView('users')}>
                    Utenti
                  </Button>
                ) : null}
                {hasPermission('machines.manage') ? (
                  <Button variant={resourcesView === 'machines' ? 'default' : 'outline'} onClick={() => setResourcesView('machines')}>
                    Macchinari
                  </Button>
                ) : null}
                {hasPermission('machines.manage') ? (
                  <Button variant={resourcesView === 'working-stations' ? 'default' : 'outline'} onClick={() => setResourcesView('working-stations')}>
                    Postazioni
                  </Button>
                ) : null}
                {hasPermission('knowledge.manage') ? (
                  <Button variant={resourcesView === 'materials' ? 'default' : 'outline'} onClick={() => setResourcesView('materials')}>
                    Materiali
                  </Button>
                ) : null}
              </div>
            </Card>
            {resourcesView === 'users' && hasPermission('users.manage') ? (
              <UserList departments={departments} roles={roles} machines={machines} onMetadataRefresh={refreshAll} />
            ) : null}
            {resourcesView === 'machines' && hasPermission('machines.manage') ? (
              <MachineList departments={departments} workingStations={workingStations} onMetadataRefresh={refreshAll} />
            ) : null}
            {resourcesView === 'working-stations' && hasPermission('machines.manage') ? (
              <WorkingStationList departments={departments} onMetadataRefresh={refreshAll} />
            ) : null}
            {resourcesView === 'materials' && hasPermission('knowledge.manage') ? (
              <MaterialManager workingStations={workingStations} machines={machines} onMetadataRefresh={refreshAll} />
            ) : null}
          </TabsContent>

          <TabsContent value="configuration" className="space-y-4">
            <Card className="border-slate-200 bg-white p-4">
              <div className="flex flex-wrap gap-2">
                {hasPermission('knowledge.manage') ? (
                  <Button variant={configurationView === 'knowledge' ? 'default' : 'outline'} onClick={() => setConfigurationView('knowledge')}>
                    Knowledge
                  </Button>
                ) : null}
                {(hasPermission('roles.manage') || hasPermission('departments.manage')) ? (
                  <Button variant={configurationView === 'organization' ? 'default' : 'outline'} onClick={() => setConfigurationView('organization')}>
                    Reparti e ruoli
                  </Button>
                ) : null}
                {hasPermission('settings.view') ? (
                  <Button variant={configurationView === 'settings' ? 'default' : 'outline'} onClick={() => setConfigurationView('settings')}>
                    Impostazioni
                  </Button>
                ) : null}
              </div>
            </Card>
            {configurationView === 'knowledge' && hasPermission('knowledge.manage') ? (
              <KnowledgeManager categories={categories} workingStations={workingStations} onMetadataRefresh={refreshAll} />
            ) : null}
            {configurationView === 'organization' ? (
              <div className="space-y-6">
                {hasPermission('roles.manage') ? <RoleManager onMetadataRefresh={refreshAll} /> : null}
                {hasPermission('departments.manage') ? <DepartmentManager onMetadataRefresh={refreshAll} /> : null}
                {!hasPermission('roles.manage') && !hasPermission('departments.manage') ? (
                  <Card className="border-slate-200 bg-white p-5 text-sm text-slate-500">
                    Non hai permessi per modificare ruoli o reparti.
                  </Card>
                ) : null}
              </div>
            ) : null}
            {configurationView === 'settings' && hasPermission('settings.view') ? (
              <SettingsPanel canEdit={hasPermission('settings.edit')} />
            ) : null}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};
