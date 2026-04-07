import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import API_ENDPOINTS from '@/shared/api/config';
import { useAuth } from '@/shared/auth/AuthContext';
import { useApiClient } from '@/shared/api/apiClient';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { Activity, BookText, Cpu, LayoutDashboard, LogOut, ScrollText, Settings, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { DashboardSummary, InteractionLogEntry } from './adminTypes';
import { KnowledgeManager } from './KnowledgeManager';
import { LogViewer } from './LogViewer';
import { MachineList } from './MachineList';
import { SettingsPanel } from './SettingsPanel';
import { UserList } from './UserList';
import { useAdminMetadata } from './useAdminMetadata';

const statCards = [
  { key: 'total_users', label: 'Utenti', icon: Users, accent: 'bg-sky-50 text-sky-700' },
  { key: 'machines_available', label: 'Macchinari liberi', icon: Cpu, accent: 'bg-emerald-50 text-emerald-700' },
  { key: 'machines_in_use', label: 'Macchinari in uso', icon: Activity, accent: 'bg-amber-50 text-amber-700' },
  { key: 'active_departments', label: 'Reparti attivi', icon: LayoutDashboard, accent: 'bg-indigo-50 text-indigo-700' },
  { key: 'knowledge_items', label: 'Template knowledge', icon: BookText, accent: 'bg-rose-50 text-rose-700' },
] as const;

export const AdminDashboard = () => {
  const { accessToken, isAdmin, logout, refreshAccessToken, user } = useAuth();
  const { apiCall } = useApiClient();
  const { departments, categories, machines, users, refresh } = useAdminMetadata();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [recentLogs, setRecentLogs] = useState<InteractionLogEntry[]>([]);
  const [isLoadingOverview, setIsLoadingOverview] = useState(true);

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
      const [summaryResponse, logsResponse] = await Promise.all([
        apiCall(API_ENDPOINTS.ADMIN_DASHBOARD_SUMMARY),
        apiCall(`${API_ENDPOINTS.LIST_LOGS}?page=1&size=5`),
      ]);

      if (summaryResponse.ok) {
        setSummary((await summaryResponse.json()) as DashboardSummary);
      }
      if (logsResponse.ok) {
        setRecentLogs((await logsResponse.json()) as InteractionLogEntry[]);
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

  const headerSubtitle = useMemo(() => {
    if (!summary) {
      return 'Controlla utenti, macchinari e knowledge da un unico punto.';
    }
    return `${summary.total_users} utenti, ${summary.total_machines} macchinari, ${summary.knowledge_items} template knowledge.`;
  }, [summary]);

  const handleLogout = async () => {
    await logout();
    navigate('/admin-login', { replace: true });
    toast.success('Logout effettuato');
  };

  const refreshAll = useCallback(async () => {
    await Promise.all([refresh(), loadOverview()]);
  }, [loadOverview, refresh]);

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

      if (eventName === 'machine_status' || eventName === 'interaction_created') {
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
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8 lg:flex-row lg:items-center lg:justify-between">
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
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Dashboard operativa</h1>
              <p className="text-sm text-slate-500">{headerSubtitle}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
          <TabsList className="grid w-full grid-cols-3 gap-2 rounded-2xl bg-white p-2 shadow-sm lg:grid-cols-6">
            <TabsTrigger value="overview" className="gap-2">
              <LayoutDashboard className="h-4 w-4" />
              <span className="hidden sm:inline">Panoramica</span>
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-2">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Utenti</span>
            </TabsTrigger>
            <TabsTrigger value="machines" className="gap-2">
              <Cpu className="h-4 w-4" />
              <span className="hidden sm:inline">Macchinari</span>
            </TabsTrigger>
            <TabsTrigger value="knowledge" className="gap-2">
              <BookText className="h-4 w-4" />
              <span className="hidden sm:inline">Knowledge</span>
            </TabsTrigger>
            <TabsTrigger value="logs" className="gap-2">
              <ScrollText className="h-4 w-4" />
              <span className="hidden sm:inline">Log</span>
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-2">
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">Impostazioni</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
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

            <section className="grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
              <Card className="border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">Ultime interazioni</h2>
                    <p className="text-sm text-slate-500">Panoramica rapida delle richieste recenti.</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setActiveTab('logs')}>
                    Vai ai log
                  </Button>
                </div>

                <div className="mt-4 space-y-3">
                  {recentLogs.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                      Nessuna interazione recente disponibile.
                    </div>
                  ) : (
                    recentLogs.map((log) => (
                      <div key={log.id} className="rounded-xl border border-slate-200 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{log.category_name || 'Fallback'}</Badge>
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
                  <Button variant="outline" className="justify-start" onClick={() => setActiveTab('users')}>
                    Crea o modifica utenti
                  </Button>
                  <Button variant="outline" className="justify-start" onClick={() => setActiveTab('machines')}>
                    Gestisci macchinari e stato
                  </Button>
                  <Button variant="outline" className="justify-start" onClick={() => setActiveTab('knowledge')}>
                    Aggiorna knowledge e assegnazioni
                  </Button>
                  <Button variant="outline" className="justify-start" onClick={() => setActiveTab('settings')}>
                    Controlla impostazioni sistema
                  </Button>
                </div>
              </Card>
            </section>
          </TabsContent>

          <TabsContent value="users" className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">Gestione utenti</h2>
              <p className="text-sm text-slate-500">
                Crea utenti con dati coerenti e filtra rapidamente per reparto, ruolo e turno.
              </p>
            </div>
            <UserList departments={departments} onMetadataRefresh={refreshAll} />
          </TabsContent>

          <TabsContent value="machines" className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">Gestione macchinari</h2>
              <p className="text-sm text-slate-500">
                Monitora lo stato in tempo reale, aggiorna i reparti e gestisci le postazioni.
              </p>
            </div>
            <MachineList departments={departments} onMetadataRefresh={refreshAll} />
          </TabsContent>

          <TabsContent value="knowledge" className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">Knowledge base modulare</h2>
              <p className="text-sm text-slate-500">
                Le categorie restano globali, mentre i template vengono assegnati ai singoli macchinari.
              </p>
            </div>
            <KnowledgeManager categories={categories} machines={machines} onMetadataRefresh={refreshAll} />
          </TabsContent>

          <TabsContent value="logs" className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">Log di audit</h2>
              <p className="text-sm text-slate-500">
                Consulta le interazioni con nomi umani, categorie e template effettivamente usati.
              </p>
            </div>
            <LogViewer departments={departments} categories={categories} machines={machines} users={users} />
          </TabsContent>

          <TabsContent value="settings" className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">Impostazioni</h2>
              <p className="text-sm text-slate-500">
                Mantieni le configurazioni di sistema sotto controllo.
              </p>
            </div>
            <SettingsPanel />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};
